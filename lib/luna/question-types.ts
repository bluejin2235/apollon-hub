import type { SupabaseClient } from "@supabase/supabase-js";

export type QuestionTypeRow = {
  slug: string;
  label: string;
  criteria: string;
  sources: string;
  answer_form: string;
  prompt_key: string | null;
  needs_search: boolean;
  needs_library: boolean;
  skip_clarify: boolean;
  is_active: boolean;
  sort_order: number;
  updated_at?: string;
};

export type QuestionClassification = {
  types: string[];
  reason: string;
  confidence: number;
  switched: boolean;
  switch_reason: string | null;
};

export type LibraryItem = {
  slug: string;
  title: string;
  kind: string;
  content: string;
};

export type LibraryAdminRow = LibraryItem & {
  source_prompt_key: string | null;
  is_active: boolean;
  updated_at?: string;
};

export const LIBRARY_KIND_OPTIONS = [
  { value: "template", label: "문서양식" },
  { value: "analysis", label: "분석기준" },
  { value: "tone", label: "톤가이드" }
] as const;

export type LibraryKind = (typeof LIBRARY_KIND_OPTIONS)[number]["value"];

export function isLibraryKind(value: string): value is LibraryKind {
  return LIBRARY_KIND_OPTIONS.some((k) => k.value === value);
}

