import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractKeyNouns } from "@/lib/luna/reflect-guard";
import { createCandidate } from "@/lib/luna/candidates";

export type FailureKind = "human" | "self" | "auto";

export type FailureSignal =
  | "thumbs_down"
  | "correction"
  | "candidate_deleted"
  | "low_intent"
  | "low_confidence"
  | "not_found"
  | "unclassified"
  | "zero_search"
  | "eval_fail";

export type FailureVerdict = "improve" | "skip" | null;

export type ImproveTarget = "knowledge" | "dev_wiki" | "prompt";

export type FailureKindFilter = "all" | "human" | "self" | "auto";

export type FailureDbFixKind = "wiki" | "term" | "knowledge";

export type FailureDbFix = {
  id: string;
  kind: FailureDbFixKind;
  title: string;
  details: string[];
  checked: boolean;
};

export type RecordFailureInput = {
  messageId?: string | null;
  conversationId?: string | null;
  askedBy?: string | null;
  question?: string;
  answerExcerpt?: string;
  kind: FailureKind;
  signal: FailureSignal;
  intentScore?: number | null;
  confidenceScore?: number | null;
  selfNote?: string | null;
  types?: string[];
  sourcesUsed?: Record<string, unknown>;
  durationMs?: number | null;
  sourceRef?: Record<string, unknown>;
};

export type FailureRow = {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  asked_by: string | null;
  question: string;
  answer_excerpt: string;
  kind: FailureKind;
  signal: FailureSignal;
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  types: string[];
  sources_used: Record<string, unknown>;
  duration_ms: number | null;
  cluster_key: string | null;
  verdict: FailureVerdict;
  improve_note: string | null;
  improve_target: ImproveTarget | null;
  db_fixes?: FailureDbFix[] | null;
  dev_prompt?: string | null;
  db_done_at?: string | null;
  dev_done_at?: string | null;
  dev_fixed_at?: string | null;
  source_ref: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
  asked_by_name?: string | null;
};

export type FailurePromptGroup = {
  key: string;
  count: number;
  title: string;
  prompts: Array<{ id: string; question: string; prompt: string }>;
};

const NOT_FOUND_RE =
  /찾(?:지|을)\s*못|확인(?:되)?지\s*않|없(?:습니다|어요|음)|못\s*찾|결과(?:가)?\s*0|검색(?:했(?:지만|으나)|(?:을|를)\s*돌렸(?:지만|으나))[^.\n]{0,24}0\s*건/;

function clipScore(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  if (v < 1 || v > 10) return null;
  return v;
}

function excerpt(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function failureClusterKey(question: string): string {
  const nouns = [...extractKeyNouns(question)].slice(0, 4);
  if (nouns.length > 0) return nouns.join("|").toLowerCase();
  const norm = question.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 48);
  return norm || "unknown";
}

export function isNotFoundAnswer(text: string): boolean {
  return NOT_FOUND_RE.test(text);
}

export function routeImproveNote(note: string): ImproveTarget {
  const t = note.trim();
  if (/위키|wiki|문서(?:에)?\s*있|문서(?:를)?\s*못/i.test(t)) return "dev_wiki";
  if (/프롬프트|이럴\s*땐|이럴\s*때|답변\s*방식|절차/i.test(t)) return "prompt";
  return "knowledge";
}

function kindFromText(text: string): FailureDbFixKind {
  if (/용어|동의어|같은 말/i.test(text)) return "term";
  if (/위키|문서|규정|절\s*추가/i.test(text)) return "wiki";
  return "knowledge";
}

function titleFromText(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "수정 항목";
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
}

