import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractKeyNouns } from "@/lib/luna/reflect-guard";
import { createCandidate } from "@/lib/luna/candidates";
import {
  isInspectFailure,
  kindForSignals,
  matchesKindFilter,
  mergeFailureRowsByMessage,
  pickPrimarySignal,
  uniqueFailureSignals,
  type FailureKind,
  type FailureKindFilter,
  type FailureSignal
} from "@/lib/luna/failures-shared";
import {
  classifyFailureCause,
  failureCauseMeta,
  type FailureCauseType
} from "@/lib/luna/failure-cause";

export type { FailureKind, FailureKindFilter, FailureSignal };
export type { FailureCauseType } from "@/lib/luna/failure-cause";
export {
  FAILURE_SIGNAL_PRIORITY,
  isInspectFailure,
  isLikelyClarifyPickQuestion,
  kindForSignals,
  matchesKindFilter,
  mergeFailureRowsByMessage,
  pickPrimarySignal,
  shouldSkipFailureForClarifyPick,
  summarizeFailureKinds
} from "@/lib/luna/failures-shared";
export {
  classifyFailureCause,
  failureCauseMeta,
  FAILURE_CAUSE_META,
  FAILURE_CAUSE_ORDER
} from "@/lib/luna/failure-cause";

export type FailureVerdict = "improve" | "skip" | null;

export type ImproveTarget = "knowledge" | "dev_wiki" | "prompt";

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
  /** message 당 감지된 신호 전체. 없으면 [signal] */
  signals?: FailureSignal[];
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
  human_note?: string | null;
  /** 조회 시 규칙으로 계산 (DB 컬럼 선택) */
  cause_type?: FailureCauseType;
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
  input: RecordFailureInput & { signals?: FailureSignal[] }
): Promise<string | null> {
  const question = (input.question ?? "").trim();
  const answerExcerpt = excerpt(input.answerExcerpt ?? "");
  const incomingSignals = uniqueFailureSignals([
    ...(input.signals ?? []),
    input.signal
  ]);
  const primary = pickPrimarySignal(incomingSignals);
  const kind = kindForSignals(incomingSignals, input.kind);

  const baseFields = {
    conversation_id: input.conversationId ?? null,
    asked_by: input.askedBy ?? null,
    question,
    answer_excerpt: answerExcerpt,
    kind,
    signal: primary,
    signals: incomingSignals,
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
    const { data: existingRows, error: findErr } = await admin
      .from("luna_failures")
      .select(
        "id, signal, signals, self_note, kind, source_ref, intent_score, confidence_score"
      )
      .eq("message_id", input.messageId);
    if (findErr && !isMissingTable(findErr)) {
      console.error("[luna/failures] find by message", findErr);
    }
    const existing = (existingRows ?? []) as Array<{
      id: string;
      signal: FailureSignal;
      signals?: FailureSignal[] | null;
      self_note: string | null;
      kind: FailureKind;
      source_ref: Record<string, unknown> | null;
      intent_score: number | null;
      confidence_score: number | null;
    }>;

    if (existing.length > 0) {
      const mergedSignals = uniqueFailureSignals([
        ...existing.flatMap((r) =>
          Array.isArray(r.signals) && r.signals.length > 0
            ? r.signals
            : [r.signal]
        ),
        ...incomingSignals
      ]);
      const mergedPrimary = pickPrimarySignal(mergedSignals);
      const mergedKind = kindForSignals(mergedSignals, kind);
      const keeper = existing[0]!;
      const selfNote =
        baseFields.self_note ||
        existing.map((r) => r.self_note?.trim()).find(Boolean) ||
        null;
      const intent =
        baseFields.intent_score ??
        existing.map((r) => r.intent_score).find((n) => n != null) ??
        null;
      const confidence =
        baseFields.confidence_score ??
        existing.map((r) => r.confidence_score).find((n) => n != null) ??
        null;
      const mergedRef = {
        ...(typeof keeper.source_ref === "object" && keeper.source_ref
          ? keeper.source_ref
          : {}),
        ...(input.sourceRef ?? {})
      };

      const patch: Record<string, unknown> = {
        ...baseFields,
        signal: mergedPrimary,
        kind: mergedKind,
        self_note: selfNote,
        intent_score: intent,
        confidence_score: confidence,
        source_ref: mergedRef,
        verdict: null,
        resolved_at: null
      };
      // signals 컬럼이 아직 없으면 한 번 재시도
      let { error } = await admin
        .from("luna_failures")
        .update(patch)
        .eq("id", keeper.id);
      if (error && String(error.message || "").includes("signals")) {
        delete patch.signals;
        ({ error } = await admin
          .from("luna_failures")
          .update(patch)
          .eq("id", keeper.id));
      }
      if (error && !isMissingTable(error)) {
        console.error("[luna/failures] merge update", error);
      }

      const dropIds = existing.slice(1).map((r) => r.id);
      if (dropIds.length > 0) {
        const { error: delErr } = await admin
          .from("luna_failures")
          .delete()
          .in("id", dropIds);
        if (delErr && !isMissingTable(delErr)) {
          console.error("[luna/failures] merge delete dupes", delErr);
        }
      }
      return keeper.id;
    }
  }

  const insertRow: Record<string, unknown> = {
    message_id: input.messageId ?? null,
    ...baseFields
  };
  let { data, error } = await admin
    .from("luna_failures")
    .insert(insertRow)
    .select("id")
    .maybeSingle();
  if (error && String(error.message || "").includes("signals")) {
    delete insertRow.signals;
    ({ data, error } = await admin
      .from("luna_failures")
      .insert(insertRow)
      .select("id")
      .maybeSingle());
  }
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
    sourceRef?: Record<string, unknown>;
  }
): Promise<void> {
  const signals: FailureSignal[] = [];
  if (typeof opts.intentScore === "number" && opts.intentScore < 5) {
    signals.push("low_intent");
  }
  if (typeof opts.confidenceScore === "number" && opts.confidenceScore < 5) {
    signals.push("low_confidence");
  }
  if (isNotFoundAnswer(opts.answer)) {
    signals.push("not_found");
  }
  if (
    typeof opts.classifyConfidence === "number" &&
    opts.classifyConfidence < 0.5
  ) {
    signals.push("unclassified");
  }
  if (opts.searchAttempted && (opts.searchResultCount ?? 0) === 0) {
    signals.push("zero_search");
  }
  if (signals.length === 0) return;

  const primary = pickPrimarySignal(signals);
  const sourceRef: Record<string, unknown> = { ...(opts.sourceRef ?? {}) };
  if (
    signals.includes("unclassified") &&
    typeof opts.classifyConfidence === "number"
  ) {
    sourceRef.confidence = opts.classifyConfidence;
  }
  await recordLunaFailure(admin, {
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
    selfNote: opts.selfNote,
    kind: kindForSignals(signals),
    signal: primary,
    signals,
    sourceRef
  });
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
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const raw = (data ?? []) as FailureRow[];
  const userIds = [...new Set(raw.map((r) => r.asked_by).filter(Boolean))] as string[];
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
  const enriched = raw.map((r) => {
    const ref =
      r.source_ref && typeof r.source_ref === "object" && !Array.isArray(r.source_ref)
        ? r.source_ref
        : {};
    const humanNote =
      typeof ref.feedback_note === "string" ? ref.feedback_note.trim() : "";
    const signals =
      Array.isArray(r.signals) && r.signals.length > 0
        ? (r.signals as FailureSignal[])
        : ([r.signal] as FailureSignal[]);
    // eval 사유가 self_note 비어 있으면 source_ref.reason 사용
    let selfNote = r.self_note;
    if (!selfNote?.trim() && typeof ref.reason === "string") {
      selfNote = ref.reason.trim();
    }
    return {
      ...r,
      signals,
      self_note: selfNote,
      db_fixes: normalizeFailureDbFixes((r as { db_fixes?: unknown }).db_fixes),
      asked_by_name: r.asked_by ? names.get(r.asked_by) ?? null : null,
      human_note: humanNote || null,
      cause_type: classifyFailureCause({
        question: r.question,
        answer_excerpt: r.answer_excerpt,
        signal: r.signal,
        signals,
        intent_score: r.intent_score,
        confidence_score: r.confidence_score,
        sources_used: r.sources_used,
        duration_ms: r.duration_ms,
        types: r.types,
        source_ref: ref
      })
    };
  });

  const merged = mergeFailureRowsByMessage(enriched);
  // merge 후 원인 재계산 (signals 합쳐짐)
  const withCause = merged.map((r) => ({
    ...r,
    cause_type: classifyFailureCause(r)
  }));
  if (!opts?.kind) return withCause;
  return withCause.filter((r) => matchesKindFilter(r, opts.kind!));
}

