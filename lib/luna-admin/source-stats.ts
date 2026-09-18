import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstOvernightJobBounds, kstParts } from "@/lib/luna/eval-schedule";
import { kstDayBounds } from "@/lib/luna/selfstudy";
import { ADMIN_REPORT_HOUR, ADMIN_REPORT_MINUTE } from "@/lib/luna-admin/schedule";
import { formatKstShort } from "@/lib/luna-admin/period";
import {
  IMAGE_AFTER_EXCLUDE,
  IMAGE_CORPUS_TOTAL,
  IMAGE_SCAN_TOTAL,
  IMAGE_UNREAD
} from "@/lib/luna-admin/primary-constants";
import type { PrimaryNotionDbRow } from "@/lib/luna-admin/types";

export type SourceKind = "work" | "notion" | "wiki" | "glossary";

export type SourceStatsByKind = Record<string, unknown>;

export type SourceStatsRow = {
  day: string;
  source: SourceKind;
  total: number;
  by_kind: SourceStatsByKind;
  delta: Record<string, number>;
  computed_at: string;
};

export type SourceStatsPack = {
  day: string;
  computed_at: string;
  from_snapshot: boolean;
  query_ms: number;
  work: SourceStatsRow;
  notion: SourceStatsRow;
  wiki: SourceStatsRow;
  glossary: SourceStatsRow;
};

const SOURCES: SourceKind[] = ["work", "notion", "wiki", "glossary"];

function kstToday(): string {
  const p = kstParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function countHead(
  admin: SupabaseClient,
  table: string,
  filter?: { eq?: [string, string | boolean]; contains?: [string, string[]]; is?: [string, null] }
): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter?.contains) q = q.contains(filter.contains[0], filter.contains[1]);
  else if (filter?.eq) q = q.eq(filter.eq[0], filter.eq[1]);
  if (filter?.is) q = q.is(filter.is[0], filter.is[1]);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

async function countYesterday(
  admin: SupabaseClient,
  table: string,
  column: string,
  startIso: string,
  endIso: string,
  filter?: { eq: [string, string] }
): Promise<number> {
  let q = admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(column, startIso)
    .lt(column, endIso);
  if (filter?.eq) q = q.eq(filter.eq[0], filter.eq[1]);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

function asTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function sectionCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === "object") return Object.keys(raw as object).length;
  return 0;
}

