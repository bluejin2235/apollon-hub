/**
 * 실패 수집 — 서버 전용 의존 없는 순수 헬퍼 (tsx 검증·UI 공용 가능)
 */
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

export type FailureKindFilter = "all" | "human" | "self" | "auto" | "inspect";

export const FAILURE_SIGNAL_PRIORITY: FailureSignal[] = [
  "thumbs_down",
  "correction",
  "not_found",
  "low_confidence",
  "low_intent",
  "zero_search",
  "unclassified",
  "candidate_deleted",
  "eval_fail"
];

export function pickPrimarySignal(signals: FailureSignal[]): FailureSignal {
  for (const s of FAILURE_SIGNAL_PRIORITY) {
    if (signals.includes(s)) return s;
  }
  return signals[0] ?? "unclassified";
}

export function kindForSignals(
  signals: FailureSignal[],
  fallback: FailureKind = "auto"
): FailureKind {
  if (signals.length === 0) return fallback;
  const primary = pickPrimarySignal(signals);
  if (primary === "thumbs_down" || primary === "correction") return "human";
  if (primary === "low_confidence" || primary === "low_intent") return "self";
  return "auto";
}

export function isInspectFailure(row: {
  signal: string;
  signals?: string[] | null;
}): boolean {
  if (row.signal === "eval_fail") return true;
  return Array.isArray(row.signals) && row.signals.includes("eval_fail");
}

export function uniqueFailureSignals(list: FailureSignal[]): FailureSignal[] {
  const out: FailureSignal[] = [];
  for (const s of list) {
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function shouldSkipFailureForClarifyPick(opts: {
  lastHadClarify: boolean;
  userText: string;
}): boolean {
  if (!opts.lastHadClarify) return false;
  return isLikelyClarifyPickQuestion(opts.userText);
}

export function isLikelyClarifyPickQuestion(question: string): boolean {
  const t = question.replace(/\s+/g, "").trim();
  if (!t || t.length > 10) return false;
  if (/^\d{1,2}번?$/.test(t)) return true;
  if (/^(예|아니요|아니|응|네|ㅇㅇ|ㄴㄴ|ok|yes|no)$/i.test(t)) return true;
  if (/^[1-9]$/.test(t)) return true;
  return false;
}

export function matchesKindFilter(
  row: { kind: FailureKind; signal: string; signals?: string[] | null },
  kind: FailureKindFilter
): boolean {
  const inspect = isInspectFailure(row);
  if (kind === "inspect") return inspect;
  if (kind === "all") return !inspect;
  if (inspect) return false;
  return row.kind === kind;
}

export type FailureMergeRow = {
  id: string;
  message_id: string | null;
  question: string;
  answer_excerpt: string;
  kind: FailureKind;
  signal: FailureSignal;
  signals?: FailureSignal[];
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  human_note?: string | null;
  source_ref: Record<string, unknown>;
  created_at: string;
};

export function mergeFailureRowsByMessage<T extends FailureMergeRow>(
  rows: T[]
): T[] {
  const byMessage = new Map<string, T[]>();
  const singles: T[] = [];
  for (const row of rows) {
    if (!row.message_id) {
      singles.push(row);
      continue;
    }
    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }

  const merged: T[] = [];
  for (const [, group] of byMessage) {
    if (group.length === 1) {
      const only = group[0]!;
      const sigs =
        Array.isArray(only.signals) && only.signals.length > 0
          ? only.signals
          : [only.signal];
      merged.push({ ...only, signals: uniqueFailureSignals(sigs) });
      continue;
    }
    group.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const keeper = group[0]!;
    const allSignals = uniqueFailureSignals(
      group.flatMap((r) =>
        Array.isArray(r.signals) && r.signals.length > 0 ? r.signals : [r.signal]
      )
    );
    const primary = pickPrimarySignal(allSignals);
    const selfNote =
      group.map((r) => r.self_note?.trim()).find(Boolean) || null;
    const humanNote =
      group.map((r) => r.human_note?.trim()).find(Boolean) || null;
    const intent =
      group.map((r) => r.intent_score).find((n) => n != null) ?? null;
    const confidence =
      group.map((r) => r.confidence_score).find((n) => n != null) ?? null;
    const refs = group.reduce<Record<string, unknown>>((acc, r) => {
      if (r.source_ref && typeof r.source_ref === "object") {
        return { ...acc, ...r.source_ref };
      }
      return acc;
    }, {});
    merged.push({
      ...keeper,
      signal: primary,
      signals: allSignals,
      kind: kindForSignals(allSignals, keeper.kind),
      self_note: selfNote,
      human_note: humanNote,
      intent_score: intent,
      confidence_score: confidence,
      source_ref: refs,
      question:
        group.map((r) => r.question).find((q) => q.trim()) || keeper.question,
      answer_excerpt:
        group.map((r) => r.answer_excerpt).find((a) => a.trim()) ||
        keeper.answer_excerpt
    });
  }

  return [...merged, ...singles].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function summarizeFailureKinds(
  allMerged: Array<{
    kind: FailureKind;
    signal: string;
    signals?: string[] | null;
  }>
): {
  all: number;
  human: number;
  self: number;
  auto: number;
  inspect: number;
} {
  const inspect = allMerged.filter((r) => isInspectFailure(r));
  const rest = allMerged.filter((r) => !isInspectFailure(r));
  return {
    all: rest.length,
    human: rest.filter((r) => r.kind === "human").length,
    self: rest.filter((r) => r.kind === "self").length,
    auto: rest.filter((r) => r.kind === "auto").length,
    inspect: inspect.length
  };
}
