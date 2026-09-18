import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPeriod, formatKstDate, formatKstShort, resolvePeriod } from "@/lib/luna-admin/period";
import type {
  PrimaryNotionChunk,
  PrimaryNotionDbRow,
  PrimaryNotionPageRow,
  PrimaryNotionPayload,
  PrimaryNotionRel,
  PrimaryNotionSort,
  PrimaryNotionView
} from "@/lib/luna-admin/types";

export const NOTION_PAGE_SIZE = 15;

const SORT_COL: Record<Exclude<PrimaryNotionSort, "blocks" | "chunks" | "rels">, string> = {
  title: "title",
  db: "root_title",
  edited: "last_edited_time",
  indexed: "indexed_at"
};

function isView(v: string | null): v is PrimaryNotionView {
  return v === "pages" || v === "dbs";
}

function isSort(v: string | null): v is PrimaryNotionSort {
  return (
    v === "title" ||
    v === "db" ||
    v === "blocks" ||
    v === "chunks" ||
    v === "rels" ||
    v === "edited" ||
    v === "indexed"
  );
}

function asTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function dbNameOf(pathTitles: unknown, title: string | null): string {
  const titles = asTitles(pathTitles);
  if (titles.length >= 2) return titles[titles.length - 2]!;
  return title || "DB";
}

function countById(rows: Array<{ page_id: string }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.page_id, (map.get(row.page_id) ?? 0) + 1);
  }
  return map;
}

async function countsForPages(
  admin: SupabaseClient,
  ids: string[]
): Promise<{ blocks: Map<string, number>; chunks: Map<string, number>; rels: Map<string, number> }> {
  if (ids.length === 0) {
    return { blocks: new Map(), chunks: new Map(), rels: new Map() };
  }
  const [blocksRes, chunksRes, fromRes, toRes] = await Promise.all([
    admin.from("luna_notion_blocks").select("page_id").in("page_id", ids),
    admin.from("luna_notion_chunks").select("page_id").in("page_id", ids),
    admin.from("luna_notion_relations").select("from_page_id").in("from_page_id", ids),
    admin.from("luna_notion_relations").select("to_page_id").in("to_page_id", ids)
  ]);
  const blocks = countById((blocksRes.data ?? []) as Array<{ page_id: string }>);
  const chunks = countById((chunksRes.data ?? []) as Array<{ page_id: string }>);
  const rels = new Map<string, number>();
  for (const row of (fromRes.data ?? []) as Array<{ from_page_id: string }>) {
    rels.set(row.from_page_id, (rels.get(row.from_page_id) ?? 0) + 1);
  }
  for (const row of (toRes.data ?? []) as Array<{ to_page_id: string }>) {
    rels.set(row.to_page_id, (rels.get(row.to_page_id) ?? 0) + 1);
  }
  return { blocks, chunks, rels };
}

