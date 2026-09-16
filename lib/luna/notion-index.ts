import { createHash, randomUUID } from "crypto";
import {
  contentHash,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL
} from "@/lib/luna/embedding";
import { openaiApiKey } from "@/lib/luna/env-keys";
import { extractWorkserverPathsFromText } from "@/lib/luna/notion";

export const NOTION_INDEX_RATE_MS = 350;
export const NOTION_INDEX_MIN_EMBED_CHARS = 15;
export const NOTION_INDEX_INSERT_BATCH = 500;
/** HNSW 갱신 부담 — 청크 임베딩 upsert 는 25 이하 */
export const NOTION_INDEX_EMBED_BATCH = 25;
export const NOTION_INDEX_VALIDATE_RATIO = 0.7;

export const NOTION_VERSION = "2022-06-28";
export const EMPTY_NOTION_TITLE = "(제목 없음)";

const RICH_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code"
]);

const CAPTION_BLOCK_TYPES = new Set(["image", "file", "embed", "video", "pdf"]);

export type NotionSearchObject = {
  object: string;
  id: string;
  url?: string;
  archived?: boolean;
  last_edited_time?: string | null;
  parent?: {
    type?: string;
    page_id?: string;
    database_id?: string;
    block_id?: string;
    workspace?: boolean;
  };
  properties?: Record<string, unknown>;
  title?: unknown;
};

export type NotionBlock = {
  id: string;
  type?: string;
  has_children?: boolean;
  child_page?: { title?: string };
  child_database?: { title?: string };
  [key: string]: unknown;
};

export type IndexedBlock = {
  block_id: string;
  page_id: string;
  block_type: string;
  text: string;
  position: number;
  content_hash: string;
};

export type IndexedPage = {
  page_id: string;
  title: string;
  parent_type: string | null;
  parent_id: string | null;
  root_title: string | null;
  path_titles: string[];
  depth: number;
  nas_path: string | null;
  url: string | null;
  object_type: string;
  archived: boolean;
  last_edited_time: string | null;
  /** Notion properties 원본. 임베딩하지 않는다. */
  properties: Record<string, unknown> | null;
};

export type NotionRelationRow = {
  from_page_id: string;
  to_page_id: string;
  property_name: string;
};

export function newScanBatch(): string {
  return randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function plainFromRichText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (part && typeof part === "object" && "plain_text" in part) {
        return String((part as { plain_text?: string }).plain_text ?? "");
      }
      return "";
    })
    .join("")
    .trim();
}

export function extractNotionTitle(item: NotionSearchObject): string {
  if (item.object === "database") {
    const text = plainFromRichText(item.title);
    return text || EMPTY_NOTION_TITLE;
  }
  const props = item.properties;
  if (props && typeof props === "object") {
    for (const value of Object.values(props)) {
      if (!value || typeof value !== "object") continue;
      const prop = value as { type?: string; title?: unknown };
      if (prop.type === "title") {
        const text = plainFromRichText(prop.title);
        if (text) return text;
      }
    }
  }
  if (Array.isArray(item.title)) {
    const text = plainFromRichText(item.title);
    if (text) return text;
  }
  return EMPTY_NOTION_TITLE;
}

export function extractBlockText(block: NotionBlock): string {
  const type = typeof block.type === "string" ? block.type : "";
  if (type === "child_page") {
    return typeof block.child_page?.title === "string"
      ? block.child_page.title.trim()
      : "";
  }
  if (type === "child_database") {
    return typeof block.child_database?.title === "string"
      ? block.child_database.title.trim()
      : "";
  }
  if (RICH_TEXT_BLOCK_TYPES.has(type)) {
    const payload = block[type];
    if (!payload || typeof payload !== "object") return "";
    return plainFromRichText((payload as { rich_text?: unknown }).rich_text);
  }
  if (CAPTION_BLOCK_TYPES.has(type)) {
    const payload = block[type];
    if (!payload || typeof payload !== "object") return "";
    return plainFromRichText((payload as { caption?: unknown }).caption);
  }
  if (type === "table_row") {
    const payload = block.table_row;
    if (!payload || typeof payload !== "object") return "";
    const cells = (payload as { cells?: unknown }).cells;
    if (!Array.isArray(cells)) return "";
    return cells
      .map((cell) => plainFromRichText(cell))
      .filter(Boolean)
      .join(" | ");
  }
  if (type === "table") {
    const flat = block.table_flat_text;
    return typeof flat === "string" ? flat.trim() : "";
  }
  return "";
}

