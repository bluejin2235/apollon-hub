import type { SupabaseClient } from "@supabase/supabase-js";
import { sameReasonLine, projectFromFullPath } from "@/lib/luna-admin/link-parse";
import {
  notionBreadcrumb,
  notionDbLabel,
  notionFactsLine,
  notionPathScore,
  questionDedupeKey,
  typeLabel,
  workFactsLine,
  type PairSideView
} from "@/lib/luna-admin/pair-view";
import type { LunaQuestionRow } from "@/lib/luna-admin/types";

function parseQuestionContext(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* plain */
      }
    }
  }
  return {};
}

function ctxStr(ctx: Record<string, unknown>, key: string): string {
  const v = ctx[key];
  return typeof v === "string" ? v : "";
}

function splitDrivePath(full: string): { drive: string; relative: string } | null {
  const folder = projectFromFullPath(full);
  if (folder) {
    return { drive: folder.drive, relative: folder.relativePath.replace(/\\+$/, "") };
  }
  const m = full.replace(/\//g, "\\").match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return null;
  return { drive: m[1]!.toUpperCase(), relative: m[2]!.replace(/\\+$/, "") };
}

function notionPropPlain(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const p = value as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type : "";
  if (type === "status" && p.status && typeof p.status === "object") {
    return String((p.status as { name?: string }).name ?? "").trim();
  }
  if (type === "select" && p.select && typeof p.select === "object") {
    return String((p.select as { name?: string }).name ?? "").trim();
  }
  if (type === "people" && Array.isArray(p.people)) {
    return p.people
      .map((row) =>
        row && typeof row === "object"
          ? String((row as { name?: string }).name ?? "").trim()
          : ""
      )
      .filter(Boolean)
      .join(", ");
  }
  if (type === "rich_text" && Array.isArray(p.rich_text)) {
    return p.rich_text
      .map((row) =>
        row && typeof row === "object"
          ? String((row as { plain_text?: string }).plain_text ?? "")
          : ""
      )
      .join("")
      .trim();
  }
  if (type === "created_time" && typeof p.created_time === "string") {
    return p.created_time;
  }
  if (type === "date" && p.date && typeof p.date === "object") {
    return String((p.date as { start?: string }).start ?? "").trim();
  }
  if (type === "formula" && p.formula && typeof p.formula === "object") {
    const f = p.formula as { string?: string; date?: { start?: string } };
    if (typeof f.string === "string") return f.string.trim();
    if (f.date?.start) return f.date.start;
  }
  return "";
}

function pickNotionProp(
  properties: Record<string, unknown> | null | undefined,
  needles: string[]
): string {
  if (!properties) return "";
  for (const [name, value] of Object.entries(properties)) {
    const n = name.replace(/\s+/g, "").toLowerCase();
    if (needles.some((k) => n.includes(k))) {
      const t = notionPropPlain(value);
      if (t) return t;
    }
  }
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object") continue;
    const type = (value as { type?: string }).type;
    if (needles.includes(`type:${type}`)) {
      const t = notionPropPlain(value);
      if (t) return t;
    }
  }
  return "";
}

function parseNotionFacts(
  properties: Record<string, unknown> | null | undefined,
  lastEdited: string | null
): { status: string; assignee: string; registered: string } {
  const status = pickNotionProp(properties, ["상태", "status", "진행"]);
  const assignee = pickNotionProp(properties, ["담당", "assignee", "owner", "파트"]);
  const registered =
    pickNotionProp(properties, ["등록", "생성일", "created"]) ||
    pickNotionProp(properties, ["type:created_time"]) ||
    lastEdited ||
    "";
  return { status, assignee, registered };
}

