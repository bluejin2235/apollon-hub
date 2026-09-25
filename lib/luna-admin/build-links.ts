import { loadProductionPerspectiveMessages, obsoletePerspectiveUsageIds } from "@/lib/luna-admin/perspective-messages";
/**
 * 2차 데이터 생성 — 규칙 중심. LLM 은 same 의 0.45~0.6 만.
 * 스크립트에서도 import 하므로 server-only 를 쓰지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LINK_ASK_MIN, LINK_AUTO_SAVE } from "@/lib/luna-admin/confidence";
import {
  decideSame,
  extractDateCode,
  firstSubfolderLabel,
  fullNasPath,
  haikuUsd,
  HUMAN_SAME_PAIRS,
  LLM_MAX_CALLS,
  parseWorkFolder,
  projectFromFullPath,
  projectOfNasPath,
  skipInspirePair,
  statusFromConfidence,
  stripDateCode,
  trigramSimilarity,
  yearFromDateCode,
  yearFromPath,
  type WorkFolder
} from "@/lib/luna-admin/link-parse";
import { questionDedupeKey } from "@/lib/luna-admin/pair-view";
import {
  classifyNotionRelationProperty,
  isBdToProjectFollowPair,
  type ClassifiedNotionRelation
} from "@/lib/luna-admin/notion-relation-kinds";

export type BuildKind = "belongs" | "follows" | "same" | "perspectives";

export type BuildLinksOptions = {
  year?: number;
  kind?: BuildKind;
  dryRun?: boolean;
  log?: (msg: string) => void;
};

export type KindCount = {
  scanned: number;
  inserted: number;
  skipped: number;
  would: number;
};

export type BuildLinksReport = {
  elapsed_ms: number;
  dryRun: boolean;
  year: number | null;
  kind: BuildKind | "all";
  belongs: KindCount & {
    nas_files: number;
    nas_bundles: number;
    images: number;
    notion_pages: number;
    notion_relations: number;
  };
  follows: KindCount & {
    nas_name: number;
    notion_relations: number;
    dual_source: number;
    reclassified_from_belongs: number;
  };
  same: KindCount & {
    human: number;
    auto: number;
    asked: number;
    dropped: number;
  };
  perspectives: KindCount & { top: Array<{ name: string; hit_count: number }> };
  questions: number;
  llm_calls: number;
  llm_aborted: boolean;
  llm_remaining: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_usd: number;
};

type NasRow = { drive: string; path: string; type: string };
type NotionPage = {
  page_id: string;
  title: string;
  nas_path: string | null;
  path_titles: string[] | null;
  root_title: string | null;
};
type MediaRow = { path: string; project: string | null; description: string | null };
type RelationRow = {
  from_page_id: string;
  to_page_id: string;
  property_name: string;
};
type GlossaryRow = {
  term_ko: string;
  term_en: string | null;
  synonyms: unknown;
  deleted_at: string | null;
};

type LinkDraft = {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  kind: "same" | "belongs" | "follows";
  confidence: number;
  evidence: Record<string, unknown>;
  source: "rule" | "llm" | "human";
  status: "active" | "pending" | "rejected";
  confirmed_by?: string | null;
  confirmed_at?: string | null;
};

function linkKey(row: {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  kind: string;
}): string {
  return `${row.from_type}\t${row.from_id}\t${row.to_type}\t${row.to_id}\t${row.kind}`;
}

function emptyKind(): KindCount {
  return { scanned: 0, inserted: 0, skipped: 0, would: 0 };
}

async function fetchAll<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadExistingKeys(admin: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  let from = 0;
  const size = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("from_type, from_id, to_type, to_id, kind")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(`luna_links existing: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      keys.add(
        linkKey({
          from_type: String(row.from_type),
          from_id: String(row.from_id),
          to_type: String(row.to_type),
          to_id: String(row.to_id),
          kind: String(row.kind)
        })
      );
    }
    if (rows.length < size) break;
    from += size;
  }
  return keys;
}

async function insertLinks(
  admin: SupabaseClient,
  rows: LinkDraft[],
  existing: Set<string>,
  dryRun: boolean,
  log: (msg: string) => void
): Promise<KindCount> {
  const count: KindCount = emptyKind();
  count.scanned = rows.length;
  const fresh: LinkDraft[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const k = linkKey(row);
    if (existing.has(k) || seen.has(k)) count.skipped += 1;
    else {
      seen.add(k);
      fresh.push(row);
    }
  }
  count.would = fresh.length;
  if (dryRun || fresh.length === 0) return count;

  const batchSize = 200;
  for (let i = 0; i < fresh.length; i += batchSize) {
    const batch = fresh.slice(i, i + batchSize);
    const { error } = await admin.from("luna_links").upsert(
      batch.map((row) => ({
        from_type: row.from_type,
        from_id: row.from_id,
        to_type: row.to_type,
        to_id: row.to_id,
        kind: row.kind,
        confidence: row.confidence,
        evidence: row.evidence,
        source: row.source,
        status: row.status,
        confirmed_by: row.confirmed_by ?? null,
        confirmed_at: row.confirmed_at ?? null
      })),
      {
        onConflict: "from_type,from_id,to_type,to_id,kind",
        ignoreDuplicates: true
      }
    );
    if (error) throw new Error(`luna_links insert: ${error.message}`);
    for (const row of batch) existing.add(linkKey(row));
    count.inserted += batch.length;
    if (fresh.length > batchSize) {
      log(`  insert ${Math.min(i + batch.length, fresh.length)}/${fresh.length}`);
    }
  }
  return count;
}

function yearOk(year: string | null | undefined, filter?: number): boolean {
  if (!filter) return true;
  if (!year) return false;
  return Number(year) === filter;
}

function uniqueWorkFolders(nas: NasRow[]): WorkFolder[] {
  const map = new Map<string, WorkFolder>();
  for (const row of nas) {
    const parsed = parseWorkFolder(row.drive, row.path);
    if (!parsed) continue;
    if (!map.has(parsed.fullPath)) map.set(parsed.fullPath, parsed);
  }
  return [...map.values()];
}

function notionProjectHint(page: NotionPage): {
  project: string | null;
  year: string | null;
  path: string;
} {
  if (page.nas_path) {
    const folder = projectFromFullPath(page.nas_path);
    if (folder) {
      return {
        project: folder.project,
        year: folder.year,
        path: page.nas_path
      };
    }
  }
  const titles = [page.title, ...(page.path_titles ?? [])];
  for (const t of titles) {
    const m = String(t ?? "").trim().match(/^(\d{6})\s+\S/);
    if (m) {
      return {
        project: String(t).trim(),
        year: yearFromDateCode(m[1]!) ?? yearFromPath(String(t)),
        path: (page.path_titles ?? []).join(" › ")
      };
    }
  }
  return { project: null, year: yearFromPath(page.title), path: "" };
}

function pickNotionPage(pages: NotionPage[], needle: string): NotionPage | null {
  const n = needle.trim();
  const nl = n.toLowerCase();
  const rank = (p: NotionPage) => {
    const root = p.root_title ?? "";
    if (root === "[진행 중] 프로젝트") return 0;
    if (root === "[진행 중] 사업개발") return 1;
    if (root === "영업 및 사업개발") return 2;
    if (root.includes("Project Archive")) return 3;
    if (root === "BD 전용 페이지") return 8;
    return 5;
  };
  const scored: Array<{ page: NotionPage; score: number }> = [];
  for (const p of pages) {
    const title = (p.title ?? "").trim();
    const tl = title.toLowerCase();
    let score = 0;
    if (tl === nl) score = 100;
    else if ((p.path_titles ?? []).some((t) => String(t).trim() === n)) score = 95;
    else if (tl.startsWith(nl) || (nl.startsWith(tl) && tl.length >= 10)) score = 80;
    else if (nl.length >= 8 && tl.includes(nl)) score = 55;
    else {
      const sim = trigramSimilarity(title, needle);
      if (sim >= 0.7) score = 40 + sim * 20;
    }
    if (score <= 0) continue;
    scored.push({ page: p, score: score - rank(p) * 0.2 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.page ?? null;
}

function pickWork(folders: WorkFolder[], needle: string): WorkFolder | null {
  const n = needle.trim().toLowerCase();
  const exact = folders.find((f) => f.project.toLowerCase() === n);
  if (exact) return exact;
  const includes = folders.filter(
    (f) =>
      f.project.toLowerCase().includes(n) ||
      n.includes(f.coreName.toLowerCase()) ||
      f.coreName.toLowerCase().includes(stripDateCode(needle).toLowerCase())
  );
  if (includes.length === 1) return includes[0]!;
  if (includes.length > 1) {
    includes.sort((a, b) => {
      if (a.isDelivery !== b.isDelivery) return a.isDelivery ? -1 : 1;
      return a.project.length - b.project.length;
    });
    return includes[0]!;
  }
  let best: { folder: WorkFolder; sim: number } | null = null;
  for (const f of folders) {
    const sim = Math.max(
      trigramSimilarity(f.project, needle),
      trigramSimilarity(f.coreName, stripDateCode(needle))
    );
    if (sim < 0.55) continue;
    if (!best || sim > best.sim) best = { folder: f, sim };
  }
  return best?.folder ?? null;
}

function parseTermsUsed(description: string | null): string[] {
  if (!description) return [];
  const t = description.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const json = JSON.parse(t) as { terms_used?: unknown };
      if (Array.isArray(json.terms_used)) {
        return json.terms_used.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* prose */
    }
  }
  return [];
}