async function notionDbRows(admin: SupabaseClient): Promise<PrimaryNotionDbRow[]> {
  const groups = new Map<
    string,
    { name: string; path_label: string; pages: number; last: string | null }
  >();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title, parent_id, parent_type, path_titles, indexed_at")
      .eq("parent_type", "database_id")
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as Array<{
      title: string | null;
      parent_id: string | null;
      path_titles: unknown;
      indexed_at: string | null;
    }>;
    for (const page of rows) {
      const dbId = page.parent_id ?? "";
      if (!dbId) continue;
      const titles = asTitles(page.path_titles);
      const name = titles.length >= 2 ? titles[titles.length - 2]! : (page.title ?? "DB");
      const path_label = titles.slice(0, -1).join(" › ") || "—";
      const cur = groups.get(dbId) ?? { name, path_label, pages: 0, last: null };
      cur.pages += 1;
      if (page.indexed_at && (!cur.last || page.indexed_at > cur.last)) cur.last = page.indexed_at;
      groups.set(dbId, cur);
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return [...groups.entries()]
    .map(([database_id, g]) => ({
      database_id,
      name: g.name,
      path_label: g.path_label,
      pages: g.pages,
      relations: 0,
      last_label: formatKstShort(g.last),
      empty: g.pages === 0
    }))
    .sort((a, b) => b.pages - a.pages);
}

export async function computeSourceStats(
  admin: SupabaseClient,
  opts?: { includeDbs?: boolean }
): Promise<{
  day: string;
  computed_at: string;
  rows: SourceStatsRow[];
  query_ms: number;
}> {
  const t0 = Date.now();
  const day = kstToday();
  const yesterday = kstDayBounds(new Date(Date.now() - 86_400_000));
  const overnight = kstOvernightJobBounds(
    new Date(),
    ADMIN_REPORT_HOUR,
    ADMIN_REPORT_MINUTE
  );

  const [
    nasAll,
    nasFolders,
    nasFiles,
    foldersT,
    foldersP,
    filesT,
    filesP,
    textAll,
    textOk,
    textEmpty,
    textSkipped,
    textFailed,
    unreadHwp,
    unreadDrawing,
    chunkCount,
    notionPages,
    notionBlocks,
    notionChunks,
    notionEmbeds,
    notionRels,
    wikiCount,
    wikiMenus,
    glossaryCount,
    glossCommon,
    glossSpace,
    imageCount,
    yWorkFiles,
    yWorkText,
    yNotion,
    yNotionChunks,
    yImage,
    yWiki,
    yGloss,
    wikiDocs,
    glossRows,
    dbRows
  ] = await Promise.all([
    countHead(admin, "nas_directory"),
    countHead(admin, "nas_directory", { eq: ["type", "folder"] }),
    countHead(admin, "nas_directory", { eq: ["type", "file"] }),
    admin
      .from("nas_directory")
      .select("*", { count: "exact", head: true })
      .eq("type", "folder")
      .eq("drive", "T")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    admin
      .from("nas_directory")
      .select("*", { count: "exact", head: true })
      .eq("type", "folder")
      .eq("drive", "P")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    admin
      .from("nas_directory")
      .select("*", { count: "exact", head: true })
      .eq("type", "file")
      .eq("drive", "T")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    admin
      .from("nas_directory")
      .select("*", { count: "exact", head: true })
      .eq("type", "file")
      .eq("drive", "P")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    countHead(admin, "nas_file_text"),
    countHead(admin, "nas_file_text", { eq: ["status", "ok"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "empty"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "skipped"] }),
    countHead(admin, "nas_file_text", { eq: ["status", "failed"] }),
    admin
      .from("nas_file_text")
      .select("*", { count: "exact", head: true })
      .eq("skip_reason", "hwp")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    admin
      .from("nas_file_text")
      .select("*", { count: "exact", head: true })
      .eq("skip_reason", "drawing_pdf")
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    countHead(admin, "nas_file_chunks"),
    countHead(admin, "luna_notion_pages"),
    countHead(admin, "luna_notion_blocks"),
    countHead(admin, "luna_notion_chunks"),
    countHead(admin, "luna_notion_chunk_embeddings"),
    countHead(admin, "luna_notion_relations"),
    countHead(admin, "luna_library"),
    countHead(admin, "luna_wiki_menus", { eq: ["is_active", true] }),
    admin
      .from("glossary_terms")
      .select("*", { count: "exact", head: true })
      .then((r) => (r.error ? 0 : (r.count ?? 0))),
    countHead(admin, "glossary_terms", { contains: ["categories", ["공통"]] }),
    countHead(admin, "glossary_terms", { contains: ["categories", ["공간"]] }),
    countHead(admin, "luna_media_index"),
    countYesterday(
      admin,
      "nas_directory",
      "modified_at",
      overnight.startIso,
      overnight.endIso,
      { eq: ["type", "file"] }
    ),
    countYesterday(admin, "nas_file_text", "extracted_at", overnight.startIso, overnight.endIso),
    countYesterday(admin, "luna_notion_pages", "indexed_at", overnight.startIso, overnight.endIso),
    countYesterday(
      admin,
      "luna_notion_chunk_embeddings",
      "updated_at",
      overnight.startIso,
      overnight.endIso
    ),
    countYesterday(admin, "luna_media_index", "indexed_at", overnight.startIso, overnight.endIso),
    countYesterday(admin, "luna_library", "created_at", yesterday.startIso, yesterday.endIso),
    countYesterday(admin, "glossary_terms", "created_at", yesterday.startIso, yesterday.endIso),
    admin.from("luna_library").select("sections"),
    admin.from("glossary_terms").select("synonyms"),
    opts?.includeDbs ? notionDbRows(admin) : Promise.resolve([])
  ]);

  const wikiSections = ((wikiDocs.data ?? []) as Array<{ sections: unknown }>).reduce(
    (n, row) => n + sectionCount(row.sections),
    0
  );
  const synonymCount = ((glossRows.data ?? []) as Array<{ synonyms: string[] | null }>).reduce(
    (n, row) => n + (Array.isArray(row.synonyms) ? row.synonyms.length : 0),
    0
  );
  const unread = textSkipped + textEmpty + textFailed;
  const computed_at = new Date().toISOString();

  const work: SourceStatsRow = {
    day,
    source: "work",
    total: nasAll,
    by_kind: {
      folders: nasFolders,
      folders_t: foldersT,
      folders_p: foldersP,
      files: nasFiles,
      files_t: filesT,
      files_p: filesP,
      docs: textOk,
      chunks: chunkCount,
      unread,
      unread_hwp: unreadHwp,
      unread_drawing: unreadDrawing,
      text_all: textAll,
      text_ok: textOk,
      text_empty: textEmpty,
      text_skipped: textSkipped,
      text_failed: textFailed,
      images: imageCount,
      image_corpus: IMAGE_CORPUS_TOTAL,
      image_scan: IMAGE_SCAN_TOTAL,
      image_after_exclude: IMAGE_AFTER_EXCLUDE,
      image_unread: IMAGE_UNREAD
    },
    delta: {
      files: yWorkFiles,
      docs: yWorkText,
      chunks: 0,
      images: yImage,
      unread: 0
    },
    computed_at
  };

  const notion: SourceStatsRow = {
    day,
    source: "notion",
    total: notionPages,
    by_kind: {
      pages: notionPages,
      blocks: notionBlocks,
      chunks: notionChunks,
      embeddings: notionEmbeds,
      relations: notionRels,
      databases: dbRows.length,
      db_rows: dbRows
    },
    delta: {
      pages: yNotion,
      chunks: yNotionChunks,
      blocks: 0,
      relations: 0
    },
    computed_at
  };

  const wiki: SourceStatsRow = {
    day,
    source: "wiki",
    total: wikiCount,
    by_kind: {
      docs: wikiCount,
      sections: wikiSections,
      menus: wikiMenus || 7
    },
    delta: { docs: yWiki },
    computed_at
  };

  const glossary: SourceStatsRow = {
    day,
    source: "glossary",
    total: glossaryCount,
    by_kind: {
      terms: glossaryCount,
      synonyms: synonymCount,
      cat_common: glossCommon,
      cat_space: glossSpace
    },
    delta: { terms: yGloss },
    computed_at
  };

  return {
    day,
    computed_at,
    rows: [work, notion, wiki, glossary],
    query_ms: Date.now() - t0
  };
}

export async function storeSourceStats(
  admin: SupabaseClient,
  pack: { day: string; computed_at: string; rows: SourceStatsRow[] }
): Promise<void> {
  const { error } = await admin.from("luna_source_stats").upsert(
    pack.rows.map((row) => ({
      day: pack.day,
      source: row.source,
      total: row.total,
      by_kind: row.by_kind,
      delta: row.delta,
      computed_at: pack.computed_at
    })),
    { onConflict: "day,source" }
  );
  if (error) throw new Error(`luna_source_stats: ${error.message}`);
}

export async function computeAndStoreSourceStats(admin: SupabaseClient): Promise<{
  day: string;
  computed_at: string;
  query_ms: number;
  sources: number;
}> {
  const pack = await computeSourceStats(admin, { includeDbs: true });
  await storeSourceStats(admin, pack);
  return {
    day: pack.day,
    computed_at: pack.computed_at,
    query_ms: pack.query_ms,
    sources: pack.rows.length
  };
}

function parseJsonMap(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function asRow(raw: Record<string, unknown>): SourceStatsRow | null {
  const source = raw.source;
  if (source !== "work" && source !== "notion" && source !== "wiki" && source !== "glossary") {
    return null;
  }
  const by_kind = parseJsonMap(raw.by_kind);
  const deltaRaw = parseJsonMap(raw.delta);
  const delta: Record<string, number> = {};
  for (const [k, v] of Object.entries(deltaRaw)) delta[k] = num(v);
  return {
    day: String(raw.day ?? ""),
    source,
    total: num(raw.total),
    by_kind,
    delta,
    computed_at: String(raw.computed_at ?? "")
  };
}

export async function loadLatestSourceStats(
  admin: SupabaseClient
): Promise<SourceStatsPack | null> {
  const t0 = Date.now();
  const { data, error } = await admin
    .from("luna_source_stats")
    .select("day, source, total, by_kind, delta, computed_at")
    .order("day", { ascending: false })
    .limit(8);
  if (error || !data || data.length === 0) return null;
  const latestDay = String((data[0] as { day: string }).day);
  const mapped = (data as Array<Record<string, unknown>>)
    .map(asRow)
    .filter((row): row is SourceStatsRow => !!row && row.day === latestDay);
  const by = Object.fromEntries(mapped.map((r) => [r.source, r])) as Partial<
    Record<SourceKind, SourceStatsRow>
  >;
  if (!SOURCES.every((s) => by[s])) return null;
  return {
    day: latestDay,
    computed_at: mapped[0]?.computed_at ?? "",
    from_snapshot: true,
    query_ms: Date.now() - t0,
    work: by.work!,
    notion: by.notion!,
    wiki: by.wiki!,
    glossary: by.glossary!
  };
}

export async function loadOrComputeSourceStats(
  admin: SupabaseClient
): Promise<SourceStatsPack> {
  const existing = await loadLatestSourceStats(admin);
  if (existing) return existing;
  const pack = await computeSourceStats(admin);
  try {
    await storeSourceStats(admin, pack);
  } catch (err) {
    console.error("[luna-admin/source-stats] store", err);
  }
  const by = Object.fromEntries(pack.rows.map((r) => [r.source, r])) as Record<
    SourceKind,
    SourceStatsRow
  >;
  return {
    day: pack.day,
    computed_at: pack.computed_at,
    from_snapshot: false,
    query_ms: pack.query_ms,
    work: by.work,
    notion: by.notion,
    wiki: by.wiki,
    glossary: by.glossary
  };
}

export function kindNum(row: SourceStatsRow | undefined, key: string): number {
  if (!row) return 0;
  const direct = num(row.by_kind[key]);
  if (direct !== 0) return direct;
  const aliases: Record<string, string[]> = {
    chunks: ["chunk_count", "chunk"],
    docs: ["text_ok", "ok"],
    folders: ["folder"]
  };
  for (const alt of aliases[key] ?? []) {
    const n = num(row.by_kind[alt]);
    if (n !== 0) return n;
  }
  return direct;
}

export function deltaNum(row: SourceStatsRow | undefined, key: string): number {
  if (!row) return 0;
  return num(row.delta[key]);
}