export function libraryKindLabel(kind: string): string {
  return LIBRARY_KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

export type UnclassifiedQuestionRow = {
  id: string;
  question: string;
  types: string[];
  reason: string | null;
  confidence: number | null;
  conversation_id: string | null;
  status: string;
  created_at: string;
};

/** 테이블이 없을 때만 쓰는 시드. 런타임 판정은 DB 행을 따른다. */
export const QUESTION_TYPE_SEED: QuestionTypeRow[] = [
  {
    slug: "know",
    label: "알기",
    criteria:
      "개념·용어·프로세스·역할·차이를 묻는 질문. 자료를 찾거나 만들지 않는다.",
    sources: "기억(확정 지식), 일반 지식. 검색 없음.",
    answer_form: "정의 먼저, 아폴론 맥락이 있으면 한 줄.",
    prompt_key: "type.know",
    needs_search: false,
    needs_library: false,
    skip_clarify: true,
    is_active: true,
    sort_order: 1
  },
  {
    slug: "find",
    label: "찾기",
    criteria:
      "파일·페이지·경로·자료의 위치나 원본을 찾는 질문. '어디', '찾아줘', '자료'.",
    sources: "Work서버, 노션, 필요 시 웹.",
    answer_form: "실측 경로와 근거 링크. 추측 경로 금지.",
    prompt_key: "type.find",
    needs_search: true,
    needs_library: false,
    skip_clarify: false,
    is_active: true,
    sort_order: 2
  },
  {
    slug: "make",
    label: "만들기",
    criteria: "체크리스트·초안·양식·산출물을 만들어 달라는 요청.",
    sources: "luna_library 양식. 없으면 되물음.",
    answer_form: "바로 쓸 수 있는 산출물. 양식 없으면 되물음.",
    prompt_key: "type.make",
    needs_search: false,
    needs_library: true,
    skip_clarify: false,
    is_active: true,
    sort_order: 3
  },
  {
    slug: "learn",
    label: "배우기",
    criteria: "사용자가 사실·용어·별칭을 알려주거나 정정한다.",
    sources: "이 턴의 사용자 발화. 검색 없음.",
    answer_form: "내용을 재진술하고 후보로 남긴다고 알린다.",
    prompt_key: "type.learn",
    needs_search: false,
    needs_library: false,
    skip_clarify: true,
    is_active: true,
    sort_order: 4
  },
  {
    slug: "smalltalk",
    label: "인사",
    criteria: "인사, 감사, 잡담. 업무 질문이 아님.",
    sources: "없음.",
    answer_form: "짧게 받아친다. 검색하지 않는다.",
    prompt_key: null,
    needs_search: false,
    needs_library: false,
    skip_clarify: true,
    is_active: true,
    sort_order: 5
  }
];

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function asText(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function mapTypeRow(row: Record<string, unknown>): QuestionTypeRow {
  return {
    slug: asText(row.slug),
    label: asText(row.label, asText(row.slug)),
    criteria: asText(row.criteria),
    sources: asText(row.sources),
    answer_form: asText(row.answer_form),
    prompt_key: typeof row.prompt_key === "string" ? row.prompt_key : null,
    needs_search: asBool(row.needs_search, false),
    needs_library: asBool(row.needs_library, false),
    skip_clarify: asBool(row.skip_clarify, false),
    is_active: asBool(row.is_active, true),
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined
  };
}

function isMissingTable(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return code === "42P01" || code === "PGRST205";
}

export async function loadQuestionTypes(
  admin: SupabaseClient,
  opts?: { activeOnly?: boolean }
): Promise<{ types: QuestionTypeRow[]; source: "db" | "seed" }> {
  try {
    let q = admin
      .from("luna_question_types")
      .select(
        "slug, label, criteria, sources, answer_form, prompt_key, needs_search, needs_library, skip_clarify, is_active, sort_order, updated_at"
      )
      .order("sort_order", { ascending: true });
    if (opts?.activeOnly !== false) {
      q = q.eq("is_active", true);
    }
    const { data, error } = await q;
    if (error) {
      if (!isMissingTable(error)) {
        console.error("[luna/types] load", error);
      }
      return { types: QUESTION_TYPE_SEED.filter((t) => t.is_active), source: "seed" };
    }
    const types = (data ?? [])
      .map((r) => mapTypeRow(r as Record<string, unknown>))
      .filter((t) => t.slug);
    if (types.length === 0) {
      return { types: QUESTION_TYPE_SEED.filter((t) => t.is_active), source: "seed" };
    }
    return { types, source: "db" };
  } catch (err) {
    console.error("[luna/types] load", err);
    return { types: QUESTION_TYPE_SEED.filter((t) => t.is_active), source: "seed" };
  }
}

export function formatTypeCatalog(types: QuestionTypeRow[]): string {
  return types
    .filter((t) => t.is_active)
    .map((t) => {
      const flags = [
        t.needs_search ? "검색함" : "검색안함",
        t.needs_library ? "양식필요" : null,
        t.skip_clarify ? "되묻기생략" : null
      ]
        .filter(Boolean)
        .join(", ");
      return [
        `slug: ${t.slug} (${t.label})`,
        `판정: ${t.criteria || "(없음)"}`,
        `소스: ${t.sources || "(없음)"}`,
        `답변: ${t.answer_form || "(없음)"}`,
        `플래그: ${flags}`
      ].join("\n");
    })
    .join("\n\n");
}

export function parseClassificationJson(
  text: string
): Pick<QuestionClassification, "types" | "reason" | "confidence"> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const row = parsed as Record<string, unknown>;
      const types = Array.isArray(row.types)
        ? row.types.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
            .map((t) => t.trim().toLowerCase())
        : typeof row.type === "string"
          ? [row.type.trim().toLowerCase()]
          : [];
      const reason = typeof row.reason === "string" ? row.reason.trim() : "";
      const confidenceRaw = row.confidence;
      const confidence =
        typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
          ? Math.min(1, Math.max(0, confidenceRaw))
          : 0;
      return { types, reason, confidence };
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

export function resolveClassification(
  parsed: Pick<QuestionClassification, "types" | "reason" | "confidence"> | null,
  catalog: QuestionTypeRow[],
  opts?: { forceSearch?: boolean }
): QuestionClassification {
  const active = catalog.filter((t) => t.is_active);
  const allowed = new Set(active.map((t) => t.slug));
  const raw = parsed?.types ?? [];
  const filtered = [...new Set(raw.filter((s) => allowed.has(s)))];
  let switched = false;
  let switch_reason: string | null = null;

  if (opts?.forceSearch && !filtered.some((s) => typeBySlug(active, s)?.needs_search)) {
    const searchType = active.find((t) => t.needs_search);
    if (searchType) {
      filtered.push(searchType.slug);
      switched = true;
      switch_reason = `커넥터 지정이 있어 ${searchType.label}을 추가`;
    }
  }

  return {
    types: filtered,
    reason: parsed?.reason ?? "",
    confidence: parsed?.confidence ?? 0,
    switched,
    switch_reason
  };
}

export function typeBySlug(
  types: QuestionTypeRow[],
  slug: string
): QuestionTypeRow | undefined {
  return types.find((t) => t.slug === slug);
}

export function classifiedRows(
  types: QuestionTypeRow[],
  slugs: string[]
): QuestionTypeRow[] {
  return slugs
    .map((s) => typeBySlug(types, s))
    .filter((t): t is QuestionTypeRow => Boolean(t));
}

export function typesNeedSearch(rows: QuestionTypeRow[]): boolean {
  return rows.some((t) => t.needs_search);
}

export function typesSkipClarify(rows: QuestionTypeRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((t) => t.skip_clarify);
}

export function typesNeedLibrary(rows: QuestionTypeRow[]): boolean {
  return rows.some((t) => t.needs_library);
}

export function formatTypeLabels(rows: QuestionTypeRow[]): string {
  const labels = rows.map((t) => t.label).filter(Boolean);
  return labels.join("+");
}

export function classificationPublic(
  c: QuestionClassification,
  rows: QuestionTypeRow[]
): QuestionClassification & { labels: string[] } {
  const matched = classifiedRows(rows, c.types);
  return {
    ...c,
    labels: matched.map((t) => t.label)
  };
}

export function typePromptKeys(rows: QuestionTypeRow[]): string[] {
  return rows
    .map((t) => t.prompt_key)
    .filter((k): k is string => Boolean(k && k.trim()));
}

export function isLowConfidence(c: QuestionClassification): boolean {
  return c.types.length === 0 || c.confidence < 0.45;
}

export async function recordUnclassifiedQuestion(
  admin: SupabaseClient,
  opts: {
    question: string;
    classification: QuestionClassification;
    conversationId?: string | null;
  }
): Promise<void> {
  try {
    const { error } = await admin.from("luna_unclassified_questions").insert({
      question: opts.question.slice(0, 2000),
      types: opts.classification.types,
      reason: opts.classification.reason || null,
      confidence: opts.classification.confidence,
      conversation_id: opts.conversationId ?? null,
      status: "pending"
    });
    if (error && !isMissingTable(error)) {
      console.error("[luna/types] unclassified insert", error);
    }
  } catch (err) {
    console.error("[luna/types] unclassified insert", err);
  }
}

function mapLibraryRow(row: Record<string, unknown>): LibraryAdminRow {
  return {
    slug: asText(row.slug),
    title: asText(row.title, asText(row.slug)),
    kind: asText(row.kind, "template"),
    content: asText(row.content),
    source_prompt_key:
      typeof row.source_prompt_key === "string" ? row.source_prompt_key : null,
    is_active: asBool(row.is_active, true),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined
  };
}

export async function loadLibraryItems(
  admin: SupabaseClient
): Promise<LibraryItem[]> {
  try {
    const { items } = await loadLibraryAdmin(admin, { activeOnly: true });
    return items.map(({ slug, title, kind, content }) => ({
      slug,
      title,
      kind,
      content
    }));
  } catch (err) {
    console.error("[luna/library] load", err);
    return [];
  }
}

export async function loadLibraryAdmin(
  admin: SupabaseClient,
  opts?: { activeOnly?: boolean }
): Promise<{ items: LibraryAdminRow[]; tableReady: boolean }> {
  try {
    let q = admin
      .from("luna_library")
      .select(
        "slug, title, kind, content, source_prompt_key, is_active, updated_at"
      )
      .order("title", { ascending: true });
    if (opts?.activeOnly) {
      q = q.eq("is_active", true);
    }
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return { items: [], tableReady: false };
      console.error("[luna/library] load", error);
      throw new Error(error.message);
    }
    return {
      items: (data ?? []).map((r) => mapLibraryRow(r as Record<string, unknown>)),
      tableReady: true
    };
  } catch (err) {
    console.error("[luna/library] load", err);
    throw err;
  }
}

export function matchLibraryItems(
  items: LibraryItem[],
  question: string
): LibraryItem[] {
  const q = question.toLowerCase().replace(/\s+/g, "");
  if (!q) return [];
  return items.filter((item) => {
    const hay = `${item.slug} ${item.title} ${item.kind}`.toLowerCase().replace(/\s+/g, "");
    if (!hay) return false;
    return hay.includes(q) || q.includes(hay) || tokenOverlap(q, hay);
  });
}

function tokenOverlap(q: string, hay: string): boolean {
  const tokens = q.match(/[가-힣]{2,}|[a-z0-9]{3,}/g) ?? [];
  if (tokens.length === 0) return false;
  return tokens.some((t) => hay.includes(t));
}

export function formatLibraryBlock(items: LibraryItem[]): string {
  if (items.length === 0) return "";
  return items
    .map((item) => `[라이브러리:${item.slug} ${item.title}]\n${item.content}`)
    .join("\n\n");
}

export function emptyClassification(): QuestionClassification {
  return {
    types: [],
    reason: "",
    confidence: 0,
    switched: false,
    switch_reason: null
  };
}

export function normalizeClassification(raw: unknown): QuestionClassification | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const types = Array.isArray(row.types)
    ? row.types.filter((t): t is string => typeof t === "string")
    : [];
  const reason = typeof row.reason === "string" ? row.reason : "";
  const confidence =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? row.confidence
      : 0;
  if (types.length === 0 && !reason) return null;
  return {
    types,
    reason,
    confidence,
    switched: row.switched === true,
    switch_reason:
      typeof row.switch_reason === "string"
        ? row.switch_reason
        : typeof row.switchReason === "string"
          ? row.switchReason
          : null
  };
}
