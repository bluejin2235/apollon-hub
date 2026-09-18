import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/luna/eval-schedule";
import type {
  PrimaryNotionChunk,
  PrimaryNotionDbRow,
  PrimaryNotionPageRow,
  PrimaryNotionPayload
} from "@/lib/luna-admin/types";

export const NOTION_PAGE_SIZE = 50;

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  const now = kstParts(new Date());
  const hm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  if (p.year === now.year && p.month === now.month && p.day === now.day) return `오늘 ${hm}`;
  return `${String(p.month).padStart(2, "0")}.${String(p.day).padStart(2, "0")} ${hm}`;
}

function asTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

type PageLite = {
  page_id: string;
  title: string | null;
  parent_id: string | null;
  parent_type: string | null;
  path_titles: unknown;
  indexed_at: string | null;
};

async function fetchDatabasePages(admin: SupabaseClient): Promise<PageLite[]> {
  const out: PageLite[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title, parent_id, parent_type, path_titles, indexed_at")
      .eq("parent_type", "database_id")
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as PageLite[];
    out.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function relationCounts(admin: SupabaseClient): Promise<Map<string, number>> {
  const byPage = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_notion_relations")
      .select("from_page_id")
      .range(from, from + 999);
    if (error) break;
    const rows = (data ?? []) as Array<{ from_page_id: string }>;
    for (const row of rows) {
      byPage.set(row.from_page_id, (byPage.get(row.from_page_id) ?? 0) + 1);
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return byPage;
}

let dbCache: { at: number; dbs: PrimaryNotionDbRow[] } | null = null;

async function loadDbs(admin: SupabaseClient): Promise<PrimaryNotionDbRow[]> {
  if (dbCache && Date.now() - dbCache.at < 5 * 60 * 1000) return dbCache.dbs;
  const [pages, relByPage] = await Promise.all([
    fetchDatabasePages(admin),
    relationCounts(admin)
  ]);
  const groups = new Map<
    string,
    { name: string; path_label: string; pages: number; relations: number; last: string | null }
  >();
  for (const page of pages) {
    const dbId = page.parent_id ?? "";
    if (!dbId) continue;
    const titles = asTitles(page.path_titles);
    const name = titles.length >= 2 ? titles[titles.length - 2]! : (page.title ?? "DB");
    const path_label = titles.slice(0, -1).join(" › ") || "—";
    const cur = groups.get(dbId) ?? {
      name,
      path_label,
      pages: 0,
      relations: 0,
      last: null
    };
    cur.pages += 1;
    cur.relations += relByPage.get(page.page_id) ?? 0;
    if (page.indexed_at && (!cur.last || page.indexed_at > cur.last)) cur.last = page.indexed_at;
    groups.set(dbId, cur);
  }
  const dbs: PrimaryNotionDbRow[] = [...groups.entries()]
    .map(([database_id, g]) => ({
      database_id,
      name: g.name,
      path_label: g.path_label,
      pages: g.pages,
      relations: g.relations,
      last_label: formatWhen(g.last),
      empty: g.pages === 0
    }))
    .sort((a, b) => b.pages - a.pages);
  dbCache = { at: Date.now(), dbs };
  return dbs;
}

export async function loadPrimaryNotion(
  admin: SupabaseClient,
  dbId: string | null,
  rawPage: string | null,
  pageId: string | null
): Promise<PrimaryNotionPayload> {
  const t0 = Date.now();
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const dbs = await loadDbs(admin);
  let pages: PrimaryNotionPageRow[] = [];
  let page_total = 0;
  if (dbId) {
    const from = (page - 1) * NOTION_PAGE_SIZE;
    const to = from + NOTION_PAGE_SIZE - 1;
    const { data, count, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title, path_titles, indexed_at", { count: "exact" })
      .eq("parent_id", dbId)
      .order("indexed_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    page_total = count ?? 0;
    pages = ((data ?? []) as PageLite[]).map((p) => ({
      page_id: p.page_id,
      title: p.title || "(제목 없음)",
      path_label: asTitles(p.path_titles).join(" › "),
      last_label: formatWhen(p.indexed_at)
    }));
  }

  let chunks: PrimaryNotionChunk[] = [];
  let chunk_total = 0;
  if (pageId) {
    const { data, error } = await admin
      .from("luna_notion_chunks")
      .select("heading, text, position")
      .eq("page_id", pageId)
      .order("position", { ascending: true })
      .limit(3);
    if (error) throw new Error(error.message);
    chunks = ((data ?? []) as Array<{ heading: string; text: string; position: number }>).map(
      (c, i) => ({
        seq: c.position + 1 || i + 1,
        heading: c.heading || "",
        content: c.text || ""
      })
    );
    const { count } = await admin
      .from("luna_notion_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("page_id", pageId);
    chunk_total = count ?? chunks.length;
  }

  return {
    dbs,
    db_count: dbs.length,
    pages,
    page_total,
    page,
    page_size: NOTION_PAGE_SIZE,
    selected_db: dbId,
    chunks,
    chunk_total,
    query_ms: Date.now() - t0
  };
}
