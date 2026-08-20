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
  source_ref: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
  asked_by_name?: string | null;
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
  opts?: { verdict?: FailureVerdict | "open" }
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

export async function applyFailureImprovement(
  admin: SupabaseClient,
  row: FailureRow,
  note: string,
  authorId: string
): Promise<{ target: ImproveTarget }> {
  const target = routeImproveNote(note);
  if (target === "knowledge") {
    await createCandidate(admin, {
      content: note.trim(),
      evidence: row.answer_excerpt || null,
      source: "chat",
      author_id: authorId,
      source_conversation_id: row.conversation_id,
      raw_input: row.question,
      meta: {
        capture_kind: "knowledge",
        from_failure: row.id,
        failure_signal: row.signal
      }
    });
  }
  return { target };
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