function detailsFromText(text: string): string[] {
  const lines = text
    .split("\n")
    .map((v) => v.replace(/^[\-\u2022]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1, 8);
}

function normalizeFailureDbFixes(raw: unknown): FailureDbFix[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r, idx) => {
      if (!r || typeof r !== "object") return null;
      const row = r as Record<string, unknown>;
      const kind =
        row.kind === "wiki" || row.kind === "term" || row.kind === "knowledge"
          ? row.kind
          : "knowledge";
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const details = Array.isArray(row.details)
        ? row.details.filter((v): v is string => typeof v === "string").map((v) => v.trim())
        : [];
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `fix-${idx + 1}`;
      return {
        id,
        kind,
        title: title || "수정 항목",
        details,
        checked: row.checked !== false
      } satisfies FailureDbFix;
    })
    .filter((v): v is FailureDbFix => Boolean(v));
}

export function splitDbFixesFromNote(note: string): FailureDbFix[] {
  const chunks = note
    .split(/\n{2,}/)
    .map((v) => v.trim())
    .filter(Boolean);
  const base = chunks.length > 0 ? chunks : [note.trim()];
  return base.map((chunk, idx) => ({
    id: `fix-${idx + 1}`,
    kind: kindFromText(chunk),
    title: titleFromText(chunk.split("\n")[0] ?? chunk),
    details: detailsFromText(chunk),
    checked: true
  }));
}

export function buildCursorPrompt(row: FailureRow, note: string): string {
  const title = row.question ? `${row.question.slice(0, 50)} 관련 실패` : "실패 수집 개선";
  const src = row.sources_used && typeof row.sources_used === "object" ? row.sources_used : {};
  return [
    `# ${title}`,
    "",
    "## 증상",
    `- 질문: ${row.question || "(없음)"}`,
    `- 답변: ${row.answer_excerpt || "(없음)"}`,
    `- 주입된 소스: ${JSON.stringify(src)}`,
    "",
    "## 확인된 것",
    "- luna_failures 카드에서 사용자가 남긴 개선 메모를 확인했다.",
    `- 개선 메모: ${note.replace(/\s+/g, " ").trim() || "(없음)"}`,
    "",
    "## 조사할 것",
    "1. 관련 문서/위키 항목이 실제로 존재하는지 확인",
    "2. 검색/주입 경로에서 누락이 생기는 지점 확인",
    "3. 답변 프롬프트/검색 임계값 영향 범위 확인",
    "",
    "## 하지 말 것",
    "- 추측을 사실처럼 쓰지 마라.",
    "- 확인 못 한 것은 '~로 보인다'로 적어라.",
    "",
    "npx tsc --noEmit + npx next lint(Error 0) 통과 후",
    '커밋 "실패 수집 — 메뉴 위치·두 갈래 처리"'
  ].join("\n");
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg = "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("luna_failures") ||
    msg.includes("does not exist")
  );
}

export async function recordLunaFailure(
  admin: SupabaseClient,
  input: RecordFailureInput
): Promise<string | null> {
  const question = (input.question ?? "").trim();
  const answerExcerpt = excerpt(input.answerExcerpt ?? "");
  const row = {
    message_id: input.messageId ?? null,
    conversation_id: input.conversationId ?? null,
    asked_by: input.askedBy ?? null,
    question,
    answer_excerpt: answerExcerpt,
    kind: input.kind,
    signal: input.signal,
    intent_score: clipScore(input.intentScore ?? null),
    confidence_score: clipScore(input.confidenceScore ?? null),
    self_note: input.selfNote?.trim() || null,
    types: input.types ?? [],
    sources_used: input.sourcesUsed ?? {},
    duration_ms: input.durationMs ?? null,
    cluster_key: question ? failureClusterKey(question) : null,
    source_ref: input.sourceRef ?? {}
  };

  if (input.messageId) {
    const { data: existing } = await admin
      .from("luna_failures")
      .select("id")
      .eq("message_id", input.messageId)
      .eq("signal", input.signal)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await admin
        .from("luna_failures")
        .update({ ...row, verdict: null, resolved_at: null })
        .eq("id", existing.id);
      if (error && !isMissingTable(error)) {
        console.error("[luna/failures] update", error);
      }
      return existing.id as string;
    }
  }

  const { data, error } = await admin
    .from("luna_failures")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[luna/failures] insert", error);
    return null;
  }
  return (data?.id as string) ?? null;
}

