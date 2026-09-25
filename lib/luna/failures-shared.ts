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

const NOT_FOUND_RE =
  /찾(?:지|을)\s*못|확인(?:하|되)?지\s*(?:않|못)|없(?:습니다|어요|음)|못\s*찾|결과(?:가)?\s*0|검색(?:했(?:지만|으나)|(?:을|를)\s*돌렸(?:지만|으나))[^.\n]{0,24}0\s*건/;

/** An explicit positive retrieval statement makes a mixed answer partial, not wholly missing.
 * This remains a text heuristic, not proof that the cited source supports the answer.
 */
export function hasPositiveRetrievedEvidence(text: string): boolean {
  return text.split(/[.!?。\n]/).some(sentence =>
    /(?:자료|문서|파일|기록|이미지|사진|제안서|기획서)[^.!?\n]{0,32}(?:확인했습니다|확인했어요|찾았습니다|찾았어요|찾았고|확인했고)/.test(sentence) &&
    !/못|않|없|아니/.test(sentence)
  );
}

/** 답 본문이 「못 찾음」 계열인지 — UI·실패 수집 공용 */
export function isNotFoundAnswer(text: string): boolean {
  return NOT_FOUND_RE.test(text) && !hasPositiveRetrievedEvidence(text);
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
  if (!t || t.length > 12) return false;
  if (/^\d{1,2}번?$/.test(t)) return true;
  if (/^(예|아니요|아니|응|네|ㅇㅇ|ㄴㄴ|ok|yes|no)$/i.test(t)) return true;
  if (/^[1-9]$/.test(t)) return true;
  if (/모두|둘다|전부/.test(t)) return true;
  if (/^[1-9](·|,|\/)[1-9]/.test(t)) return true;
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
  sources_used?: Record<string, unknown> | null;
  duration_ms?: number | null;
  types?: string[] | null;
};

function sourceMaterialScore(
  sources: Record<string, unknown> | null | undefined
): number {
  if (!sources || typeof sources !== "object") return -1;
  const n = (k: string) => {
    const v = sources[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return n("wiki") + n("notion") + n("cards") + n("memory");
}

function pickRichestSources(
  rows: Array<{ sources_used?: Record<string, unknown> | null }>
): Record<string, unknown> | null | undefined {
  let best: Record<string, unknown> | null | undefined;
  let bestScore = -1;
  for (const r of rows) {
    const score = sourceMaterialScore(r.sources_used);
    if (score > bestScore) {
      bestScore = score;
      best = r.sources_used;
    }
  }
  return best;
}

function unionTypes(
  rows: Array<{ types?: string[] | null }>
): string[] | null | undefined {
  const out: string[] = [];
  let seen = false;
  for (const r of rows) {
    if (!Array.isArray(r.types)) continue;
    seen = true;
    for (const t of r.types) {
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return seen ? out : undefined;
}

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
    const duration =
      group.map((r) => r.duration_ms).find((n) => n != null) ?? null;
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
      sources_used: pickRichestSources(group) ?? keeper.sources_used,
      duration_ms: duration,
      types: unionTypes(group) ?? keeper.types,
      question:
        group.map((r) => r.question).find((q) => q.trim()) || keeper.question,
      answer_excerpt:
        group
          .map((r) => r.answer_excerpt)
          .sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))
          .find((a) => a.trim()) || keeper.answer_excerpt
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


/** 사람이 겪은 못 찾음 — 기계 시험보다 먼저 보여줄 질문 힌트 */
export const HUMAN_FIX_QUESTION_HINTS = [
  "출장비", "휴가", "운동 지원", "미디어파사드", "해운대", "고래",
  "인스파이어", "아크메르", "아트리움"
] as const;
export type FailureAskPreview = {
  key: string; question: string; count: number; latest_at: string; ids: string[];
};
export function normalizeFailureQuestion(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}
function humanFixHintRank(q: string): number {
  const i = HUMAN_FIX_QUESTION_HINTS.findIndex((h) => q.includes(h));
  return i === -1 ? 100 : i;
}
/** 열린 실패를 같은 질문끼리 묶어, 고칠 목록 순으로 정렬 */
export function groupOpenFailureAskItems(rows: Array<{
  id: string; question: string; created_at: string; verdict?: string | null;
  signal?: string; signals?: string[] | null;
}>): FailureAskPreview[] {
  const map = new Map<string, FailureAskPreview>();
  for (const r of rows) {
    if (r.verdict) continue;
    if (isInspectFailure({ signal: r.signal ?? "", signals: r.signals })) continue;
    const q = normalizeFailureQuestion(r.question);
    if (!q) continue;
    const cur = map.get(q);
    if (!cur) {
      map.set(q, { key: q, question: q, count: 1, latest_at: r.created_at, ids: [r.id] });
    } else {
      cur.count += 1;
      cur.ids.push(r.id);
      if (r.created_at > cur.latest_at) cur.latest_at = r.created_at;
    }
  }
  return [...map.values()].sort((a, b) => {
    const ra = humanFixHintRank(a.question), rb = humanFixHintRank(b.question);
    if (ra !== rb) return ra - rb;
    if (b.count !== a.count) return b.count - a.count;
    return a.latest_at < b.latest_at ? 1 : -1;
  });
}