export type FailureCluster = {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  count: number;
  asker_count: number;
  previews: string[];
  items: FailureRow[];
};

/** 원인 유형으로 묶기 (건수·인원 많은 순) */
export function clusterFailures(rows: FailureRow[]): FailureCluster[] {
  const map = new Map<string, FailureRow[]>();
  for (const row of rows) {
    if (row.verdict) continue;
    if (isInspectFailure(row)) continue;
    const cause = classifyFailureCause(row);
    const list = map.get(cause) ?? [];
    list.push(row);
    map.set(cause, list);
  }
  return [...map.entries()]
    .map(([key, items]) => {
      const meta = failureCauseMeta(key as FailureCauseType);
      const askers = new Set(items.map((i) => i.asked_by).filter(Boolean));
      const previews: string[] = [];
      const seen = new Set<string>();
      for (const i of items) {
        const q = i.question.replace(/\s+/g, " ").trim();
        if (!q || seen.has(q)) continue;
        seen.add(q);
        previews.push(q.slice(0, 52));
        if (previews.length >= 3) break;
      }
      return {
        key: meta.type,
        label: meta.title,
        emoji: meta.emoji,
        blurb: meta.blurb,
        count: items.length,
        asker_count: askers.size,
        previews,
        items
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.asker_count - a.asker_count ||
        a.label.localeCompare(b.label, "ko")
    );
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

export type FailureThreadBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  duration_ms: number | null;
  wiki: number;
  memory: number;
  web: number;
  notion: number;
  intent: number | null;
  confidence: number | null;
};

export type FailureThreadTurn = {
  user: FailureThreadBubble | null;
  assistant: FailureThreadBubble | null;
};

export type FailureThreadPayload = {
  before: FailureThreadTurn[];
  focus: FailureThreadTurn | null;
  after: FailureThreadTurn[];
};

function asMetaObj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function countsFromMeta(meta: Record<string, unknown>): {
  wiki: number;
  memory: number;
  web: number;
  notion: number;
  duration_ms: number | null;
  intent: number | null;
  confidence: number | null;
} {
  const wiki = Array.isArray(meta.wiki_sources) ? meta.wiki_sources.length : 0;
  const memory = typeof meta.memory_count === "number" ? meta.memory_count : 0;
  const notionArr = Array.isArray(meta.notion_sources) ? meta.notion_sources : [];
  const cards = Array.isArray(meta.cards) ? meta.cards : [];
  let web = 0;
  let notion = notionArr.length;
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const type = (c as { type?: string }).type;
    if (type === "web" || type === "youtube") web += 1;
    if (type === "notion") notion += 1;
  }
  return {
    wiki,
    memory,
    web,
    notion,
    duration_ms:
      typeof meta.duration_ms === "number" && Number.isFinite(meta.duration_ms)
        ? meta.duration_ms
        : null,
    intent: clipScore(meta.intent_score),
    confidence: clipScore(meta.confidence_score)
  };
}

function toBubble(row: {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: unknown;
}): FailureThreadBubble {
  const meta = asMetaObj(row.metadata);
  const c = countsFromMeta(meta);
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: typeof row.content === "string" ? row.content : "",
    created_at: row.created_at,
    duration_ms: c.duration_ms,
    wiki: c.wiki,
    memory: c.memory,
    web: c.web,
    notion: c.notion,
    intent: c.intent,
    confidence: c.confidence
  };
}