export async function recordAutoFailuresFromAnswer(
  admin: SupabaseClient,
  opts: {
    messageId: string;
    conversationId: string;
    askedBy: string;
    question: string;
    answer: string;
    intentScore?: number | null;
    confidenceScore?: number | null;
    selfNote?: string | null;
    types?: string[];
    sourcesUsed?: Record<string, unknown>;
    durationMs?: number | null;
    classifyConfidence?: number | null;
    searchAttempted?: boolean;
    searchResultCount?: number;
  }
): Promise<void> {
  const base = {
    messageId: opts.messageId,
    conversationId: opts.conversationId,
    askedBy: opts.askedBy,
    question: opts.question,
    answerExcerpt: opts.answer,
    types: opts.types ?? [],
    sourcesUsed: opts.sourcesUsed ?? {},
    durationMs: opts.durationMs ?? null,
    intentScore: opts.intentScore,
    confidenceScore: opts.confidenceScore,
    selfNote: opts.selfNote
  };

  if (
    typeof opts.intentScore === "number" &&
    opts.intentScore < 5
  ) {
    await recordLunaFailure(admin, {
      ...base,
      kind: "self",
      signal: "low_intent"
    });
  }
  if (
    typeof opts.confidenceScore === "number" &&
    opts.confidenceScore < 5
  ) {
    await recordLunaFailure(admin, {
      ...base,
      kind: "self",
      signal: "low_confidence"
    });
  }
  if (isNotFoundAnswer(opts.answer)) {
    await recordLunaFailure(admin, {
      ...base,
      kind: "auto",
      signal: "not_found"
    });
  }
  if (
    typeof opts.classifyConfidence === "number" &&
    opts.classifyConfidence < 0.5
  ) {
    await recordLunaFailure(admin, {
      ...base,
      kind: "auto",
      signal: "unclassified",
      sourceRef: { confidence: opts.classifyConfidence }
    });
  }
  if (
    opts.searchAttempted &&
    (opts.searchResultCount ?? 0) === 0
  ) {
    await recordLunaFailure(admin, {
      ...base,
      kind: "auto",
      signal: "zero_search"
    });
  }
}

export async function listLunaFailures(
  admin: SupabaseClient,
  opts?: { verdict?: FailureVerdict | "open"; kind?: FailureKindFilter }
): Promise<FailureRow[]> {
  let q = admin
    .from("luna_failures")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts?.verdict === "open") {
    q = q.is("verdict", null);
  } else if (opts?.verdict) {
    q = q.eq("verdict", opts.verdict);
  }
  if (opts?.kind && opts.kind !== "all") {
    q = q.eq("kind", opts.kind);
  }
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const rows = (data ?? []) as FailureRow[];
  const userIds = [...new Set(rows.map((r) => r.asked_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      if (p.id && p.name) names.set(p.id as string, p.name as string);
    }
  }
  return rows.map((r) => ({
    ...r,
    db_fixes: normalizeFailureDbFixes((r as { db_fixes?: unknown }).db_fixes),
    asked_by_name: r.asked_by ? names.get(r.asked_by) ?? null : null
  }));
}

export type FailureCluster = {
  key: string;
  label: string;
  count: number;
  asker_count: number;
  items: FailureRow[];
};

export function clusterFailures(rows: FailureRow[]): FailureCluster[] {
  const map = new Map<string, FailureRow[]>();
  for (const row of rows) {
    if (row.verdict) continue;
    const key = row.cluster_key || failureClusterKey(row.question);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, items]) => {
      const askers = new Set(items.map((i) => i.asked_by).filter(Boolean));
      const label =
        items[0]?.question.replace(/\s+/g, " ").trim().slice(0, 42) || key;
      return {
        key,
        label,
        count: items.length,
        asker_count: askers.size,
        items
      };
    })
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count);
}

