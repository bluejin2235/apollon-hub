/**
 * 요약 화면에서 아직 실제 데이터로 못 바꾼 블록의 임시 값.
 *
 * KPI·추이·경로·국가·기기·언어·검색어는 website_stats 를 읽도록 옮겼다
 * (summary-data.ts). 여기 남은 것은 담을 표가 아직 없어서 못 옮긴 것뿐이다.
 * 이 파일의 값은 전부 가짜다. 새로 쓰지 마라.
 */

import { STATS_BAD, STATS_COLORS, type StatsRow } from "@/components/website/stats/stats-chart";

/**
 * 루나 총평.
 * 기간 데이터를 읽고 글을 짓는 단계가 아직 없다. 읽을 데이터도 아직 없다.
 */
export const LUNA_SAMPLE = {
  who: "루나가 읽은 이번 기간 · 8월 30일",
  text: "AI를 통한 방문이 처음으로 검색을 넘었습니다. 대부분 「미디어파사드 시공」으로 들어와 스타애비뉴 한 장만 보고 나갔습니다. 워크는 잘 읽히는데 그다음으로 갈 길이 없습니다. 문의는 0건입니다."
};

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

export type TodoSample = {
  level: "high" | "mid" | "low";
  levelLabel: string;
  title: string;
  reason: string;
};

/**
 * 이번 기간 할 일.
 * 여러 화면의 값을 견줘 뽑아야 하는데 그 규칙을 아직 만들지 않았고,
 * 견줄 데이터도 아직 없다.
 */
export const TODO_SAMPLE: TodoSample[] = [
  {
    level: "high",
    levelLabel: "높음",
    title: "Star Avenue 아래에 관련 워크가 없습니다",
    reason: "84명 중 71명이 여기서 나갔습니다. 78%까지 읽었으니 내용이 아니라 길의 문제입니다"
  },
  {
    level: "mid",
    levelLabel: "중간",
    title: "「미디어아트 회사」 제목을 다시 쓸 때입니다",
    reason: "890번 노출됐는데 클릭 1건, 평균 순위 14.6위"
  },
  {
    level: "low",
    levelLabel: "낮음",
    title: "Trendy Youth Town이 sitemap에 없습니다",
    reason: "올린 지 9일인데 크롤러가 한 번도 오지 않았습니다"
  }
];

/** 맨 아래 한계 문구 */
export const SUMMARY_LIMIT_NOTE =
  "AI 유입은 실제보다 적게 잡힙니다. 유입처를 남기지 않는 방문이 35~70%입니다. 구글 AI 개요 클릭은 일반 검색에 섞입니다. 검색어는 일부가 가려집니다.";