function pairTurns(
  msgs: FailureThreadBubble[]
): FailureThreadTurn[] {
  const turns: FailureThreadTurn[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      turns.push({ user: m, assistant: null });
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && !last.assistant) last.assistant = m;
    else turns.push({ user: null, assistant: m });
  }
  return turns;
}

/** 실패 메시지 기준으로 앞뒤 2턴씩. */
export async function loadFailureThread(
  admin: SupabaseClient,
  row: FailureRow
): Promise<FailureThreadPayload> {
  const fallbackFocus: FailureThreadTurn = {
    user: row.question
      ? {
          id: "q",
          role: "user",
          content: row.question,
          created_at: row.created_at,
          duration_ms: null,
          wiki: 0,
          memory: 0,
          web: 0,
          notion: 0,
          intent: null,
          confidence: null
        }
      : null,
    assistant: {
      id: row.message_id ?? "a",
      role: "assistant",
      content: row.answer_excerpt || "",
      created_at: row.created_at,
      duration_ms: row.duration_ms,
      wiki: typeof row.sources_used?.wiki === "number" ? row.sources_used.wiki : 0,
      memory: typeof row.sources_used?.memory === "number" ? row.sources_used.memory : 0,
      web: typeof row.sources_used?.web === "number" ? row.sources_used.web : 0,
      notion: typeof row.sources_used?.notion === "number" ? row.sources_used.notion : 0,
      intent: row.intent_score,
      confidence: row.confidence_score
    }
  };

  if (!row.conversation_id) {
    return { before: [], focus: fallbackFocus, after: [] };
  }

  const { data, error } = await admin
    .from("luna_messages")
    .select("id, role, content, created_at, metadata")
    .eq("conversation_id", row.conversation_id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !data || data.length === 0) {
    return { before: [], focus: fallbackFocus, after: [] };
  }

  const bubbles = data.map((m) =>
    toBubble({
      id: String(m.id),
      role: String(m.role ?? ""),
      content: typeof m.content === "string" ? m.content : "",
      created_at: String(m.created_at),
      metadata: m.metadata
    })
  );
  const turns = pairTurns(bubbles);
  let idx = -1;
  if (row.message_id) {
    idx = turns.findIndex((t) => t.assistant?.id === row.message_id);
  }
  if (idx < 0 && row.question.trim()) {
    const q = row.question.replace(/\s+/g, " ").trim();
    idx = turns.findIndex(
      (t) => (t.user?.content.replace(/\s+/g, " ").trim() ?? "") === q
    );
  }
  if (idx < 0) {
    idx = turns.length - 1;
  }

  const focus = turns[idx] ?? fallbackFocus;
  if (focus.assistant && row.duration_ms && !focus.assistant.duration_ms) {
    focus.assistant.duration_ms = row.duration_ms;
  }
  if (focus.assistant) {
    if (row.intent_score != null) focus.assistant.intent = row.intent_score;
    if (row.confidence_score != null) {
      focus.assistant.confidence = row.confidence_score;
    }
  }

  return {
    before: turns.slice(Math.max(0, idx - 2), idx),
    focus,
    after: turns.slice(idx + 1, idx + 3)
  };
}