export async function setFailureVerdict(
  admin: SupabaseClient,
  id: string,
  verdict: "improve" | "skip",
  improveNote?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    verdict,
    resolved_at: now
  };
  if (verdict === "improve" && improveNote?.trim()) {
    patch.improve_note = improveNote.trim();
    patch.improve_target = routeImproveNote(improveNote);
  }
  const { error } = await admin.from("luna_failures").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveFailureImprovementDraft(
  admin: SupabaseClient,
  row: FailureRow,
  note: string
): Promise<{ db_fixes: FailureDbFix[]; dev_prompt: string }> {
  const dbFixes = splitDbFixesFromNote(note);
  const devPrompt = buildCursorPrompt(row, note);
  const { error } = await admin
    .from("luna_failures")
    .update({
      improve_note: note.trim(),
      improve_target: routeImproveNote(note),
      db_fixes: dbFixes,
      dev_prompt: devPrompt
    })
    .eq("id", row.id);
  if (error) throw error;
  return { db_fixes: dbFixes, dev_prompt: devPrompt };
}

export async function completeFailureDbFixes(
  admin: SupabaseClient,
  row: FailureRow,
  authorId: string,
  selectedIds: string[]
): Promise<{ created: number }> {
  const fixes = normalizeFailureDbFixes(row.db_fixes);
  const set = new Set(selectedIds);
  const picked = fixes.filter((f) => set.has(f.id));
  for (const fix of picked) {
    const content = [fix.title, ...fix.details.map((d) => `- ${d}`)].join("\n");
    await createCandidate(admin, {
      content,
      evidence: row.answer_excerpt || null,
      source: "chat",
      author_id: authorId,
      source_conversation_id: row.conversation_id,
      raw_input: row.question,
      meta: {
        capture_kind: fix.kind,
        from_failure: row.id,
        failure_signal: row.signal
      }
    });
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("luna_failures")
    .update({ db_done_at: now })
    .eq("id", row.id);
  if (error) throw error;
  return { created: picked.length };
}

export async function completeFailureDevPrompt(
  admin: SupabaseClient,
  rowId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("luna_failures")
    .update({ dev_done_at: now })
    .eq("id", rowId);
  if (error) throw error;
}

export async function markFailureImprovedIfDone(
  admin: SupabaseClient,
  rowId: string
): Promise<void> {
  const { data } = await admin
    .from("luna_failures")
    .select("db_done_at, dev_done_at")
    .eq("id", rowId)
    .maybeSingle();
  if (!data) return;
  if (data.db_done_at && data.dev_done_at) {
    await setFailureVerdict(admin, rowId, "improve");
  }
}

export function groupDevPrompts(rows: FailureRow[]): FailurePromptGroup[] {
  const map = new Map<string, FailurePromptGroup>();
  for (const row of rows) {
    if (!row.dev_done_at || !row.dev_prompt) continue;
    const key = row.cluster_key || failureClusterKey(row.question || row.answer_excerpt || "");
    const title = row.question.replace(/\s+/g, " ").trim().slice(0, 34) || key;
    const cur = map.get(key) ?? { key, count: 0, title, prompts: [] };
    cur.count += 1;
    cur.prompts.push({ id: row.id, question: row.question, prompt: row.dev_prompt });
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function mergeGroupPrompt(group: FailurePromptGroup): string {
  const body = group.prompts
    .map((p, i) => `### ${i + 1}. ${p.question || p.id}\n${p.prompt}`)
    .join("\n\n");
  return `# ${group.title} 묶음 개선\n\n${body}`;
}

export async function countOpenFailures(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from("luna_failures")
    .select("*", { count: "exact", head: true })
    .is("verdict", null);
  if (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function countFailuresSince(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<number> {
  const { count, error } = await admin
    .from("luna_failures")
    .select("*", { count: "exact", head: true })
    .is("verdict", null)
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function isAnswerScoresVisible(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", "answer_scores_visible")
    .maybeSingle();
  const v = data?.value as { visible?: boolean } | null;
  return v?.visible !== false;
}