async function nasFolderStats(
  admin: SupabaseClient,
  fullPath: string
): Promise<{ files: number; lastModified: string | null }> {
  const split = splitDrivePath(fullPath);
  if (!split) return { files: 0, lastModified: null };
  const prefix = split.relative.endsWith("\\")
    ? split.relative
    : `${split.relative}\\`;
  const [countRes, lastRes] = await Promise.all([
    admin
      .from("nas_directory")
      .select("id", { count: "exact", head: true })
      .eq("drive", split.drive)
      .eq("type", "file")
      .gte("path", prefix)
      .lt("path", `${prefix}\uFFFF`),
    admin
      .from("nas_directory")
      .select("modified_at")
      .eq("drive", split.drive)
      .eq("type", "file")
      .gte("path", prefix)
      .lt("path", `${prefix}\uFFFF`)
      .order("modified_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  const last =
    lastRes.data && typeof lastRes.data.modified_at === "string"
      ? lastRes.data.modified_at
      : null;
  return { files: countRes.count ?? 0, lastModified: last };
}

type NotionRow = {
  page_id: string;
  title: string;
  path_titles: string[] | null;
  root_title: string | null;
  last_edited_time: string | null;
  properties: Record<string, unknown> | null;
};

type BundleRow = {
  from_id: string;
  evidence: Record<string, unknown> | null;
};

export async function enrichQuestionPairs(
  admin: SupabaseClient,
  rows: LunaQuestionRow[]
): Promise<LunaQuestionRow[]> {
  const linkIds = [
    ...new Set(rows.map((r) => r.link_id).filter((id): id is string => Boolean(id)))
  ];
  const notionIds: string[] = [];
  const nasPaths: string[] = [];
  for (const row of rows) {
    const ctx = row.context;
    for (const side of ["from", "to"] as const) {
      const type = ctxStr(ctx, `${side}_type`);
      const id = ctxStr(ctx, `${side}_id`);
      if (type === "notion_page" && id) notionIds.push(id);
      if (type === "nas_path" && id) nasPaths.push(id);
    }
  }

  const linksById = new Map<
    string,
    {
      id: string;
      source: string;
      evidence: Record<string, unknown> | null;
      from_id: string;
      to_id: string;
    }
  >();
  if (linkIds.length) {
    const { data } = await admin
      .from("luna_links")
      .select("*")
      .in("id", linkIds);
    for (const row of data ?? []) {
      linksById.set(String(row.id), {
        id: String(row.id),
        source: String(row.source ?? ""),
        evidence: (row.evidence as Record<string, unknown> | null) ?? null,
        from_id: String(row.from_id ?? ""),
        to_id: String(row.to_id ?? "")
      });
    }
  }

  const uniqueNas = [...new Set(nasPaths)];
  const uniqueNotion = [...new Set(notionIds)];

  const [notionRes, bundleRes] = await Promise.all([
    uniqueNotion.length
      ? admin
          .from("luna_notion_pages")
          .select("page_id, title, path_titles, root_title, last_edited_time, properties")
          .in("page_id", uniqueNotion)
      : Promise.resolve({ data: [] as NotionRow[] }),
    uniqueNas.length
      ? admin
          .from("luna_links")
          .select("from_id, evidence")
          .eq("kind", "belongs")
          .filter("evidence->>role", "eq", "bundle")
          .in("from_id", uniqueNas)
      : Promise.resolve({ data: [] as BundleRow[] })
  ]);

  const notionById = new Map<string, NotionRow>();
  for (const row of (notionRes.data ?? []) as NotionRow[]) {
    notionById.set(row.page_id, row);
  }
  const bundleByPath = new Map<string, BundleRow>();
  for (const row of (bundleRes.data ?? []) as BundleRow[]) {
    bundleByPath.set(row.from_id, row);
  }

  const nasStats = new Map<string, { files: number; lastModified: string | null }>();
  await Promise.all(
    uniqueNas.map(async (path) => {
      nasStats.set(path, await nasFolderStats(admin, path));
    })
  );

  function sideView(
    type: string,
    id: string,
    title: string,
    pathHint: string
  ): PairSideView {
    if (type === "nas_path") {
      const path = pathHint || id;
      const stats = nasStats.get(id) ?? nasStats.get(path);
      const bundle = bundleByPath.get(id) ?? bundleByPath.get(path);
      const ev = bundle?.evidence ?? {};
      const fileCount =
        typeof ev.file_count === "number" ? ev.file_count : stats?.files ?? 0;
      const children = Array.isArray(ev.children)
        ? (ev.children as Array<{ label?: string }>)
            .map((c) => c.label ?? "")
            .filter(Boolean)
        : [];
      return {
        typeLabel: typeLabel(type, { path }),
        title: title || path.split("\\").pop() || id,
        path,
        facts: workFactsLine({
          fileCount,
          lastModified: stats?.lastModified ?? null,
          folders: children
        })
      };
    }
    if (type === "notion_page") {
      const page = notionById.get(id);
      const titles = page?.path_titles ?? null;
      const path = notionBreadcrumb(titles, title) || pathHint;
      const db = notionDbLabel(titles);
      const facts = parseNotionFacts(page?.properties ?? null, page?.last_edited_time ?? null);
      return {
        typeLabel: typeLabel(type, { db }),
        title: title || page?.title || id,
        path,
        facts: notionFactsLine(facts)
      };
    }
    return {
      typeLabel: typeLabel(type, { path: pathHint }),
      title: title || id,
      path: pathHint || id,
      facts: ""
    };
  }

  return rows.map((row) => {
    const ctx = row.context;
    const fromType = ctxStr(ctx, "from_type");
    const toType = ctxStr(ctx, "to_type");
    if (!fromType || !toType) return { ...row, pair: null };
    const link = row.link_id ? linksById.get(row.link_id) : undefined;
    const ev = link?.evidence ?? {};
    const fromTitle = ctxStr(ctx, "from_title") || String(ev.from_title ?? "");
    const toTitle = ctxStr(ctx, "to_title") || String(ev.to_title ?? "");
    const fromPath = ctxStr(ctx, "from_path") || String(ev.from_path ?? "");
    const toPath = ctxStr(ctx, "to_path") || String(ev.to_path ?? "");
    const left = sideView(fromType, ctxStr(ctx, "from_id"), fromTitle, fromPath);
    const right = sideView(toType, ctxStr(ctx, "to_id"), toTitle, toPath);
    const reason = link
      ? sameReasonLine(link)
      : row.why || "이름만으로는 같은 건인지 확정하지 못해 묻습니다.";
    return { ...row, pair: { left, right, reason } };
  });
}

export async function dedupeSameQuestions(
  admin: SupabaseClient
): Promise<{ before: number; after: number; skipped: number }> {
  const { data, error } = await admin
    .from("luna_questions")
    .select("id, context, created_at, status")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    context: unknown;
    created_at: string;
    status: string;
  }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const ctx = parseQuestionContext(row.context);
    const key = questionDedupeKey({
      from_id: String(ctx.from_id ?? ""),
      to_id: String(ctx.to_id ?? ""),
      to_type: String(ctx.to_type ?? ""),
      to_title: String(ctx.to_title ?? "")
    });
    if (!key.replace(/\t/g, "")) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const skipIds: string[] = [];
  const notionIds = [
    ...new Set(
      rows
        .map((row) => {
          const ctx = parseQuestionContext(row.context);
          return String(ctx.to_type) === "notion_page" ? String(ctx.to_id ?? "") : "";
        })
        .filter(Boolean)
    )
  ];
  const pathByPage = new Map<string, string>();
  if (notionIds.length) {
    const { data: pages } = await admin
      .from("luna_notion_pages")
      .select("page_id, path_titles")
      .in("page_id", notionIds);
    for (const page of pages ?? []) {
      pathByPage.set(
        String(page.page_id),
        notionBreadcrumb((page.path_titles as string[] | null) ?? null)
      );
    }
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const scored = list.map((row) => {
      const ctx = parseQuestionContext(row.context);
      const pageId = String(ctx.to_id ?? "");
      const path =
        String(ctx.to_path ?? "") || pathByPage.get(pageId) || String(ctx.from_path ?? "");
      return { row, score: notionPathScore(path) };
    });
    scored.sort((a, b) => b.score - a.score);
    for (const extra of scored.slice(1)) skipIds.push(extra.row.id);
  }

  for (let i = 0; i < skipIds.length; i += 50) {
    const batch = skipIds.slice(i, i + 50);
    const { error: delErr } = await admin
      .from("luna_questions")
      .delete()
      .in("id", batch);
    if (delErr) throw new Error(delErr.message);
  }

  return {
    before: rows.length,
    after: rows.length - skipIds.length,
    skipped: skipIds.length
  };
}