/** 32hex / uuid / 노션 URL → dashed page id */
export function notionPageIdFromRef(raw: string): string | null {
  const hex = raw.replace(/-/g, "").match(/[0-9a-fA-F]{32}/)?.[0]?.toLowerCase();
  if (!hex) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function relationIdsFromProperty(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const prop = value as {
    type?: string;
    relation?: Array<{ id?: string }>;
  };
  const ids: string[] = [];
  if (prop.type === "relation" && Array.isArray(prop.relation)) {
    for (const row of prop.relation) {
      if (row?.id) {
        const id = notionPageIdFromRef(row.id);
        if (id) ids.push(id);
      }
    }
  }
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (!/notion\.(so|com)\//i.test(node) && !/^[0-9a-f-]{32,36}$/i.test(node)) {
        return;
      }
      const id = notionPageIdFromRef(node);
      if (id) ids.push(id);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
    }
  };
  visit(value);
  return [...new Set(ids)];
}

/** 관계 속성만 풀어서 저장. 임베딩하지 않는다. */
export function extractNotionRelations(
  pageId: string,
  properties: Record<string, unknown> | null | undefined
): NotionRelationRow[] {
  if (!properties) return [];
  const out: NotionRelationRow[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(properties)) {
    if (!value || typeof value !== "object") continue;
    const type = (value as { type?: string }).type;
    if (type && type !== "relation") continue;
    if (!type && !Array.isArray(value)) continue;
    for (const toId of relationIdsFromProperty(value)) {
      if (toId === pageId) continue;
      const key = `${toId}\0${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        from_page_id: pageId,
        to_page_id: toId,
        property_name: name
      });
    }
  }
  return out;
}

/** table 바로 뒤 table_row 를 표 텍스트로 붙인다. 행 블록 자체도 남긴다. */
export function attachTableFlatText(blocks: NotionBlock[]): NotionBlock[] {
  const flat = new Map<string, string>();
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i]?.type !== "table") continue;
    const rows: string[] = [];
    for (let j = i + 1; j < blocks.length; j += 1) {
      if (blocks[j]?.type !== "table_row") break;
      const text = extractBlockText(blocks[j]!).replace(/\s+/g, " ").trim();
      if (text) rows.push(text);
    }
    if (rows.length > 0 && blocks[i]?.id) flat.set(blocks[i]!.id, rows.join("\n"));
  }
  if (flat.size === 0) return blocks;
  return blocks.map((block) => {
    const text = block.id ? flat.get(block.id) : undefined;
    if (!text) return block;
    return { ...block, table_flat_text: text };
  });
}

export class NotionIndexClient {
  private readonly headers: Record<string, string>;

  constructor(private readonly token: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    };
  }

  private async wait(): Promise<void> {
    await sleep(NOTION_INDEX_RATE_MS);
  }

  async searchAll(): Promise<NotionSearchObject[]> {
    const out: NotionSearchObject[] = [];
    let cursor: string | undefined;
    while (true) {
      const body: Record<string, unknown> = { query: "", page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        throw new Error(`notion search ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        results?: NotionSearchObject[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      out.push(...(data.results ?? []));
      if (!data.has_more) break;
      cursor = data.next_cursor ?? undefined;
      await this.wait();
    }
    return out;
  }

  async fetchMeta(id: string): Promise<NotionSearchObject | null> {
    for (const ep of ["pages", "databases", "blocks"] as const) {
      const res = await fetch(`https://api.notion.com/v1/${ep}/${id}`, {
        headers: this.headers
      });
      if (res.ok) {
        await this.wait();
        return (await res.json()) as NotionSearchObject;
      }
    }
    return null;
  }

  async fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    while (true) {
      const url =
        `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100` +
        (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "");
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) {
        throw new Error(
          `notion blocks ${blockId} ${res.status}: ${(await res.text()).slice(0, 200)}`
        );
      }
      const data = (await res.json()) as {
        results?: NotionBlock[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      out.push(...(data.results ?? []));
      if (!data.has_more) break;
      cursor = data.next_cursor ?? undefined;
      await this.wait();
    }
    return out;
  }

  /** 표·단 안에 들어간 table_row 까지. child_page / child_database 는 별도 페이지라 내려가지 않는다. */
  async fetchPageBlocks(pageId: string): Promise<NotionBlock[]> {
    const top = await this.fetchBlockChildren(pageId);
    const out: NotionBlock[] = [];
    const walk = async (blocks: NotionBlock[]) => {
      for (const block of blocks) {
        out.push(block);
        const type = block.type ?? "";
        if (
          block.has_children &&
          (type === "table" ||
            type === "column_list" ||
            type === "column" ||
            type === "synced_block")
        ) {
          const children = await this.fetchBlockChildren(block.id);
          await walk(children);
        }
      }
    };
    await walk(top);
    return out;
  }

  async queryDatabasePages(databaseId: string): Promise<NotionSearchObject[]> {
    const out: NotionSearchObject[] = [];
    let cursor: string | undefined;
    while (true) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = await fetch(
        `https://api.notion.com/v1/databases/${databaseId}/query`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) {
        const text = (await res.text()).slice(0, 240);
        if (res.status === 404 || res.status === 400) {
          console.warn(`[notion-index] database query skip ${databaseId}: ${text}`);
          return out;
        }
        throw new Error(`notion database ${databaseId} ${res.status}: ${text}`);
      }
      const data = (await res.json()) as {
        results?: NotionSearchObject[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      out.push(...(data.results ?? []));
      if (!data.has_more) break;
      cursor = data.next_cursor ?? undefined;
      await this.wait();
    }
    return out;
  }
}

export async function buildMetaGraph(
  client: NotionIndexClient,
  searchResults: NotionSearchObject[]
): Promise<Map<string, NotionSearchObject>> {
  const meta = new Map<string, NotionSearchObject>();
  for (const item of searchResults) meta.set(item.id, item);

  const pending = new Set<string>();
  const addParent = (item: NotionSearchObject) => {
    const p = item.parent;
    if (!p) return;
    for (const key of ["page_id", "database_id", "block_id"] as const) {
      const id = p[key];
      if (id && !meta.has(id)) pending.add(id);
    }
  };
  for (const item of searchResults) addParent(item);

  while (pending.size > 0) {
    const batch = [...pending];
    pending.clear();
    for (const id of batch) {
      const fetched = await client.fetchMeta(id);
      if (!fetched) {
        meta.set(id, {
          object: "unknown",
          id,
          parent: undefined
        });
        continue;
      }
      meta.set(id, fetched);
      addParent(fetched);
    }
  }
  return meta;
}

export function resolvePagePath(
  pageId: string,
  meta: Map<string, NotionSearchObject>,
  titleOf: (id: string) => string
): { root_title: string | null; path_titles: string[]; depth: number } {
  const path: string[] = [];
  let cur = pageId;
  const seen = new Set<string>();

  for (let i = 0; i < 60; i += 1) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const item = meta.get(cur);
    if (!item) break;
    const title = titleOf(cur);
    if (title && title !== EMPTY_NOTION_TITLE) path.unshift(title);
    const p = item.parent;
    if (!p?.type) break;
    if (p.type === "workspace") break;
    if (p.type === "page_id" && p.page_id) cur = p.page_id;
    else if (p.type === "database_id" && p.database_id) cur = p.database_id;
    else if (p.type === "block_id" && p.block_id) cur = p.block_id;
    else break;
  }

  const root_title = path[0] ?? null;
  const depth = Math.max(0, path.length - 1);
  return { root_title, path_titles: path, depth };
}

export function collectPagesFromSearch(
  searchResults: NotionSearchObject[]
): NotionSearchObject[] {
  const byId = new Map<string, NotionSearchObject>();
  for (const item of searchResults) {
    if (item.object !== "page") continue;
    if (item.archived) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

/**
 * 검색은 빈 쿼리에서도 DB 행을 빠뜨릴 수 있다.
 * 연동에 공유된 database 는 query 로 행을 합친다.
 * 공유되지 않은 DB 는 404 — 그건 연동 공유 문제다.
 */
export async function collectPagesWithDatabaseRows(
  client: NotionIndexClient,
  searchResults: NotionSearchObject[]
): Promise<{ pages: NotionSearchObject[]; databasesQueried: number; added: number }> {
  const byId = new Map<string, NotionSearchObject>();
  for (const page of collectPagesFromSearch(searchResults)) {
    byId.set(page.id, page);
  }
  const databases = searchResults.filter(
    (item) => item.object === "database" && !item.archived
  );
  let added = 0;
  for (const db of databases) {
    const rows = await client.queryDatabasePages(db.id);
    for (const row of rows) {
      if (row.object !== "page" || row.archived) continue;
      if (!byId.has(row.id)) added += 1;
      byId.set(row.id, row);
    }
  }
  return { pages: [...byId.values()], databasesQueried: databases.length, added };
}

export function pageToIndexed(
  page: NotionSearchObject,
  meta: Map<string, NotionSearchObject>
): IndexedPage {
  const titleOf = (id: string) => {
    const item = meta.get(id);
    return item ? extractNotionTitle(item) : EMPTY_NOTION_TITLE;
  };
  const path = resolvePagePath(page.id, meta, titleOf);
  const parent = page.parent;
  const parent_type = parent?.type ?? null;
  const parent_id =
    parent?.page_id ?? parent?.database_id ?? parent?.block_id ?? null;

  return {
    page_id: page.id,
    title: extractNotionTitle(page),
    parent_type,
    parent_id,
    root_title: path.root_title,
    path_titles: path.path_titles,
    depth: path.depth,
    nas_path: null,
    url: page.url ?? null,
    object_type: page.object,
    archived: Boolean(page.archived),
    last_edited_time: page.last_edited_time ?? null,
    properties:
      page.properties && typeof page.properties === "object"
        ? page.properties
        : null
  };
}

export function blocksToIndexed(pageId: string, blocks: NotionBlock[]): IndexedBlock[] {
  const withTables = attachTableFlatText(blocks);
  const out: IndexedBlock[] = [];
  withTables.forEach((block, position) => {
    const text = extractBlockText(block).replace(/\s+/g, " ").trim();
    const block_id = block.id;
    if (!block_id) return;
    out.push({
      block_id,
      page_id: pageId,
      block_type: block.type ?? "unknown",
      text,
      position,
      content_hash: contentHash(text)
    });
  });
  return out;
}

export function firstNasPath(texts: string[]): string | null {
  for (const text of texts) {
    const paths = extractWorkserverPathsFromText(text);
    if (paths[0]) return paths[0];
  }
  return null;
}

export async function createEmbeddingsBatch(
  texts: string[]
): Promise<{ vectors: (number[] | null)[]; tokens: number }> {
  const key = openaiApiKey();
  if (!key || texts.length === 0) {
    if (!key && texts.length > 0) {
      console.error(
        "[luna/notion-index] LUNA_OPENAI_API_KEY / OPENAI_API_KEY 를 찾을 수 없어 임베딩을 건너뜁니다"
      );
    }
    return { vectors: texts.map(() => null), tokens: 0 };
  }
  const input = texts.map((t) => t.replace(/\s+/g, " ").trim().slice(0, 8000));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input
    })
  });
  if (!res.ok) {
    throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    usage?: { total_tokens?: number };
  };
  const vectors: (number[] | null)[] = texts.map(() => null);
  for (const row of json.data ?? []) {
    const idx = row.index ?? 0;
    const vec = row.embedding;
    if (
      Array.isArray(vec) &&
      vec.length === EMBEDDING_DIMS &&
      idx >= 0 &&
      idx < vectors.length
    ) {
      vectors[idx] = vec;
    }
  }
  return { vectors, tokens: json.usage?.total_tokens ?? 0 };
}

/** text-embedding-3-small: $0.02 / 1M tokens (2024 pricing) */
export function estimateEmbeddingCostUsd(tokens: number): number {
  return (tokens / 1_000_000) * 0.02;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
