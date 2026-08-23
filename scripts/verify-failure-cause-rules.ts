/**
 * 실패 원인 규칙 — 실제 질문 패턴 단위 검증
 * npx tsx scripts/verify-failure-cause-rules.ts
 */
import { classifyFailureCause } from "../lib/luna/failure-cause";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  classifyFailureCause({
    question: "1번",
    answer_excerpt: "알겠습니다",
    signal: "unclassified",
    sources_used: {}
  }) === "clarify_mishandle",
  "pick 1번"
);

assert(
  classifyFailureCause({
    question: "더후 글로벌 론칭 KV 이미지 보여줘",
    answer_excerpt: "관련 자료를 찾지 못했습니다. ".repeat(8),
    signal: "not_found",
    signals: ["not_found"],
    sources_used: { wiki: 3, cards: 33, memory: 3, notion: 7 },
    source_ref: { last_had_clarify: true, clarify_followup: true },
    duration_ms: 19990
  }) === "search_miss",
  "clarify 직후라도 긴 not_found 는 검색 실패"
);

assert(
  classifyFailureCause({
    question: "우리가 한 아이데이션 중 lucky라는 이름이 들어간 프로그램이 뭐였지",
    signal: "not_found",
    signals: ["not_found", "low_confidence"],
    confidence_score: 2,
    sources_used: { wiki: 3, cards: 5, memory: 10, notion: 5 }
  }) === "search_miss",
  "자료가 있어도 not_found 면 검색 실패"
);

assert(
  classifyFailureCause({
    question: "가상 테스트가 뭐야?",
    signal: "thumbs_down",
    sources_used: { wiki: 0, memory: 10, notion: 0 }
  }) === "wiki_gap",
  "뭐야 + 위키 0"
);

assert(
  classifyFailureCause({
    question: "인스파이어 시즌3 착수보고서 어디 있어?",
    signal: "thumbs_down",
    sources_used: { wiki: 0, memory: 5, notion: 5 }
  }) === "search_miss",
  "찾아줘류 thumbs_down"
);

assert(
  classifyFailureCause({
    question: "야근 관련된 규정 찾아줘",
    signal: "thumbs_down",
    sources_used: { wiki: 3, memory: 0, notion: 5 },
    duration_ms: 54429
  }) === "human_correction",
  "규정+위키있음 thumbs_down → 내용 정정"
);

assert(
  classifyFailureCause({
    question: "운동복지 규정 알려줘",
    signal: "thumbs_down",
    sources_used: { wiki: 3, memory: 0, notion: 0 },
    duration_ms: 10322
  }) === "human_correction",
  "규정인데 위키는 있음 → 사람 정정 잔여"
);

assert(
  classifyFailureCause({
    question: "덱스터스튜디오랑 뭘 같이 했었지",
    signal: "low_confidence",
    confidence_score: 2,
    sources_used: { wiki: 3, cards: 5, memory: 10, notion: 5 }
  }) === "shallow_answer",
  "자료 3+ 자신감 낮음"
);

assert(
  classifyFailureCause({
    question: "1·2 모두",
    signal: "unclassified",
    sources_used: {}
  }) === "clarify_mishandle",
  "1·2 모두"
);

assert(
  classifyFailureCause({
    question: "감리가 뭐고 감리 관련 자료도 찾아줘",
    signal: "thumbs_down",
    sources_used: { wiki: 0, memory: 5, notion: 5 }
  }) === "wiki_gap",
  "뭐고 + 위키 0"
);

assert(
  classifyFailureCause({
    question: "내일 날씨",
    signal: "thumbs_down",
    sources_used: { wiki: 0, memory: 5, notion: 0 },
    duration_ms: 5539
  }) === "human_correction",
  "잔여 싫어요"
);

assert(
  classifyFailureCause({
    question: "스타에비뉴 제안서 어디 있어?",
    signal: "thumbs_down",
    sources_used: { wiki: 0, memory: 5, notion: 5 },
    duration_ms: 20084
  }) === "search_miss",
  "어디 있어 thumbs_down"
);

console.log("OK failure cause rules");
