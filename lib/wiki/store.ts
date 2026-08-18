import type { SupabaseClient } from "@supabase/supabase-js";
import { diffCounts } from "@/lib/wiki/diff";
import {
  contentToSections,
  parseRelated,
  parseSections,
  sectionsPlain,
  sectionsToContent
} from "@/lib/wiki/sections";
import {
  inferWikiCategory,
  isWikiCategory,
  type WikiCategory,
  type WikiDoc,
  type WikiDocListItem,
  type WikiHistoryEntry,
  type WikiRelated,
  type WikiSection
} from "@/lib/wiki/types";

const FULL_SELECT =
  "slug, title, kind, content, summary, category, sections, related, use_count, version, is_active, visible_to_staff, updated_at, updated_by, updated_by_name, history";
const BASE_SELECT =
  "slug, title, kind, content, source_prompt_key, is_active, updated_at";

export function isMissingWikiSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg = "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("column")
  );
}

function asText(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function parseHistory(raw: unknown): WikiHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WikiHistoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const version =
      typeof row.version === "number" && Number.isFinite(row.version)
        ? row.version
        : out.length + 1;
    out.push({
      version,
      at: asText(row.at, new Date().toISOString()),
      by: typeof row.by === "string" ? row.by : null,
      by_name: asText(row.by_name),
      summary: asText(row.summary),
      added: typeof row.added === "number" ? row.added : 0,
      removed: typeof row.removed === "number" ? row.removed : 0,
      title: asText(row.title),
      kind: asText(row.kind),
      summary_text: asText(row.summary_text),
      related: parseRelated(row.related),
      sections: parseSections(row.sections)
    });
  }
  return out.sort((a, b) => b.version - a.version);
}

function mapDoc(row: Record<string, unknown>, wikiReady: boolean): WikiDoc {
  const kind = asText(row.kind, "template");
  const slug = asText(row.slug);
  const categoryRaw = asText(row.category);
  const category = isWikiCategory(categoryRaw)
    ? categoryRaw
    : inferWikiCategory(kind, slug);
  const content = asText(row.content);
  let sections = wikiReady ? parseSections(row.sections) : [];
  if (sections.length === 0 && content) sections = contentToSections(content);
  return {
    slug,
    title: asText(row.title, slug),
    category,
    kind,
    summary: asText(row.summary),
    content: sections.length > 0 ? sectionsToContent(sections) : content,
    sections,
    related: wikiReady ? parseRelated(row.related) : [],
    use_count:
      typeof row.use_count === "number" && Number.isFinite(row.use_count)
        ? row.use_count
        : 0,
    version:
      typeof row.version === "number" && Number.isFinite(row.version)
        ? row.version
        : 1,
    is_active: row.is_active !== false,
    visible_to_staff: row.visible_to_staff !== false,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    updated_by: typeof row.updated_by === "string" ? row.updated_by : null,
    updated_by_name:
      typeof row.updated_by_name === "string" ? row.updated_by_name : null,
    history: wikiReady ? parseHistory(row.history) : []
  };
}

function toListItem(doc: WikiDoc): WikiDocListItem {
  return {
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    kind: doc.kind,
    summary: doc.summary,
    is_active: doc.is_active,
    visible_to_staff: doc.visible_to_staff,
    updated_at: doc.updated_at,
    updated_by: doc.updated_by,
    updated_by_name: doc.updated_by_name
  };
}

export async function loadWikiNavCounts(
  admin: SupabaseClient,
  opts?: { isSuperAdmin?: boolean }
): Promise<{
  terms: number;
  forms: number;
  standards: number;
  rules: number;
  wikiReady: boolean;
}> {
  let terms = 0;
  {
    let q = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    if (q.error) {
      q = await admin
        .from("glossary_terms")
        .select("id", { count: "exact", head: true });
    }
    terms = q.count ?? 0;
  }

  const { items, wikiReady } = await loadWikiDocs(admin, { activeOnly: true });
  const visible = opts?.isSuperAdmin
    ? items
    : items.filter((d) => d.visible_to_staff !== false);
  const forms = visible.filter((d) => d.category === "forms").length;
  const standards = visible.filter((d) => d.category === "standards").length;
  const rules = visible.filter((d) => d.category === "rules").length;
  return { terms, forms, standards, rules, wikiReady };
}

