/**
 * 요약 화면 임시 값 — docs/mockups/website-stats-mockup-v2.html 의 숫자를 그대로 옮긴 것.
 * 실제 데이터 연결은 다음 단계다. 이 파일의 값은 전부 가짜다.
 */

import {
  STATS_BAD,
  STATS_COLORS,
  STATS_MUTED,
  type StatsRow,
  type StatsScatterGroup,
  type StatsSlice
} from "@/components/website/stats/stats-chart";

/** 목업의 D */
const DAYS = ["8/25", "8/26", "8/27", "8/28", "8/29", "8/30", "8/31"];

function daily(values: Record<string, number[]>): StatsRow[] {
  return DAYS.map((date, index) => {
    const row: StatsRow = { date };
    for (const [key, series] of Object.entries(values)) {
      row[key] = series[index];
    }
    return row;
  });
}

/** 루나 총평 */
export const LUNA_SAMPLE = {
  who: "루나가 읽은 이번 기간 · 8월 30일",
  text: "AI를 통한 방문이 처음으로 검색을 넘었습니다. 대부분 「미디어파사드 시공」으로 들어와 스타애비뉴 한 장만 보고 나갔습니다. 워크는 잘 읽히는데 그다음으로 갈 길이 없습니다. 문의는 0건입니다."
};

/** KPI 다섯 개 — 목업의 k1~k5 스파크라인 포함 */
export type KpiSample = {
  id: string;
  value: string;
  /** ▲ 26% 같은 변화 한 줄. 없으면 — */
  delta: string | null;
  /** 변화가 좋은지 나쁜지 */
  tone: "up" | "down" | "flat";
  sparkColor: string;
  spark: StatsRow[];
};

function spark(values: number[]): StatsRow[] {
  return values.map((value, index) => ({ i: index, v: value }));
}

export const KPI_SAMPLE: KpiSample[] = [
  {
    id: "visit",
    value: "248",
    delta: "▲ 26%",
    tone: "up",
    sparkColor: STATS_COLORS[0],
    spark: spark([22, 24, 26, 31, 28, 35, 42])
  },
  {
    id: "imp",
    value: "3,412",
    delta: "▲ 41%",
    tone: "up",
    sparkColor: STATS_COLORS[0],
    spark: spark([380, 410, 520, 610, 480, 540, 472])
  },
  {
    id: "ai",
    value: "62",
    delta: "▲ 114%",
    tone: "up",
    sparkColor: STATS_COLORS[2],
    spark: spark([2, 4, 15, 12, 10, 12, 7])
  },
  {
    id: "bounce",
    value: "71%",
    delta: "▲ 19%p",
    tone: "down",
    sparkColor: "#b93b3b",
    spark: spark([52, 55, 61, 66, 68, 70, 71])
  },
  {
    id: "lead",
    value: "0",
    delta: null,
    tone: "flat",
    sparkColor: "#8b9098",
    spark: spark([0, 0, 0, 0, 0, 0, 0])
  }
];

/** 목업의 c_trend — 실선 이번 기간, 점선 지난 기간 */
export const TREND_SAMPLE = daily({
  current: [28, 31, 44, 39, 35, 42, 29],
  previous: [22, 24, 26, 23, 27, 25, 20]
});

/** 목업의 c_pie */
export const SOURCE_PIE_SAMPLE: StatsSlice[] = [
  { name: "검색", value: 79 },
  { name: "직접", value: 62 },
  { name: "AI", value: 62 },
  { name: "SNS", value: 45 }
];

/** 목업의 c_src — 경로별 일별 추이 */
export const SOURCE_DAILY_SAMPLE = daily({
  search: [14, 13, 12, 11, 10, 11, 8],
  direct: [9, 10, 8, 9, 8, 10, 8],
  ai: [2, 4, 15, 12, 10, 12, 7],
  sns: [3, 4, 9, 7, 7, 9, 6]
});

/** 목업의 c_qual — 점 크기가 방문 수다 */
export const SOURCE_QUALITY_SAMPLE: StatsScatterGroup[] = [
  { name: "검색", color: STATS_COLORS[0], points: [{ x: 100, y: 2.1, z: 79 }] },
  { name: "직접", color: STATS_COLORS[1], points: [{ x: 55, y: 1.3, z: 62 }] },
  { name: "AI", color: STATS_COLORS[2], points: [{ x: 130, y: 3.4, z: 62 }] },
  { name: "SNS", color: STATS_COLORS[3], points: [{ x: 40, y: 1.1, z: 45 }] }
];

/** 목업의 c_ctry */
export const COUNTRY_SAMPLE: StatsRow[] = [
  { name: "한국", value: 158 },
  { name: "미국", value: 34 },
  { name: "일본", value: 21 },
  { name: "대만", value: 12 },
  { name: "기타", value: 23 }
];

/** 목업의 c_dev */
export const DEVICE_SAMPLE: StatsSlice[] = [
  { name: "데스크톱", value: 194, color: STATS_COLORS[0] },
  { name: "모바일", value: 52, color: STATS_COLORS[1] },
  { name: "태블릿", value: 2, color: STATS_COLORS[3] }
];

/** 목업의 c_lang */
export const LANGUAGE_SAMPLE: StatsSlice[] = [
  { name: "국문 68%", value: 169, color: STATS_COLORS[0] },
  { name: "영문 32%", value: 79, color: STATS_COLORS[2] }
];

/** 목업의 c_kw — 노출(회색)과 클릭(파랑) */
export const KEYWORD_SAMPLE: StatsRow[] = [
  { name: "미디어파사드 시공", impressions: 1240, clicks: 34 },
  { name: "미디어아트 회사", impressions: 890, clicks: 1 },
  { name: "면세점 미디어아트", impressions: 412, clicks: 19 },
  { name: "랜드마크 미디어 연출", impressions: 308, clicks: 2 },
  { name: "아폴론이머시브웍스", impressions: 204, clicks: 61 }
];

/**
 * 목업의 c_aikw — 4개 AI 중 몇 곳이 언급했나.
 * 0.06 은 목업이 「0건」을 눈에 보이게 하려고 쓴 값이다. 실제 0 이다.
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

export const KEYWORD_IMPRESSION_COLOR = STATS_MUTED;

/** 목업의 「이번 기간 할 일」 */
export type TodoSample = {
  level: "high" | "mid" | "low";
  levelLabel: string;
  title: string;
  reason: string;
};

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
