/**
 * 실패 수집 — 중복 병합·되묻기 스킵·정기점검 분리 단위 검증
 * npx tsx scripts/verify-failures-dedupe.ts
 */
import {
  isInspectFailure,
  isLikelyClarifyPickQuestion,
  kindForSignals,
  matchesKindFilter,
  mergeFailureRowsByMessage,
  pickPrimarySignal,
  shouldSkipFailureForClarifyPick,
  summarizeFailureKinds,
  type FailureKind,
  type FailureSignal
} from "../lib/luna/failures-shared";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Row = {
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

const mid = "11111111-1111-1111-1111-111111111111";
const base = {
  answer_excerpt: "못 찾았습니다",
  intent_score: 8,
  confidence_score: 2,
  source_ref: {},
  created_at: "2026-08-22T01:00:00.000Z"
};

const a: Row = {
  ...base,
  id: "a",
  message_id: mid,
  question: "lucky라는 이름이",
  kind: "auto",
  signal: "not_found",
  self_note: null
};
const b: Row = {
  ...base,
  id: "b",
  message_id: mid,
  question: "lucky라는 이름이",
  kind: "self",
  signal: "low_confidence",
  self_note:
    "사용자가 과거 아이데이션에서 'Lucky'라는 단어가 포함된 프로그램명을 찾고 있다",
  created_at: "2026-08-22T01:00:01.000Z"
};

const merged = mergeFailureRowsByMessage([a, b]);
assert(merged.length === 1, "merge to 1");
assert(merged[0]!.signal === "not_found", "primary not_found over low_confidence");

const mid2 = "22222222-2222-2222-2222-222222222222";
const humanEmpty: Row & {
  sources_used?: Record<string, unknown>;
  duration_ms?: number | null;
} = {
  ...base,
  id: "h",
  message_id: mid2,
  question: "lucky 프로그램이 뭐였지",
  kind: "human",
  signal: "thumbs_down",
  sources_used: {},
  duration_ms: null,
  created_at: "2026-08-22T02:00:00.000Z"
};
const autoRich: Row & {
  sources_used?: Record<string, unknown>;
  duration_ms?: number | null;
} = {
  ...base,
  id: "r",
  message_id: mid2,
  question: "lucky 프로그램이 뭐였지",
  kind: "auto",
  signal: "not_found",
  sources_used: { wiki: 3, notion: 5, cards: 5, memory: 10 },
  duration_ms: 24135,
  created_at: "2026-08-22T01:59:00.000Z"
};
const mergedSrc = mergeFailureRowsByMessage([humanEmpty, autoRich]);
assert(mergedSrc.length === 1, "merge sources pair");
assert(
  (mergedSrc[0] as { sources_used?: { notion?: number } }).sources_used
    ?.notion === 5,
  "keep richest sources_used"
);
assert(
  (mergedSrc[0] as { duration_ms?: number | null }).duration_ms === 24135,
  "keep duration"
);
assert(
  (merged[0]!.signals ?? []).includes("not_found") &&
    (merged[0]!.signals ?? []).includes("low_confidence"),
  "signals both"
);
assert(Boolean(merged[0]!.self_note), "keep self_note");

assert(pickPrimarySignal(["low_confidence", "not_found"]) === "not_found", "prio");
assert(
  kindForSignals(["low_confidence", "not_found"]) === "auto",
  "kind follows primary not_found"
);
assert(kindForSignals(["low_confidence"]) === "self", "kind self alone");
assert(kindForSignals(["thumbs_down", "not_found"]) === "human", "kind human");

assert(isLikelyClarifyPickQuestion("1"), "1");
assert(isLikelyClarifyPickQuestion("1번"), "1번");
assert(isLikelyClarifyPickQuestion("1·2 모두"), "1·2 모두");
assert(!isLikelyClarifyPickQuestion("작년 미디어파사드 자료 모아줘"), "real q");
assert(
  shouldSkipFailureForClarifyPick({ lastHadClarify: true, userText: "1번" }),
  "helper still detects pick"
);
assert(
  !shouldSkipFailureForClarifyPick({ lastHadClarify: false, userText: "1번" }),
  "no skip without clarify"
);
// 기록은 건너뛰지 않는다. 되묻기 실패는 원인 묶음으로 모은다.

const inspect: Row = {
  ...base,
  id: "e",
  message_id: null,
  question: "SV가 뭐야?",
  kind: "auto",
  signal: "eval_fail",
  signals: ["eval_fail"],
  self_note: "점검 실패 사유"
};
assert(isInspectFailure(inspect), "inspect");
assert(matchesKindFilter(inspect, "inspect"), "tab inspect");
assert(!matchesKindFilter(inspect, "all"), "all excludes inspect");
assert(!matchesKindFilter(inspect, "auto"), "auto excludes inspect");

const summary = summarizeFailureKinds([merged[0]!, inspect]);
assert(summary.all === 1, "all=1");
assert(summary.inspect === 1, "inspect=1");

console.log("OK failures dedupe / clarify / inspect");
