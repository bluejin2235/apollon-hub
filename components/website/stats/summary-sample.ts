/**
 * 요약 화면에서 아직 실제 데이터로 못 바꾼 블록의 임시 값.
 * AI 질문 막대만 남았다. 루나 총평·할 일은 Anthropic API 로 옮겼다.
 */

import { STATS_BAD, STATS_COLORS, type StatsRow } from "@/components/website/stats/stats-chart";

/**
 * AI가 우리를 답변에 넣었는지 센 것.
 * AI 회사가 이 값을 주지 않아 직접 물어봐야 하는데, 그 결과를 담을 표를
 * 아직 만들지 않았다. website_stats 에도 이걸 담을 kind 가 없다.
 * 0.06 은 「0건」을 눈에 보이게 하려고 쓴 값이다. 실제로는 0 이다.
 */
export const AI_QUESTION_SAMPLE: StatsRow[] = [
  { name: "미디어파사드 잘하는 회사", count: 4 },
  { name: "인스파이어 오로라 제작사", count: 3 },
  { name: "몰입형 전시 기획 절차", count: 1 },
  { name: "리테일 미디어 연출 사례", count: 0.06 },
  { name: "공항 미디어아트 업체", count: 0.06 }
];

export const AI_QUESTION_COLORS = [
  STATS_COLORS[2],
  STATS_COLORS[2],
  STATS_COLORS[3],
  STATS_BAD,
  STATS_BAD
];

/** 맨 아래 한계 문구 */
export const SUMMARY_LIMIT_NOTE =
  "AI 유입은 실제보다 적게 잡힙니다. 유입처를 남기지 않는 방문이 35~70%입니다. 구글 AI 개요 클릭은 일반 검색에 섞입니다. 검색어는 일부가 가려집니다.";