export async function loadPrimaryNotion(
  admin: SupabaseClient,
  params: {
    db: string | null;
    page: string | null;
    pageId: string | null;
    view: string | null;
    period: string | null;
    from: string | null;
    to: string | null;
    sort: string | null;
    dir: string | null;
    allChunks?: boolean;
  }
): Promise<PrimaryNotionPayload> {
  const t0 = Date.now();
  const view: PrimaryNotionView = isView(params.view) ? params.view : "pages";
  const sort: PrimaryNotionSort = isSort(params.sort) ? params.sort : "indexed";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const period = resolvePeriod(params.period, params.from, params.to);
  const dbId = params.db;
  const from = (page - 1) * NOTION_PAGE_SIZE;
  const to = from + NOTION_PAGE_SIZE - 1;

  let dbs: PrimaryNotionDbRow[] = [];
  if (view === "dbs") {
    const { loadLatestSourceStats } = await import("@/lib/luna-admin/source-stats");
    const stats = await loadLatestSourceStats(admin);
    const raw = stats?.notion.by_kind.db_rows;
    if (Array.isArray(raw)) {
      dbs = raw.filter((x): x is PrimaryNotionDbRow => {
        if (!x || typeof x !== "object") return false;
        return typeof (x as { database_id?: unknown }).database_id === "string";
      });
    }
  }

  let pages: PrimaryNotionPageRow[] = [];
  let page_total = 0;
  if (view === "pages") {
    const orderCol =
      sort === "blocks" || sort === "chunks" || sort === "rels"
        ? "indexed_at"
        : SORT_COL[sort];
    let q = admin
      .from("luna_notion_pages")
      .select(
        "page_id, title, parent_id, path_titles, root_title, last_edited_time, indexed_at",
        { count: "exact" }
      )
      .order(orderCol, { ascending: dir === "asc", nullsFirst: false })
      .range(from, to);
    if (dbId) q = q.eq("parent_id", dbId);
    q = applyPeriod(q, "indexed_at", period);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    page_total = count ?? 0;
    const rawPages = (data ?? []) as Array<{
      page_id: string;
      title: string | null;
      parent_id: string | null;
      path_titles: unknown;
      last_edited_time: string | null;
      indexed_at: string | null;
    }>;
    const ids = rawPages.map((p) => p.page_id);
    const counts = await countsForPages(admin, ids);
    pages = rawPages.map((p) => ({
      page_id: p.page_id,
      title: p.title || "(제목 없음)",
      path_label: asTitles(p.path_titles).join(" › "),
      db_name: dbNameOf(p.path_titles, p.title),
      last_label: formatKstShort(p.indexed_at),
      edited_label: formatKstDate(p.last_edited_time),
      block_count: counts.blocks.get(p.page_id) ?? 0,
      chunk_count: counts.chunks.get(p.page_id) ?? 0,
      rel_count: counts.rels.get(p.page_id) ?? 0
    }));
    if (sort === "blocks" || sort === "chunks" || sort === "rels") {
      const key =
        sort === "blocks" ? "block_count" : sort === "chunks" ? "chunk_count" : "rel_count";
      pages = [...pages].sort((a, b) =>
        dir === "asc" ? a[key] - b[key] : b[key] - a[key]
      );
    }
  }

  let chunks: PrimaryNotionChunk[] = [];
  let chunk_total = 0;
  let relations: PrimaryNotionRel[] = [];
  if (params.pageId) {
    const chunkLimit = params.allChunks ? 80 : 3;
    const { data, error } = await admin
      .from("luna_notion_chunks")
      .select("heading, text, position, block_ids")
      .eq("page_id", params.pageId)
      .order("position", { ascending: true })
      .limit(chunkLimit);
    if (error) throw new Error(error.message);
    chunks = ((data ?? []) as Array<{
      heading: string;
      text: string;
      position: number;
      block_ids: unknown;
    }>).map((c, i) => {
      const blocks = Array.isArray(c.block_ids) ? c.block_ids.length : 0;
      return {
        seq: c.position + 1 || i + 1,
        heading: c.heading || (blocks ? `블록 ${blocks}개` : ""),
        content: c.text || ""
      };
    });
    const { count } = await admin
      .from("luna_notion_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("page_id", params.pageId);
    chunk_total = count ?? chunks.length;

    const [fromRels, toRels] = await Promise.all([
      admin
        .from("luna_notion_relations")
        .select("from_page_id, to_page_id, property_name")
        .eq("from_page_id", params.pageId),
      admin
        .from("luna_notion_relations")
        .select("from_page_id, to_page_id, property_name")
        .eq("to_page_id", params.pageId)
    ]);
    const relRows = [
      ...((fromRels.data ?? []) as Array<{
        from_page_id: string;
        to_page_id: string;
        property_name: string;
      }>),
      ...((toRels.data ?? []) as Array<{
        from_page_id: string;
        to_page_id: string;
        property_name: string;
      }>)
    ];
    const otherIds = [
      ...new Set(
        relRows.map((r) => (r.from_page_id === params.pageId ? r.to_page_id : r.from_page_id))
      )
    ];
    const titles = new Map<string, string>();
    if (otherIds.length > 0) {
      const { data: titleRows } = await admin
        .from("luna_notion_pages")
        .select("page_id, title")
        .in("page_id", otherIds);
      for (const row of (titleRows ?? []) as Array<{ page_id: string; title: string | null }>) {
        titles.set(row.page_id, row.title || "(제목 없음)");
      }
    }
    relations = relRows.map((r) => {
      const other = r.from_page_id === params.pageId ? r.to_page_id : r.from_page_id;
      return {
        page_id: other,
        title: titles.get(other) || other,
        property_name: r.property_name || "관계"
      };
    });
  }

  return {
    view,
    period: period.key,
    sort,
    dir,
    dbs,
    db_count: dbs.length,
    pages,
    page_total,
    page,
    page_size: NOTION_PAGE_SIZE,
    selected_db: dbId,
    chunks,
    chunk_total,
    relations,
    from_label: period.from_label,
    to_label: period.to_label,
    query_ms: Date.now() - t0
  };
}