function matchGlossary(text: string, terms: Array<{ name: string; needles: string[] }>): string[] {
  const hay = text.toLowerCase().replace(/\s+/g, " ");
  const hit: string[] = [];
  for (const t of terms) {
    if (t.needles.some((n) => n && hay.includes(n))) hit.push(t.name);
  }
  return hit;
}

type Entity = {
  type: "nas_path" | "notion_page" | "project";
  id: string;
  title: string;
  path: string;
  year: string | null;
};

async function resolveSuperAdminId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "슈퍼관리자")
    .limit(5);
  const rows = data ?? [];
  const hub = rows.find((r) => String(r.email ?? "").includes("hub@"));
  return String(hub?.id ?? rows[0]?.id ?? "") || null;
}

async function askHaiku(
  admin: SupabaseClient,
  opts: {
    left: string;
    right: string;
    extra?: string;
  }
): Promise<{
  same: boolean;
  confidence: number;
  reason: string;
  input: number;
  output: number;
} | null> {
  try {
    const { lunaLlmComplete } = await import("@/lib/luna/llm/client");
    const res = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "eval_grade",
      system:
        "두 이름이 아폴론의 같은 사업/프로젝트인지 판정한다. 날짜코드(YYMMDD)는 달라도 된다. 인스파이어는 시즌이 다르면 다른 건이다. JSON만 답한다: {\"same\":true|false,\"confidence\":0.0-1.0,\"reason\":\"한줄\"}",
      user: `A: ${opts.left}\nB: ${opts.right}${opts.extra ? `\n${opts.extra}` : ""}`,
      maxTokens: 120
    });
    const text = res.text.trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    let parsed: { same?: unknown; confidence?: unknown; reason?: unknown } = {};
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as typeof parsed;
      } catch {
        parsed = {};
      }
    }
    const same = parsed.same === true;
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    const reason =
      typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "";
    return {
      same,
      confidence,
      reason,
      input: res.usage.input_tokens,
      output: res.usage.output_tokens
    };
  } catch (err) {
    console.error("[build-links] askHaiku", err);
    return null;
  }
}

