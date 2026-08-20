import { createHash, randomUUID } from "crypto";
import {
  contentHash,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL
} from "@/lib/luna/embedding";
import { extractWorkserverPathsFromText } from "@/lib/luna/notion";

export const NOTION_INDEX_RATE_MS = 350;
export const NOTION_INDEX_MIN_EMBED_CHARS = 15;
export const NOTION_INDEX_INSERT_BATCH = 500;
export const NOTION_INDEX_EMBED_BATCH = 100;
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
  return "";
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

  async fetchPageBlocks(pageId: string): Promise<NotionBlock[]> {
    const out: NotionBlock[] = [];
    let cursor: string | undefined;
    while (true) {
      const url =
        `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100` +
        (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "");
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) {
        throw new Error(
          `notion blocks ${pageId} ${res.status}: ${(await res.text()).slice(0, 200)}`
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
}

export async function buildMetaGraph(
  client: NotionIndexClient,
  searchResults: NotionSearchObject[]
): Promise<Map<string, NotionSearchObject>> {
  const meta = new Map<string, NotionSearchObject>();
  for (const item of searchResults) meta.set(item.id, item);

  let pending = new Set<string>();
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
    last_edited_time: page.last_edited_time ?? null
  };
}

export function blocksToIndexed(pageId: string, blocks: NotionBlock[]): IndexedBlock[] {
  const out: IndexedBlock[] = [];
  blocks.forEach((block, position) => {
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
  const key = process.env.LUNA_OPENAI_API_KEY?.trim();
  if (!key || texts.length === 0) {
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