export async function loadWikiDocs(
  admin: SupabaseClient,
  opts?: { category?: WikiCategory; activeOnly?: boolean }
): Promise<{ items: WikiDoc[]; wikiReady: boolean; tableReady: boolean }> {
  const run = async (select: string) => {
    let q = admin.from("luna_library").select(select).order("title", {
      ascending: true
    });
    if (opts?.activeOnly) q = q.eq("is_active", true);
    return q;
  };

  let wikiReady = true;
  let res = await run(FULL_SELECT);
  if (res.error && isMissingWikiSchema(res.error)) {
    wikiReady = false;
    res = await run(BASE_SELECT);
  }
  if (res.error) {
    const code = String(res.error.code ?? "");
    if (code === "42P01" || code === "PGRST205") {
      return { items: [], wikiReady: false, tableReady: false };
    }
    throw new Error(res.error.message);
  }
  const rows = (res.data ?? []) as unknown as Record<string, unknown>[];
  let items = rows.map((r) => mapDoc(r, wikiReady));
  if (opts?.category) {
    items = items.filter((d) => d.category === opts.category);
  }
  return { items, wikiReady, tableReady: true };
}

export async function loadWikiDoc(
  admin: SupabaseClient,
  slug: string
): Promise<{ doc: WikiDoc | null; wikiReady: boolean; tableReady: boolean }> {
  const { items, wikiReady, tableReady } = await loadWikiDocs(admin);
  if (!tableReady) return { doc: null, wikiReady, tableReady };
  return {
    doc: items.find((d) => d.slug === slug) ?? null,
    wikiReady,
    tableReady
  };
}

export function listItems(docs: WikiDoc[]): WikiDocListItem[] {
  return docs.map(toListItem);
}

async function profileName(
  admin: SupabaseClient,
  userId: string
): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  return name || "알 수 없음";
}

function snapshot(
  doc: WikiDoc,
  opts: {
    version: number;
    at: string;
    by: string | null;
    by_name: string;
    summary: string;
    added: number;
    removed: number;
  }
): WikiHistoryEntry {
  return {
    version: opts.version,
    at: opts.at,
    by: opts.by,
    by_name: opts.by_name,
    summary: opts.summary,
    added: opts.added,
    removed: opts.removed,
    title: doc.title,
    kind: doc.kind,
    summary_text: doc.summary,
    related: doc.related,
    sections: doc.sections
  };
}