export async function buildLinks(
  admin: SupabaseClient,
  opts: BuildLinksOptions = {}
): Promise<BuildLinksReport> {
  const log = opts.log ?? console.log;
  const started = Date.now();
  const kindFilter = opts.kind;
  const yearFilter = opts.year;
  const dryRun = opts.dryRun === true;

  const report: BuildLinksReport = {
    elapsed_ms: 0,
    dryRun,
    year: yearFilter ?? null,
    kind: kindFilter ?? "all",
    belongs: {
      ...emptyKind(),
      nas_files: 0,
      nas_bundles: 0,
      images: 0,
      notion_pages: 0,
      notion_relations: 0
    },
    follows: {
      ...emptyKind(),
      nas_name: 0,
      notion_relations: 0,
      dual_source: 0,
      reclassified_from_belongs: 0
    },
    same: { ...emptyKind(), human: 0, auto: 0, asked: 0, dropped: 0 },
    perspectives: { ...emptyKind(), top: [] },
    questions: 0,
    llm_calls: 0,
    llm_aborted: false,
    llm_remaining: 0,
    llm_input_tokens: 0,
    llm_output_tokens: 0,
    llm_usd: 0
  };

  log("[build-links] load source tables…");
  const [nas, notionPages, media, relations, existing, superAdminId] =
    await Promise.all([
      fetchAll<NasRow>(admin, "nas_directory", "drive, path, type"),
      fetchAll<NotionPage>(
        admin,
        "luna_notion_pages",
        "page_id, title, nas_path, path_titles, root_title"
      ),
      fetchAll<MediaRow>(admin, "luna_media_index", "path, project, description"),
      fetchAll<RelationRow>(
        admin,
        "luna_notion_relations",
        "from_page_id, to_page_id, property_name"
      ),
      loadExistingKeys(admin),
      resolveSuperAdminId(admin)
    ]);

  const allWorkFolders = uniqueWorkFolders(nas);
  const yearsToRun = (
    yearFilter
      ? [yearFilter]
      : [...new Set(allWorkFolders.map((f) => Number(f.year)))]
          .filter((y) => Number.isFinite(y))
          .sort((a, b) => b - a)
  ) as number[];
  const workFolders = allWorkFolders.filter((f) =>
    yearsToRun.includes(Number(f.year))
  );
  const notionById = new Map(notionPages.map((p) => [p.page_id, p]));

  const runBelongs = !kindFilter || kindFilter === "belongs";
  const runFollows = !kindFilter || kindFilter === "follows";
  const runSame = !kindFilter || kindFilter === "same";
  const runPersp = !kindFilter || kindFilter === "perspectives";

  log(`[build-links] years ${yearsToRun.join(" → ")}`);

  if (runBelongs) {
    log("[build-links] belongs…");
    const drafts: LinkDraft[] = [];
    const fileByProject = new Map<
      string,
      { folder: WorkFolder; files: number; children: Map<string, number> }
    >();

    const nasFiles: Array<{ row: NasRow; folder: WorkFolder }> = [];
    const seenFile = new Set<string>();
    for (const row of nas) {
      if (row.type !== "file") continue;
      const folder = projectOfNasPath(row.drive, row.path);
      if (!folder) continue;
      if (!yearsToRun.includes(Number(folder.year))) continue;
      const filePath = fullNasPath(row.drive, row.path);
      if (seenFile.has(filePath)) continue;
      seenFile.add(filePath);
      nasFiles.push({ row, folder });
    }
    nasFiles.sort((a, b) => Number(b.folder.year) - Number(a.folder.year));

    let lastYear = "";
    for (const { row, folder } of nasFiles) {
      if (folder.year !== lastYear) {
        log(`  belongs nas ${folder.year}…`);
        lastYear = folder.year;
      }
      const filePath = fullNasPath(row.drive, row.path);
      const child = firstSubfolderLabel(row.path, folder) ?? "기타";
      const agg = fileByProject.get(folder.fullPath) ?? {
        folder,
        files: 0,
        children: new Map<string, number>()
      };
      agg.files += 1;
      agg.children.set(child, (agg.children.get(child) ?? 0) + 1);
      fileByProject.set(folder.fullPath, agg);

      drafts.push({
        from_type: "nas_path",
        from_id: filePath,
        to_type: "project",
        to_id: folder.project,
        kind: "belongs",
        confidence: 1,
        source: "rule",
        status: "active",
        evidence: {
          role: "file",
          year: folder.year,
          root: folder.root,
          from_title: row.path.split("\\").pop() ?? row.path,
          from_path: filePath,
          to_title: folder.project,
          to_path: folder.fullPath
        }
      });
    }
    report.belongs.nas_files = drafts.length;

    const imageDrafts: LinkDraft[] = [];
    const imageByProject = new Map<string, number>();
    const mediaSorted = [...media].sort((a, b) => {
      const ya = Number(yearFromPath(a.path) ?? yearFromPath(a.project ?? "") ?? 0);
      const yb = Number(yearFromPath(b.path) ?? yearFromPath(b.project ?? "") ?? 0);
      return yb - ya;
    });
    for (const row of mediaSorted) {
      const folder =
        (row.project
          ? workFolders.find((f) => f.project === row.project)
          : null) ?? projectFromFullPath(row.path);
      if (!folder) continue;
      if (!yearsToRun.includes(Number(folder.year))) continue;
      imageByProject.set(
        folder.project,
        (imageByProject.get(folder.project) ?? 0) + 1
      );
      imageDrafts.push({
        from_type: "image",
        from_id: row.path,
        to_type: "project",
        to_id: folder.project,
        kind: "belongs",
        confidence: 1,
        source: "rule",
        status: "active",
        evidence: {
          role: "image",
          year: folder.year,
          from_title: row.path.split(/[\\/]/).pop() ?? row.path,
          from_path: row.path,
          to_title: folder.project,
          to_path: folder.fullPath
        }
      });
    }
    report.belongs.images = imageDrafts.length;

    const notionDrafts: LinkDraft[] = [];
    const notionByProject = new Map<string, number>();
    for (const page of notionPages) {
      const hint = notionProjectHint(page);
      if (!hint.project) continue;
      const year = hint.year ?? yearFromPath(hint.project);
      if (year && !yearsToRun.includes(Number(year))) continue;
      if (!year && yearFilter) continue;
      const folder =
        workFolders.find((f) => f.project === hint.project) ??
        pickWork(workFolders, hint.project);
      notionByProject.set(
        hint.project,
        (notionByProject.get(hint.project) ?? 0) + 1
      );
      notionDrafts.push({
        from_type: "notion_page",
        from_id: page.page_id,
        to_type: "project",
        to_id: folder?.project ?? hint.project,
        kind: "belongs",
        confidence: 1,
        source: "rule",
        status: "active",
        evidence: {
          role: "notion",
          year: year ?? folder?.year ?? null,
          from_title: page.title,
          from_path: hint.path,
          to_title: folder?.project ?? hint.project,
          to_path: folder?.fullPath ?? hint.path
        }
      });
    }
    report.belongs.notion_pages = notionDrafts.length;

    const relDrafts: LinkDraft[] = [];
    for (const rel of relations) {
      const classified = classifyNotionRelationProperty(rel.property_name);
      const oriented = orientNotionRelation(rel, classified, notionById);
      if (!oriented) continue;
      // follows 는 아래 follows 블록에서 NAS 와 합쳐 넣는다
      if (oriented.kind === "follows") continue;

      const fromPage = notionById.get(oriented.from_page_id);
      const toPage = notionById.get(oriented.to_page_id);
      const fromYear = fromPage ? notionProjectHint(fromPage).year : null;
      const toYear = toPage ? notionProjectHint(toPage).year : null;
      if (yearFilter && !yearOk(fromYear, yearFilter) && !yearOk(toYear, yearFilter)) {
        continue;
      }
      relDrafts.push({
        from_type: "notion_page",
        from_id: oriented.from_page_id,
        to_type: "notion_page",
        to_id: oriented.to_page_id,
        kind: "belongs",
        confidence: 1,
        source: "rule",
        status: "active",
        evidence: {
          role: "relation",
          property_name: rel.property_name,
          year: fromYear ?? toYear,
          from_title: fromPage?.title ?? oriented.from_page_id,
          to_title: toPage?.title ?? oriented.to_page_id,
          relation_kind: "belongs"
        }
      });
    }
    report.belongs.notion_relations = relDrafts.length;

    const bundleDrafts: LinkDraft[] = [];
    for (const agg of fileByProject.values()) {
      const { folder } = agg;
      const children: Array<{ label: string; count: number }> = [
        ...[...agg.children.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, count]) => ({ label, count }))
      ];
      const img = imageByProject.get(folder.project) ?? 0;
      const notionN = notionByProject.get(folder.project) ?? 0;
      if (img) children.push({ label: "이미지", count: img });
      if (notionN) children.push({ label: "노션", count: notionN });
      bundleDrafts.push({
        from_type: "nas_path",
        from_id: folder.fullPath,
        to_type: "project",
        to_id: folder.project,
        kind: "belongs",
        confidence: 1,
        source: "rule",
        status: "active",
        evidence: {
          role: "bundle",
          year: folder.year,
          root: folder.root,
          file_count: agg.files,
          from_title: folder.project,
          from_path: folder.fullPath,
          to_title: folder.project,
          to_path: folder.fullPath,
          children
        }
      });
    }
    report.belongs.nas_bundles = bundleDrafts.length;

    const allBelongs = [
      ...bundleDrafts,
      ...drafts,
      ...imageDrafts,
      ...notionDrafts,
      ...relDrafts
    ];
    const inserted = emptyKind();
    inserted.scanned = allBelongs.length;
    for (const y of yearsToRun) {
      const chunk = allBelongs.filter(
        (row) => String(row.evidence.year ?? "") === String(y)
      );
      if (chunk.length === 0) continue;
      log(`  insert belongs ${y} (${chunk.length}건)`);
      const part = await insertLinks(admin, chunk, existing, dryRun, log);
      inserted.inserted += part.inserted;
      inserted.skipped += part.skipped;
      inserted.would += part.would;
    }
    const leftover = allBelongs.filter(
      (row) => !yearsToRun.includes(Number(row.evidence.year))
    );
    if (leftover.length) {
      const part = await insertLinks(admin, leftover, existing, dryRun, log);
      inserted.inserted += part.inserted;
      inserted.skipped += part.skipped;
      inserted.would += part.would;
    }
    report.belongs = { ...report.belongs, ...inserted };
    log(
      `[build-links] belongs files=${report.belongs.nas_files} bundles=${report.belongs.nas_bundles} images=${report.belongs.images} notion=${report.belongs.notion_pages} rels=${report.belongs.notion_relations} inserted=${inserted.inserted} skip=${inserted.skipped} would=${inserted.would}`
    );
  }

  if (runFollows) {
    log("[build-links] follows…");
    const reclass = await reclassifyBelongsRelationsToFollows(
      admin,
      notionById,
      dryRun,
      log
    );
    report.follows.reclassified_from_belongs = reclass.moved;

    const byMerge = new Map<string, FollowMergeDraft>();

    // NAS 폴더명 매칭
    const bd = workFolders.filter((f) => f.isBd);
    const delivery = workFolders.filter((f) => f.isDelivery);
    for (const from of bd) {
      for (const to of delivery) {
        if (skipInspirePair(from.project, to.project)) continue;
        if (normalizeCore(from.coreName) !== normalizeCore(to.coreName)) continue;
        if (yearFilter && !yearOk(to.year, yearFilter) && !yearOk(from.year, yearFilter)) {
          continue;
        }
        const mergeKey = followMergeKey(from.coreName, to.coreName);
        upsertFollowMerge(byMerge, mergeKey, {
          from_type: "nas_path",
          from_id: from.fullPath,
          to_type: "nas_path",
          to_id: to.fullPath,
          kind: "follows",
          confidence: 0.9,
          source: "rule",
          status: "active",
          evidence: {
            year: to.year,
            from_title: from.project,
            from_path: from.fullPath,
            to_title: to.project,
            to_path: to.fullPath,
            rule: "이름 동일 · 사업개발→프로젝트",
            sources: ["nas_name"]
          },
          merge_key: mergeKey,
          sources: new Set(["nas_name"])
        });
      }
    }

    // 노션 「전환된 프로젝트」 / 「연결(사업개발)」 등
    let notionFollowScanned = 0;
    for (const rel of relations) {
      const classified = classifyNotionRelationProperty(rel.property_name);
      const oriented = orientNotionRelation(rel, classified, notionById);
      if (!oriented || oriented.kind !== "follows") continue;
      notionFollowScanned += 1;

      const fromPage = notionById.get(oriented.from_page_id);
      const toPage = notionById.get(oriented.to_page_id);
      const fromTitle = fromPage?.title ?? oriented.from_page_id;
      const toTitle = toPage?.title ?? oriented.to_page_id;
      const fromYear = fromPage ? notionProjectHint(fromPage).year : null;
      const toYear = toPage ? notionProjectHint(toPage).year : null;
      if (yearFilter && !yearOk(fromYear, yearFilter) && !yearOk(toYear, yearFilter)) {
        continue;
      }

      const fromCore =
        fromPage && notionProjectHint(fromPage).project
          ? stripDateCode(notionProjectHint(fromPage).project!)
          : stripDateCode(fromTitle);
      const toCore =
        toPage && notionProjectHint(toPage).project
          ? stripDateCode(notionProjectHint(toPage).project!)
          : stripDateCode(toTitle);
      const mergeKey = followMergeKey(fromCore, toCore);

      upsertFollowMerge(byMerge, mergeKey, {
        from_type: "notion_page",
        from_id: oriented.from_page_id,
        to_type: "notion_page",
        to_id: oriented.to_page_id,
        kind: "follows",
        confidence: 0.9,
        source: "rule",
        status: "active",
        evidence: {
          role: "relation",
          property_name: rel.property_name,
          year: toYear ?? fromYear,
          from_title: fromTitle,
          to_title: toTitle,
          rule: "노션 관계 · 사업개발→프로젝트",
          sources: ["notion_relation"],
          direction: classified.direction
        },
        merge_key: mergeKey,
        sources: new Set(["notion_relation"])
      });
    }
    report.follows.notion_relations = notionFollowScanned;
    report.follows.nas_name = [...byMerge.values()].filter((d) =>
      d.sources.has("nas_name")
    ).length;

    const drafts: LinkDraft[] = [];
    let dual = 0;
    for (const draft of byMerge.values()) {
      const sources = [...draft.sources];
      if (sources.length >= 2) {
        dual += 1;
        draft.confidence = 1;
      }
      draft.evidence = {
        ...draft.evidence,
        sources,
        merge_key: draft.merge_key
      };
      drafts.push({
        from_type: draft.from_type,
        from_id: draft.from_id,
        to_type: draft.to_type,
        to_id: draft.to_id,
        kind: "follows",
        confidence: draft.confidence,
        source: draft.source,
        status: draft.status,
        evidence: draft.evidence
      });
    }
    report.follows.dual_source = dual;

    const inserted = await upsertFollowLinks(admin, drafts, existing, dryRun, log);
    report.follows = { ...report.follows, ...inserted };
    log(
      `[build-links] follows scanned=${inserted.scanned} inserted=${inserted.inserted} skip=${inserted.skipped} would=${inserted.would} nas=${report.follows.nas_name} notion=${report.follows.notion_relations} dual=${dual} reclass=${reclass.moved}`
    );
  }

  if (runSame) {
    log("[build-links] same · human seeds…");
    const humanDrafts: LinkDraft[] = [];
    const nowIso = new Date().toISOString();
    for (const pair of HUMAN_SAME_PAIRS) {
      const leftWork = pickWork(uniqueWorkFolders(nas), pair.left);
      const rightWork = pickWork(uniqueWorkFolders(nas), pair.right);
      const leftNotion = pickNotionPage(notionPages, pair.left);
      const rightNotion = pickNotionPage(notionPages, pair.right);

      let from: Entity | null = null;
      let to: Entity | null = null;

      const workLeftOk =
        leftWork && yearOk(leftWork.year, yearFilter) ? leftWork : null;
      const workRightOk =
        rightWork &&
        rightWork.fullPath !== leftWork?.fullPath &&
        yearOk(rightWork.year, yearFilter)
          ? rightWork
          : null;

      if (pair.note.includes("Work=노션") || (!workRightOk && rightNotion)) {
        const work = workLeftOk ?? workRightOk;
        const notion = rightNotion ?? leftNotion;
        if (work && notion) {
          if (!yearOk(work.year, yearFilter) && yearFilter) continue;
          from = {
            type: "nas_path",
            id: work.fullPath,
            title: work.project,
            path: work.fullPath,
            year: work.year
          };
          to = {
            type: "notion_page",
            id: notion.page_id,
            title: notion.title,
            path: (notion.path_titles ?? []).join(" › "),
            year: notionProjectHint(notion).year
          };
        }
      } else if (workLeftOk && workRightOk) {
        from = {
          type: "nas_path",
          id: workLeftOk.fullPath,
          title: workLeftOk.project,
          path: workLeftOk.fullPath,
          year: workLeftOk.year
        };
        to = {
          type: "nas_path",
          id: workRightOk.fullPath,
          title: workRightOk.project,
          path: workRightOk.fullPath,
          year: workRightOk.year
        };
      } else {
        const work = workLeftOk ?? workRightOk;
        const notion = rightNotion ?? leftNotion;
        if (work && notion) {
          from = {
            type: "nas_path",
            id: work.fullPath,
            title: work.project,
            path: work.fullPath,
            year: work.year
          };
          to = {
            type: "notion_page",
            id: notion.page_id,
            title: notion.title,
            path: (notion.path_titles ?? []).join(" › "),
            year: notionProjectHint(notion).year
          };
        }
      }

      if (!from || !to) {
        log(`[build-links] human seed miss: ${pair.left} = ${pair.right}`);
        continue;
      }
      humanDrafts.push({
        from_type: from.type,
        from_id: from.id,
        to_type: to.type,
        to_id: to.id,
        kind: "same",
        confidence: 1,
        source: "human",
        status: "active",
        confirmed_by: superAdminId,
        confirmed_at: nowIso,
        evidence: {
          year: from.year ?? to.year,
          from_title: from.title,
          from_path: from.path,
          to_title: to.title,
          to_path: to.path,
          note: pair.note
        }
      });
      if (!dryRun) {
        const { data: olds } = await admin
          .from("luna_links")
          .select("id, to_id, to_type")
          .eq("kind", "same")
          .eq("source", "human")
          .eq("from_id", from.id);
        for (const old of olds ?? []) {
          if (old.to_id === to.id && old.to_type === to.type) continue;
          const { error: updErr } = await admin
            .from("luna_links")
            .update({
              to_type: to.type,
              to_id: to.id,
              evidence: {
                year: from.year ?? to.year,
                from_title: from.title,
                from_path: from.path,
                to_title: to.title,
                to_path: to.path,
                note: pair.note
              }
            })
            .eq("id", old.id);
          if (updErr) {
            if (/duplicate key/i.test(updErr.message)) {
              const { error: delErr } = await admin
                .from("luna_links")
                .delete()
                .eq("id", old.id);
              if (delErr) {
                log(`[build-links] human seed update fail: ${updErr.message}`);
              } else {
                log(
                  `[build-links] human seed 중복 정리 ${from.title} (이미 올바른 연결 있음)`
                );
              }
            } else {
              log(`[build-links] human seed update fail: ${updErr.message}`);
            }
          } else {
            log(
              `[build-links] human seed 수정 ${from.title} → ${to.title}`
            );
          }
        }
        const { error: markErr } = await admin
          .from("luna_links")
          .update({
            source: "human",
            confidence: 1,
            status: "active",
            confirmed_by: superAdminId,
            confirmed_at: nowIso
          })
          .eq("kind", "same")
          .eq("from_id", from.id)
          .eq("to_id", to.id);
        if (markErr) {
          log(`[build-links] human mark fail: ${markErr.message}`);
        }
      }
    }
    const humanIns = await insertLinks(admin, humanDrafts, existing, dryRun, log);
    report.same.human = humanIns.would || humanIns.inserted || humanIns.skipped;
    report.same.scanned += humanIns.scanned;
    report.same.inserted += humanIns.inserted;
    report.same.skipped += humanIns.skipped;
    report.same.would += humanIns.would;

    log("[build-links] same · fuzzy…");
    const notionProjects = notionPages.filter((p) => {
      const hint = notionProjectHint(p);
      if (!hint.project && !/^\d{6}\s+/.test(p.title)) {
        const root = p.root_title ?? "";
        if (
          root !== "[진행 중] 프로젝트" &&
          root !== "[진행 중] 사업개발" &&
          !root.includes("Project Archive")
        ) {
          return false;
        }
      }
      return yearOk(hint.year ?? yearFromPath(p.title), yearFilter) || !yearFilter;
    });

    type Pair = {
      left: Entity;
      right: Entity;
      sim: number;
      sameDate: boolean;
    };
    const pairs: Pair[] = [];
    const seenPair = new Set<string>();

    const pushPair = (left: Entity, right: Entity) => {
      if (left.id === right.id && left.type === right.type) return;
      if (skipInspirePair(left.title, right.title)) return;
      const key = [left.type, left.id, right.type, right.id].sort().join("\t");
      if (seenPair.has(key)) return;
      seenPair.add(key);
      const sim = trigramSimilarity(left.title, right.title);
      const sameDate =
        (extractDateCode(left.title) ?? "") ===
          (extractDateCode(right.title) ?? "") &&
        Boolean(extractDateCode(left.title));
      pairs.push({ left, right, sim, sameDate });
    };

    const bd = workFolders.filter((f) => f.isBd);
    const delivery = workFolders.filter((f) => f.isDelivery);
    for (const from of bd) {
      for (const to of delivery) {
        if (normalizeCore(from.coreName) === normalizeCore(to.coreName)) continue;
        pushPair(
          {
            type: "nas_path",
            id: from.fullPath,
            title: from.project,
            path: from.fullPath,
            year: from.year
          },
          {
            type: "nas_path",
            id: to.fullPath,
            title: to.project,
            path: to.fullPath,
            year: to.year
          }
        );
      }
    }

    for (const folder of workFolders) {
      let best: { page: NotionPage; sim: number }[] = [];
      for (const page of notionProjects) {
        if (skipInspirePair(folder.project, page.title)) continue;
        const sim = Math.max(
          trigramSimilarity(folder.project, page.title),
          trigramSimilarity(folder.coreName, stripDateCode(page.title))
        );
        if (sim < 0.45) continue;
        best.push({ page, sim });
      }
      best.sort((a, b) => b.sim - a.sim);
      best = best.slice(0, 3);
      for (const hit of best) {
        pushPair(
          {
            type: "nas_path",
            id: folder.fullPath,
            title: folder.project,
            path: folder.fullPath,
            year: folder.year
          },
          {
            type: "notion_page",
            id: hit.page.page_id,
            title: hit.page.title,
            path: (hit.page.path_titles ?? []).join(" › "),
            year: notionProjectHint(hit.page).year
          }
        );
      }
    }

    const sameDrafts: LinkDraft[] = [];
    const questionDrafts: Array<{
      question: string;
      why: string;
      confidence: number;
      link: LinkDraft;
    }> = [];

    for (const pair of pairs) {
      const already = existing.has(
        linkKey({
          from_type: pair.left.type,
          from_id: pair.left.id,
          to_type: pair.right.type,
          to_id: pair.right.id,
          kind: "same"
        })
      );
      if (already) {
        report.same.skipped += 1;
        continue;
      }
      const decision = decideSame(pair.sim, pair.sameDate);
      if (decision.action === "drop") {
        report.same.dropped += 1;
        continue;
      }

      const makeDraft = (
        confidence: number,
        source: "rule" | "llm",
        extra: Record<string, unknown>
      ): LinkDraft => {
        const status = statusFromConfidence(confidence);
        return {
          from_type: pair.left.type,
          from_id: pair.left.id,
          to_type: pair.right.type,
          to_id: pair.right.id,
          kind: "same",
          confidence,
          source,
          status: status === "active" ? "active" : "pending",
          evidence: {
            year: pair.left.year ?? pair.right.year,
            from_title: pair.left.title,
            from_path: pair.left.path,
            to_title: pair.right.title,
            to_path: pair.right.path,
            similarity: Math.round(pair.sim * 1000) / 1000,
            same_date: pair.sameDate,
            ...extra
          }
        };
      };

      if (decision.action === "save") {
        sameDrafts.push(makeDraft(decision.confidence, "rule", {}));
        report.same.auto += 1;
        continue;
      }
      if (decision.action === "ask") {
        const draft = makeDraft(decision.confidence, "rule", {});
        sameDrafts.push(draft);
        questionDrafts.push({
          question: `「${pair.left.title}」와 「${pair.right.title}」는 같은 건인가요?`,
          why: `이름 유사도 ${pair.sim.toFixed(2)} · 날짜코드가 달라 자동 확정하지 않았습니다.`,
          confidence: decision.confidence,
          link: draft
        });
        report.same.asked += 1;
        continue;
      }

      if (report.llm_calls >= LLM_MAX_CALLS) {
        report.llm_aborted = true;
        report.llm_remaining += 1;
        continue;
      }
      report.llm_calls += 1;
      log(
        `[build-links] LLM ${report.llm_calls}/${LLM_MAX_CALLS}  ${pair.left.title} ↔ ${pair.right.title}  sim=${pair.sim.toFixed(2)}`
      );
      if (report.llm_calls > LLM_MAX_CALLS) {
        report.llm_aborted = true;
        break;
      }
      const llm = dryRun
        ? null
        : await askHaiku(admin, {
            left: pair.left.title,
            right: pair.right.title,
            extra: `경로A: ${pair.left.path}\n경로B: ${pair.right.path}\n유사도: ${pair.sim.toFixed(2)}`
          });
      if (dryRun) {
        report.same.would += 1;
        continue;
      }
      if (!llm) {
        log("[build-links] LLM 키 없음 — 해당 구간은 질문으로");
        const draft = makeDraft(0.55, "llm", { llm: "missing-key" });
        sameDrafts.push(draft);
        questionDrafts.push({
          question: `「${pair.left.title}」와 「${pair.right.title}」는 같은 건인가요?`,
          why: "유사도 0.45~0.6 인데 LLM 키가 없어 사람에게 묻습니다.",
          confidence: 0.55,
          link: draft
        });
        report.same.asked += 1;
        continue;
      }
      report.llm_input_tokens += llm.input;
      report.llm_output_tokens += llm.output;
      if (!llm.same || llm.confidence < LINK_ASK_MIN) {
        sameDrafts.push({
          ...makeDraft(Math.min(llm.confidence, 0.49), "llm", {
            llm_reason: llm.reason
          }),
          status: "rejected"
        });
        report.same.dropped += 1;
        continue;
      }
      const draft = makeDraft(llm.confidence, "llm", { llm_reason: llm.reason });
      sameDrafts.push(draft);
      if (llm.confidence >= LINK_AUTO_SAVE) report.same.auto += 1;
      else {
        questionDrafts.push({
          question: `「${pair.left.title}」와 「${pair.right.title}」는 같은 건인가요?`,
          why: llm.reason || `LLM 확신도 ${llm.confidence.toFixed(2)}`,
          confidence: llm.confidence,
          link: draft
        });
        report.same.asked += 1;
      }
    }

    report.llm_usd = haikuUsd(report.llm_input_tokens, report.llm_output_tokens);
    if (report.llm_aborted) {
      log(
        `[build-links] LLM 중단 — 예상 한도 ${LLM_MAX_CALLS}건을 넘었습니다. 남은 후보 ${report.llm_remaining}건`
      );
    }

    const sameIns = await insertLinks(admin, sameDrafts, existing, dryRun, log);
    report.same.scanned += sameIns.scanned;
    report.same.inserted += sameIns.inserted;
    report.same.skipped += sameIns.skipped;
    report.same.would += sameIns.would;

    if (!dryRun) {
      report.questions = await ensureSameQuestions(
        admin,
        superAdminId,
        questionDrafts,
        log
      );
    } else {
      report.questions = questionDrafts.length;
    }

    log(
      `[build-links] same human=${report.same.human} auto=${report.same.auto} ask=${report.same.asked} drop=${report.same.dropped} llm=${report.llm_calls} usd=$${report.llm_usd.toFixed(4)}`
    );
  }

  if (runPersp) {
    log("[build-links] perspectives…");
    const [glossary, wiki, chunks, messages] = await Promise.all([
      fetchAll<GlossaryRow>(
        admin,
        "glossary_terms",
        "term_ko, term_en, synonyms, deleted_at"
      ),
      fetchAll<{ title: string | null; content: string | null; summary: string | null }>(
        admin,
        "luna_library",
        "title, content, summary"
      ),
      fetchAll<{ text: string | null }>(admin, "luna_notion_chunks", "text"),
      loadProductionPerspectiveMessages(admin)
    ]);

    const glossaryTerms = glossary
      .filter((g) => !g.deleted_at && String(g.term_ko ?? "").trim().length >= 2)
      .map((g) => {
        const name = String(g.term_ko).trim();
        const syn = Array.isArray(g.synonyms)
          ? g.synonyms.filter((x): x is string => typeof x === "string")
          : [];
        const needles = [name, g.term_en ?? "", ...syn]
          .map((s) => s.toLowerCase().trim())
          .filter((s) => s.length >= 2);
        return { name, needles };
      });

    const hits = new Map<string, number>();
    const bump = (name: string, n = 1) =>
      hits.set(name, (hits.get(name) ?? 0) + n);

    for (const row of media) {
      const used = parseTermsUsed(row.description);
      if (used.length) {
        for (const t of used) bump(t);
      } else if (row.description) {
        for (const t of matchGlossary(row.description, glossaryTerms)) bump(t);
      }
    }
    for (const page of notionPages) {
      const blob = [page.title, ...(page.path_titles ?? [])].join(" ");
      for (const t of matchGlossary(blob, glossaryTerms)) bump(t);
    }
    for (const chunk of chunks) {
      if (!chunk.text) continue;
      for (const t of matchGlossary(chunk.text, glossaryTerms)) bump(t);
    }
    for (const doc of wiki) {
      const blob = `${doc.title ?? ""} ${doc.summary ?? ""} ${doc.content ?? ""}`;
      for (const t of matchGlossary(blob, glossaryTerms)) bump(t);
    }

    const used = new Map<string, number>();
    for (const msg of messages) {
      const role = (msg as { role?: string }).role;
      if (role && role !== "user") continue;
      const c = String(msg.content ?? "").trim();
      if (!c) continue;
      for (const t of matchGlossary(c, glossaryTerms)) {
        used.set(t, (used.get(t) ?? 0) + 1);
      }
    }

    const names = new Set([...hits.keys(), ...used.keys()]);
    const rows = [...names].map((name) => {
      const hit_count = hits.get(name) ?? 0;
      const used_count = used.get(name) ?? 0;
      return {
        name,
        source: "data" as const,
        hit_count,
        used_count,
        status: hit_count < 10 ? "dormant" : "active"
      };
    });
    rows.sort((a, b) => b.hit_count - a.hit_count || b.used_count - a.used_count);

    report.perspectives.scanned = rows.length;
    report.perspectives.would = rows.length;
    report.perspectives.top = rows.slice(0, 20).map((r) => ({
      name: r.name,
      hit_count: r.hit_count
    }));

    const existingPersp = await fetchAll<{ id: string; name: string; source: string; used_count: number }>(
      admin, "luna_perspectives", "id, name, source, used_count"
    );
    const resetUsageIds = obsoletePerspectiveUsageIds(existingPersp, rows.map(row => row.name));
    report.perspectives.would += resetUsageIds.length;
    log(`[build-links] perspectives obsolete usage reset=${resetUsageIds.length}${dryRun ? " (dry-run)" : ""}`);
    if (!dryRun) {
      for (let i = 0; i < resetUsageIds.length; i += 100) {
        const { error } = await admin.from("luna_perspectives")
          .update({ used_count: 0 }).in("id", resetUsageIds.slice(i, i + 100)).eq("source", "data");
        if (error) throw new Error(`luna_perspectives usage reset: ${error.message}`);
      }
      const byName = new Map(existingPersp.map((p) => [p.name, p.id]));
      const toInsert = rows.filter((r) => !byName.has(r.name));
      const toUpdate = rows.filter((r) => byName.has(r.name));
      for (let i = 0; i < toInsert.length; i += 100) {
        const { error } = await admin
          .from("luna_perspectives")
          .insert(toInsert.slice(i, i + 100));
        if (error) throw new Error(`luna_perspectives insert: ${error.message}`);
      }
      for (const row of toUpdate) {
        const id = byName.get(row.name);
        if (!id) continue;
        const { error } = await admin
          .from("luna_perspectives")
          .update({
            hit_count: row.hit_count,
            used_count: row.used_count,
            status: row.status
          })
          .eq("id", id);
        if (error) throw new Error(`luna_perspectives update: ${error.message}`);
      }
      report.perspectives.inserted = toInsert.length;
      report.perspectives.skipped = toUpdate.length;
    }

    log(
      `[build-links] perspectives ${rows.length}건 · top ${report.perspectives.top[0]?.name ?? "—"}`
    );
  }

  report.elapsed_ms = Date.now() - started;
  log(
    `[build-links] done ${Math.round(report.elapsed_ms / 1000)}s  llm=${report.llm_calls}  $${report.llm_usd.toFixed(4)}${dryRun ? "  (dry-run)" : ""}`
  );
  return report;
}

