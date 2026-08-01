import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkserverItem = {
  drive: string | null;
  path: string;
  name: string;
  type: string | null;
  importance: number | null;
  file_summary: string | null;
};

type NasRow = {
  drive: string | null;
  path: string;
  type: string | null;
  size_bytes: number | null;
  modified_at: string | null;
  file_summary: string | null;
  importance: number | null;
};

const NAS_SELECT =
  "drive, path, type, size_bytes, modified_at, file_summary, importance";

function normalizeWsPath(path: string): string {
  return path.replace(/\//g, "\\").replace(/^\\+|\\+$/g, "");
}

function pathName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function toItem(row: NasRow): WorkserverItem {
  return {
    drive: row.drive,
    path: row.path,
    name: pathName(row.path),
    type: row.type,
    importance: row.importance ?? 0,
    file_summary: row.file_summary
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitKeywords(keywords: string): string[] {
  return keywords
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
}

function haystack(row: NasRow): string {
  return `${row.path}\n${row.file_summary ?? ""}`.toLowerCase();
}

function matchesAll(row: NasRow, terms: string[]): boolean {
  const h = haystack(row);
  return terms.every((t) => h.includes(t.toLowerCase()));
}

function matchesAny(row: NasRow, terms: string[]): boolean {
  const h = haystack(row);
  return terms.some((t) => h.includes(t.toLowerCase()));
}

function rankByImportance(rows: NasRow[]): NasRow[] {
  return [...rows].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0)
  );
}

function underBase(row: NasRow, base: string): boolean {
  if (!base) return true;
  return row.path === base || row.path.startsWith(`${base}\\`);
}

async function fetchCandidates(
  admin: SupabaseClient,
  opts: {
    terms: string[];
    basePath?: string;
    drive?: string;
    limit: number;
  }
): Promise<NasRow[]> {
  let query = admin
    .from("nas_directory")
    .select(NAS_SELECT)
    .order("importance", { ascending: false })
    .limit(opts.limit);

  if (opts.drive) {
    query = query.eq("drive", opts.drive.trim().toUpperCase());
  }

  const base = opts.basePath ? normalizeWsPath(opts.basePath) : "";
  if (base) {
    // Lexicographic range — avoids LIKE (backslash is LIKE escape in Postgres)
    query = query.gte("path", base).lt("path", `${base}\uFFFF`);
  }

  if (opts.terms.length > 0) {
    const orFilter = opts.terms
      .map((t) => `path.ilike.%${t.replace(/[%_,]/g, "")}%`)
      .filter((f) => f.includes(".ilike.%") && !f.endsWith(".ilike.%%"))
      .join(",");
    if (orFilter) {
      query = query.or(orFilter);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/ws] fetchCandidates", error);
    return [];
  }

  const rows = (data ?? []) as NasRow[];
  if (!base) return rows;
  return rows.filter((r) => underBase(r, base));
}

function preferAndThenOr(rows: NasRow[], terms: string[], max: number): NasRow[] {
  if (terms.length === 0) {
    return rankByImportance(rows).slice(0, max);
  }
  const andHits = rows.filter((r) => matchesAll(r, terms));
  const picked = andHits.length > 0 ? andHits : rows.filter((r) => matchesAny(r, terms));
  return rankByImportance(picked).slice(0, max);
}

/** 경로 바로 아래 항목만. path 빈 문자열이면 각 드라이브 최상위. */
export async function listFolder(
  admin: SupabaseClient,
  path: string,
  drive?: string
): Promise<WorkserverItem[]> {
  const base = normalizeWsPath(path || "");
  let query = admin
    .from("nas_directory")
    .select(NAS_SELECT)
    .order("importance", { ascending: false })
    .limit(40);

  if (drive) {
    query = query.eq("drive", drive.trim().toUpperCase());
  }

  if (!base) {
    // 최상위: 경로에 구분자가 없는 항목 (LIKE 미사용 — regex)
    query = query.not("path", "match", "[\\\\/]");
  } else {
    // 한 단계 자식만: ^base\\[^\\]+$
    const pattern = `^${escapeRegExp(base)}\\\\[^\\\\]+$`;
    query = query.filter("path", "match", pattern);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/ws] listFolder", error);
    console.log("[luna/ws]", "listFolder", { path, drive }, "→", 0);
    return [];
  }

  const items = ((data ?? []) as NasRow[]).map(toItem).slice(0, 40);
  console.log("[luna/ws]", "listFolder", { path, drive }, "→", items.length);
  return items;
}

/** basePath 아래에서만 검색. AND 우선, 없으면 OR. */
export async function searchIn(
  admin: SupabaseClient,
  basePath: string,
  keywords: string,
  drive?: string
): Promise<WorkserverItem[]> {
  const terms = splitKeywords(keywords);
  const rows = await fetchCandidates(admin, {
    terms,
    basePath,
    drive,
    limit: 80
  });
  const picked = preferAndThenOr(rows, terms, 10);
  const items = picked.map(toItem);
  console.log(
    "[luna/ws]",
    "searchIn",
    { basePath, keywords, drive },
    "→",
    items.length
  );
  return items;
}

/** 전체 검색. AND 우선, 없으면 OR. */
export async function searchAll(
  admin: SupabaseClient,
  keywords: string
): Promise<WorkserverItem[]> {
  const terms = splitKeywords(keywords);
  const rows = await fetchCandidates(admin, { terms, limit: 80 });
  const picked = preferAndThenOr(rows, terms, 10);
  const items = picked.map(toItem);
  console.log("[luna/ws]", "searchAll", { keywords }, "→", items.length);
  return items;
}

/** 기존 단일 OR 검색 (도구 루프 실패 시 fallback). */
export async function searchNasLegacy(
  admin: SupabaseClient,
  keywords: string
): Promise<NasRow[]> {
  const terms = keywords
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 3);
  if (terms.length === 0) return [];

  const orFilter = terms.map((t) => `path.ilike.%${t}%`).join(",");

  const { data: importantData, error: importantError } = await admin
    .from("nas_directory")
    .select(NAS_SELECT)
    .or(orFilter)
    .gt("importance", 0)
    .order("importance", { ascending: false })
    .limit(4);

  if (importantError) {
    console.error("[luna/ws] searchNasLegacy important", importantError);
  }

  const importantRows = (importantData ?? []) as NasRow[];
  const remain = Math.max(0, 8 - importantRows.length);
  let normalRows: NasRow[] = [];

  if (remain > 0) {
    const { data: normalData, error: normalError } = await admin
      .from("nas_directory")
      .select(NAS_SELECT)
      .or(orFilter)
      .eq("importance", 0)
      .limit(Math.max(remain, 12));
    if (normalError) {
      console.error("[luna/ws] searchNasLegacy normal", normalError);
    } else {
      const importantPaths = new Set(importantRows.map((r) => r.path));
      normalRows = ((normalData ?? []) as NasRow[]).filter(
        (r) => !importantPaths.has(r.path)
      );
    }
  }

  const merged = [...importantRows, ...normalRows];
  console.log(
    "[luna/ws]",
    "searchNasLegacy",
    { keywords },
    "→",
    merged.length
  );
  return merged;
}