export async function createWikiDoc(
  admin: SupabaseClient,
  input: {
    slug: string;
    title: string;
    category: WikiCategory;
    kind: string;
    summary?: string;
    sections: WikiSection[];
    related?: WikiRelated[];
    userId: string;
  }
): Promise<WikiDoc> {
  const now = new Date().toISOString();
  const name = await profileName(admin, input.userId);
  const sections =
    input.sections.length > 0 ? input.sections : contentToSections("");
  const content = sectionsToContent(sections);
  const history: WikiHistoryEntry[] = [
    {
      version: 1,
      at: now,
      by: input.userId,
      by_name: name,
      summary: "최초 등록",
      added: sections.length,
      removed: 0,
      title: input.title,
      kind: input.kind,
      summary_text: input.summary ?? "",
      related: input.related ?? [],
      sections
    }
  ];
  const { data, error } = await admin
    .from("luna_library")
    .insert({
      slug: input.slug,
      title: input.title,
      kind: input.kind,
      content,
      category: input.category,
      summary: input.summary ?? "",
      sections,
      related: input.related ?? [],
      use_count: 0,
      version: 1,
      is_active: true,
      visible_to_staff: true,
      updated_at: now,
      updated_by: input.userId,
      updated_by_name: name,
      history
    })
    .select(FULL_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("저장하지 못했습니다.");
  return mapDoc(data as Record<string, unknown>, true);
}

export type WikiSaveMeta = {
  title?: string;
  kind?: string;
  summary?: string;
  related?: WikiRelated[];
  sections?: WikiSection[];
  is_active?: boolean;
  visible_to_staff?: boolean;
  change_note?: string;
};

export async function saveWikiDoc(
  admin: SupabaseClient,
  slug: string,
  patch: WikiSaveMeta,
  userId: string
): Promise<WikiDoc> {
  const loaded = await loadWikiDoc(admin, slug);
  if (!loaded.doc) throw new Error("not found");
  if (!loaded.wikiReady) {
    throw new Error("위키 마이그레이션을 실행한 뒤에 고칠 수 있습니다.");
  }
  const prev = loaded.doc;
  const nextSections = patch.sections ?? prev.sections;
  const nextTitle = patch.title?.trim() || prev.title;
  const nextKind = patch.kind?.trim() || prev.kind;
  const nextSummary =
    typeof patch.summary === "string" ? patch.summary : prev.summary;
  const nextRelated = patch.related ?? prev.related;
  const nextActive =
    typeof patch.is_active === "boolean" ? patch.is_active : prev.is_active;
  const nextVisible =
    typeof patch.visible_to_staff === "boolean"
      ? patch.visible_to_staff
      : prev.visible_to_staff;

  const counts = diffCounts(
    sectionsPlain(prev.sections),
    sectionsPlain(nextSections)
  );
  const now = new Date().toISOString();
  const name = await profileName(admin, userId);
  const nextVersion = prev.version + 1;
  const note = (patch.change_note ?? "").trim();
  const historyEntry = snapshot(prev, {
    version: nextVersion,
    at: now,
    by: userId,
    by_name: name,
    summary:
      note ||
      (typeof patch.is_active === "boolean"
        ? nextActive
          ? "다시 활성"
          : "비활성"
        : "수정"),
    added: counts.added,
    removed: counts.removed
  });
  historyEntry.title = nextTitle;
  historyEntry.kind = nextKind;
  historyEntry.summary_text = nextSummary;
  historyEntry.related = nextRelated;
  historyEntry.sections = nextSections;

  const history = [historyEntry, ...prev.history].slice(0, 80);
  const content = sectionsToContent(nextSections);

  const { data, error } = await admin
    .from("luna_library")
    .update({
      title: nextTitle,
      kind: nextKind,
      summary: nextSummary,
      related: nextRelated,
      sections: nextSections,
      content,
      is_active: nextActive,
      visible_to_staff: nextVisible,
      version: nextVersion,
      updated_at: now,
      updated_by: userId,
      updated_by_name: name,
      history
    })
    .eq("slug", slug)
    .select(FULL_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("not found");
  return mapDoc(data as Record<string, unknown>, true);
}

export async function revertWikiDoc(
  admin: SupabaseClient,
  slug: string,
  toVersion: number,
  userId: string
): Promise<WikiDoc> {
  const loaded = await loadWikiDoc(admin, slug);
  if (!loaded.doc) throw new Error("not found");
  const prev = loaded.doc;
  const target =
    prev.history.find((h) => h.version === toVersion) ??
    (toVersion === prev.version
      ? snapshot(prev, {
          version: prev.version,
          at: prev.updated_at ?? new Date().toISOString(),
          by: prev.updated_by,
          by_name: prev.updated_by_name ?? "알 수 없음",
          summary: "현재",
          added: 0,
          removed: 0
        })
      : null);
  if (!target) throw new Error("그 판을 찾을 수 없습니다.");
  return saveWikiDoc(
    admin,
    slug,
    {
      title: target.title || prev.title,
      kind: target.kind || prev.kind,
      summary: target.summary_text,
      related: target.related,
      sections: target.sections,
      change_note: `v${toVersion}으로 되돌림`
    },
    userId
  );
}

export async function deleteWikiDoc(
  admin: SupabaseClient,
  slug: string
): Promise<void> {
  const { error } = await admin.from("luna_library").delete().eq("slug", slug);
  if (error) throw new Error(error.message);
}

export async function bumpWikiUseCount(
  admin: SupabaseClient,
  slugs: string[]
): Promise<void> {
  if (slugs.length === 0) return;
  const unique = [...new Set(slugs.filter(Boolean))];
  await Promise.all(
    unique.map(async (slug) => {
      const { data } = await admin
        .from("luna_library")
        .select("use_count")
        .eq("slug", slug)
        .maybeSingle();
      const prev =
        typeof data?.use_count === "number" && Number.isFinite(data.use_count)
          ? data.use_count
          : 0;
      const { error } = await admin
        .from("luna_library")
        .update({ use_count: prev + 1 })
        .eq("slug", slug);
      if (error && !isMissingWikiSchema(error)) {
        console.error("[wiki] bump use_count", slug, error);
      }
    })
  );
}