function contextPairKey(context: unknown): string {
  let obj: Record<string, unknown> = {};
  if (context && typeof context === "object" && !Array.isArray(context)) {
    obj = context as Record<string, unknown>;
  } else if (typeof context === "string") {
    try {
      const parsed = JSON.parse(context) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return "";
    }
  }
  return questionDedupeKey({
    from_id: String(obj.from_id ?? ""),
    to_id: String(obj.to_id ?? ""),
    to_type: String(obj.to_type ?? ""),
    to_title: String(obj.to_title ?? "")
  });
}

async function ensureSameQuestions(
  admin: SupabaseClient,
  superAdminId: string | null,
  drafts: Array<{
    question: string;
    why: string;
    confidence: number;
    link: LinkDraft;
  }>,
  log: (msg: string) => void
): Promise<number> {
  const pendingSame: Array<{
    id: string;
    from_type: string;
    from_id: string;
    to_type: string;
    to_id: string;
    confidence: number;
    evidence: Record<string, unknown> | null;
    status: string;
  }> = [];
  {
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("luna_links")
        .select("id, from_type, from_id, to_type, to_id, confidence, evidence, status")
        .eq("kind", "same")
        .eq("status", "pending")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(`luna_links pending: ${error.message}`);
      const rows = (data ?? []) as typeof pendingSame;
      pendingSame.push(...rows);
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  const existingQ = await fetchAll<{ context: unknown }>(
    admin,
    "luna_questions",
    "context"
  );
  const qKeys = new Set(existingQ.map((row) => contextPairKey(row.context)));

  const draftByKey = new Map(
    drafts.map((d) => [linkKey(d.link), d] as const)
  );
  const toInsert: Array<Record<string, unknown>> = [];

  for (const row of pendingSame) {
    const fromTitle = String(row.evidence?.from_title ?? row.from_id);
    const toTitle = String(row.evidence?.to_title ?? row.to_id);
    const pairKey = questionDedupeKey({
      from_id: row.from_id,
      to_id: row.to_id,
      to_type: row.to_type,
      to_title: toTitle
    });
    if (qKeys.has(pairKey)) continue;
    const k = linkKey({
      from_type: row.from_type,
      from_id: row.from_id,
      to_type: row.to_type,
      to_id: row.to_id,
      kind: "same"
    });
    const draft = draftByKey.get(k);
    toInsert.push({
      question:
        draft?.question ?? `「${fromTitle}」와 「${toTitle}」는 같은 건인가요?`,
      context: JSON.stringify({
        why:
          draft?.why ??
          "이름만으로는 같은 프로젝트인지 확정하지 못해 묻습니다. 정하시면 앞으로 이 둘을 같은(또는 다른) 걸로 볼게요.",
        kind: "same",
        from_type: row.from_type,
        from_id: row.from_id,
        to_type: row.to_type,
        to_id: row.to_id,
        from_title: fromTitle,
        to_title: toTitle,
        from_path: String(row.evidence?.from_path ?? ""),
        to_path: String(row.evidence?.to_path ?? ""),
        confidence: draft?.confidence ?? row.confidence,
        link_id: row.id
      }),
      link_id: row.id,
      options: ["같아요", "달라요", "모르겠어요"],
      category: "판단기준",
      source: "conflict",
      target_user_id: superAdminId,
      status: "pending"
    });
    qKeys.add(pairKey);
  }

  for (let i = 0; i < toInsert.length; i += 50) {
    const { error } = await admin
      .from("luna_questions")
      .insert(toInsert.slice(i, i + 50));
    if (error) throw new Error(`luna_questions insert: ${error.message}`);
  }
  log(`[build-links] questions ${toInsert.length}건`);
  return toInsert.length;
}

function normalizeCore(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function followCoreKey(title: string): string {
  return stripDateCode(title)
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function followMergeKey(fromTitle: string, toTitle: string): string {
  return `${followCoreKey(fromTitle)}=>${followCoreKey(toTitle)}`;
}

type OrientedRelation = {
  kind: "belongs" | "follows";
  from_page_id: string;
  to_page_id: string;
};

/**
 * 속성 규칙 + (follows 일 때) BD→프로젝트 검증.
 * 캘린더→사업개발 같은 「연결(사업개발)」은 belongs 로 되돌린다.
 */
function orientNotionRelation(
  rel: RelationRow,
  classified: ClassifiedNotionRelation,
  notionById: Map<string, NotionPage>
): OrientedRelation | null {
  let fromId = rel.from_page_id;
  let toId = rel.to_page_id;
  const kind = classified.kind;

  if (kind === "same") return null;

  if (kind === "follows") {
    if (classified.direction === "reverse") {
      fromId = rel.to_page_id;
      toId = rel.from_page_id;
    }
    const fromPage = notionById.get(fromId);
    const toPage = notionById.get(toId);
    if (!fromPage || !toPage) return null;
    if (!isBdToProjectFollowPair(fromPage, toPage)) {
      // 전환이 아니면 속한 것 — 원본 방향 유지
      return {
        kind: "belongs",
        from_page_id: rel.from_page_id,
        to_page_id: rel.to_page_id
      };
    }
    return { kind: "follows", from_page_id: fromId, to_page_id: toId };
  }

  return {
    kind: "belongs",
    from_page_id: fromId,
    to_page_id: toId
  };
}

type FollowMergeDraft = LinkDraft & {
  merge_key: string;
  sources: Set<string>;
};

function upsertFollowMerge(
  map: Map<string, FollowMergeDraft>,
  mergeKey: string,
  incoming: FollowMergeDraft
): void {
  // 같은 코어가 약간만 다른 키로 들어오면 기존 키에 붙인다
  let key = mergeKey;
  let existing = map.get(key);
  if (!existing) {
    for (const [k, row] of map) {
      if (followKeysCompatible(k, mergeKey)) {
        key = k;
        existing = row;
        break;
      }
    }
  }
  if (!existing) {
    map.set(key, incoming);
    return;
  }
  for (const s of incoming.sources) existing.sources.add(s);
  const prevSources = Array.isArray(existing.evidence.sources)
    ? (existing.evidence.sources as string[])
    : [];
  const nextSources = [...new Set([...prevSources, ...incoming.sources])];
  existing.evidence = {
    ...existing.evidence,
    ...incoming.evidence,
    sources: nextSources,
    nas_from_path:
      existing.evidence.from_path ??
      incoming.evidence.from_path ??
      existing.evidence.nas_from_path,
    nas_to_path:
      existing.evidence.to_path ??
      incoming.evidence.to_path ??
      existing.evidence.nas_to_path,
    notion_from_id:
      existing.from_type === "notion_page"
        ? existing.from_id
        : incoming.from_type === "notion_page"
          ? incoming.from_id
          : existing.evidence.notion_from_id,
    notion_to_id:
      existing.to_type === "notion_page"
        ? existing.to_id
        : incoming.to_type === "notion_page"
          ? incoming.to_id
          : existing.evidence.notion_to_id,
    property_name:
      incoming.evidence.property_name ?? existing.evidence.property_name
  };
  // NAS 가 있으면 엔티티는 NAS 유지(기존 5건 호환), 노션 id 는 evidence 에
  if (existing.from_type === "nas_path" && incoming.from_type === "notion_page") {
    // keep NAS endpoints
  } else if (
    existing.from_type === "notion_page" &&
    incoming.from_type === "nas_path"
  ) {
    existing.from_type = incoming.from_type;
    existing.from_id = incoming.from_id;
    existing.to_type = incoming.to_type;
    existing.to_id = incoming.to_id;
    existing.evidence.from_title =
      incoming.evidence.from_title ?? existing.evidence.from_title;
    existing.evidence.to_title =
      incoming.evidence.to_title ?? existing.evidence.to_title;
    existing.evidence.from_path = incoming.evidence.from_path;
    existing.evidence.to_path = incoming.evidence.to_path;
  }
  if (existing.sources.size >= 2) existing.confidence = 1;
  else {
    existing.confidence = Math.max(existing.confidence, incoming.confidence);
  }
}

function followKeysCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const [af, at] = a.split("=>");
  const [bf, bt] = b.split("=>");
  if (!af || !at || !bf || !bt) return false;
  const fromOk =
    af === bf ||
    (af.length >= 4 && bf.includes(af)) ||
    (bf.length >= 4 && af.includes(bf));
  const toOk =
    at === bt ||
    (at.length >= 4 && bt.includes(at)) ||
    (bt.length >= 4 && at.includes(bt));
  return fromOk && toOk;
}

/** 기존 belongs(relation) 중 follows 규칙을 만족하는 것을 옮긴다 */
async function reclassifyBelongsRelationsToFollows(
  admin: SupabaseClient,
  notionById: Map<string, NotionPage>,
  dryRun: boolean,
  log: (msg: string) => void
): Promise<{ moved: number; samples: Array<{ from: string; to: string }> }> {
  const samples: Array<{ from: string; to: string }> = [];
  let moved = 0;
  let from = 0;
  const pageSize = 500;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("id, from_type, from_id, to_type, to_id, evidence, confidence")
      .eq("kind", "belongs")
      .eq("from_type", "notion_page")
      .eq("to_type", "notion_page")
      .filter("evidence->>role", "eq", "relation")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reclassify follows: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const ev = (row.evidence as Record<string, unknown>) ?? {};
      const prop =
        typeof ev.property_name === "string" ? ev.property_name : "";
      if (!prop) continue;
      const classified = classifyNotionRelationProperty(prop);
      if (classified.kind !== "follows") continue;

      const oriented = orientNotionRelation(
        {
          from_page_id: String(row.from_id),
          to_page_id: String(row.to_id),
          property_name: prop
        },
        classified,
        notionById
      );
      if (!oriented || oriented.kind !== "follows") continue;

      const fromPage = notionById.get(oriented.from_page_id);
      const toPage = notionById.get(oriented.to_page_id);
      const nextEvidence = {
        ...ev,
        role: "relation",
        property_name: prop,
        relation_kind: "follows",
        direction: classified.direction,
        sources: Array.isArray(ev.sources)
          ? [...new Set([...(ev.sources as string[]), "notion_relation"])]
          : ["notion_relation"],
        from_title: fromPage?.title ?? ev.from_title,
        to_title: toPage?.title ?? ev.to_title,
        rule: "노션 관계 · 사업개발→프로젝트 (재분류)"
      };

      if (dryRun) {
        moved += 1;
        if (samples.length < 5) {
          samples.push({
            from: String(nextEvidence.from_title ?? oriented.from_page_id),
            to: String(nextEvidence.to_title ?? oriented.to_page_id)
          });
        }
        continue;
      }

      // kind 변경 + 방향 교정. 유니크 충돌 시 기존 follows 에 합치고 belongs 삭제
      const { data: conflict } = await admin
        .from("luna_links")
        .select("id, evidence, confidence")
        .eq("from_type", "notion_page")
        .eq("from_id", oriented.from_page_id)
        .eq("to_type", "notion_page")
        .eq("to_id", oriented.to_page_id)
        .eq("kind", "follows")
        .maybeSingle();

      if (conflict?.id && conflict.id !== row.id) {
        const prevEv = (conflict.evidence as Record<string, unknown>) ?? {};
        const mergedSources = [
          ...new Set([
            ...(Array.isArray(prevEv.sources) ? (prevEv.sources as string[]) : []),
            ...(Array.isArray(nextEvidence.sources)
              ? (nextEvidence.sources as string[])
              : ["notion_relation"])
          ])
        ];
        await admin
          .from("luna_links")
          .update({
            confidence: Math.max(
              Number(conflict.confidence) || 0,
              0.9,
              mergedSources.length >= 2 ? 1 : 0.9
            ),
            evidence: { ...prevEv, ...nextEvidence, sources: mergedSources }
          })
          .eq("id", conflict.id);
        await admin.from("luna_links").delete().eq("id", row.id);
      } else {
        const { error: upErr } = await admin
          .from("luna_links")
          .update({
            kind: "follows",
            from_id: oriented.from_page_id,
            to_id: oriented.to_page_id,
            confidence: Math.max(Number(row.confidence) || 0, 0.9),
            evidence: nextEvidence
          })
          .eq("id", row.id);
        if (upErr) {
          log(`[build-links] reclassify skip ${row.id}: ${upErr.message}`);
          continue;
        }
      }
      moved += 1;
      if (samples.length < 5) {
        samples.push({
          from: String(nextEvidence.from_title ?? oriented.from_page_id),
          to: String(nextEvidence.to_title ?? oriented.to_page_id)
        });
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }
  if (moved) {
    log(`[build-links] reclassified belongs→follows ${moved}건`);
  }
  return { moved, samples };
}

/**
 * follows 전용 upsert — 이미 있으면 evidence.sources 를 합친다.
 */
async function upsertFollowLinks(
  admin: SupabaseClient,
  rows: LinkDraft[],
  existing: Set<string>,
  dryRun: boolean,
  log: (msg: string) => void
): Promise<KindCount> {
  const count = emptyKind();
  count.scanned = rows.length;
  if (rows.length === 0) return count;

  // 기존 follows 로드 (merge 용)
  const existingFollows: Array<{
    id: string;
    from_type: string;
    from_id: string;
    to_type: string;
    to_id: string;
    confidence: number;
    evidence: Record<string, unknown>;
  }> = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("id, from_type, from_id, to_type, to_id, confidence, evidence")
      .eq("kind", "follows")
      .range(offset, offset + 499);
    if (error) throw new Error(`follows load: ${error.message}`);
    const part = data ?? [];
    for (const row of part) {
      existingFollows.push({
        id: String(row.id),
        from_type: String(row.from_type),
        from_id: String(row.from_id),
        to_type: String(row.to_type),
        to_id: String(row.to_id),
        confidence: Number(row.confidence) || 0,
        evidence: (row.evidence as Record<string, unknown>) ?? {}
      });
    }
    if (part.length < 500) break;
    offset += 500;
  }

  const fresh: LinkDraft[] = [];
  for (const row of rows) {
    const k = linkKey(row);
    const exact = existingFollows.find(
      (e) =>
        e.from_type === row.from_type &&
        e.from_id === row.from_id &&
        e.to_type === row.to_type &&
        e.to_id === row.to_id
    );
    const rowMerge =
      typeof row.evidence.merge_key === "string"
        ? row.evidence.merge_key
        : followMergeKey(
            String(row.evidence.from_title ?? ""),
            String(row.evidence.to_title ?? "")
          );
    const semantic = existingFollows.find((e) => {
      const ek =
        typeof e.evidence.merge_key === "string"
          ? e.evidence.merge_key
          : followMergeKey(
              String(e.evidence.from_title ?? ""),
              String(e.evidence.to_title ?? "")
            );
      return followKeysCompatible(ek, rowMerge);
    });

    const target = exact ?? semantic;
    if (target) {
      const prevSources = Array.isArray(target.evidence.sources)
        ? (target.evidence.sources as string[])
        : target.evidence.rule
          ? ["nas_name"]
          : [];
      const nextSources = [
        ...new Set([
          ...prevSources,
          ...(Array.isArray(row.evidence.sources)
            ? (row.evidence.sources as string[])
            : [])
        ])
      ];
      const confidence =
        nextSources.length >= 2
          ? 1
          : Math.max(target.confidence, row.confidence);
      if (!dryRun) {
        await admin
          .from("luna_links")
          .update({
            confidence,
            evidence: {
              ...target.evidence,
              ...row.evidence,
              sources: nextSources,
              merge_key: rowMerge
            }
          })
          .eq("id", target.id);
      }
      count.skipped += 1;
      existing.add(k);
      continue;
    }

    if (existing.has(k)) {
      count.skipped += 1;
      continue;
    }
    fresh.push(row);
  }

  count.would = fresh.length;
  if (dryRun || fresh.length === 0) return count;

  const batchSize = 200;
  for (let i = 0; i < fresh.length; i += batchSize) {
    const batch = fresh.slice(i, i + batchSize);
    const { error } = await admin.from("luna_links").upsert(
      batch.map((row) => ({
        from_type: row.from_type,
        from_id: row.from_id,
        to_type: row.to_type,
        to_id: row.to_id,
        kind: row.kind,
        confidence: row.confidence,
        evidence: row.evidence,
        source: row.source,
        status: row.status,
        confirmed_by: row.confirmed_by ?? null,
        confirmed_at: row.confirmed_at ?? null
      })),
      {
        onConflict: "from_type,from_id,to_type,to_id,kind",
        ignoreDuplicates: true
      }
    );
    if (error) throw new Error(`luna_links follows insert: ${error.message}`);
    for (const row of batch) existing.add(linkKey(row));
    count.inserted += batch.length;
  }
  if (fresh.length) log(`  follows insert ${fresh.length}건`);
  return count;
}

