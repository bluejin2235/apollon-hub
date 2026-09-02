export type MetricCompare = {
  current: number | null;
  previous: number | null;
  delta: number | null;
  delta_pct: number | null;
};

export type StatsPoint = {
  source: string;
  kind: string;
  /** 날짜 없는 합계 행은 빈 문자열이다 */
  date: string;
  /** GA4 속성 ID. GSC·옛 합계는 null */
  property_id?: string | null;
  key: string | null;
  key2: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  users: number | null;
  new_users: number | null;
  sessions: number | null;
  engaged_sessions: number | null;
  engagement_rate: number | null;
  avg_seconds: number | null;
  views: number | null;
  events: number | null;
  /** 날짜 없는 합계 행이 담은 기간. 날짜가 있는 행은 null */
  period_from: string | null;
  period_to: string | null;
};

export type KeyCompare = {
  /** ga4 와 gsc 가 같은 kind 를 쓴다. 섞이면 안 되므로 출처를 남긴다 */
  source: string;
  key: string | null;
  key2: string | null;
  users: MetricCompare;
  sessions: MetricCompare;
  views: MetricCompare;
  clicks: MetricCompare;
  impressions: MetricCompare;
  ctr: MetricCompare;
  position: MetricCompare;
};

/** 날짜 없는 합계가 담은 기간 */
export type StatsPeriod = { from: string; to: string };

export type StatsQueryResult = {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  kind: string;
  /** 고른 기간 안의 일별 행 */
  current: StatsPoint[];
  /** 그 앞 같은 길이 기간의 일별 행 */
  previous: StatsPoint[];
  /**
   * date 가 NULL 인 합계 행. 기간과 무관하게 늘 들어온다.
   * 옛 CSV 가 검색어·국가·기기·페이지를 기간 합계로만 줬기 때문이다.
   */
  overall: StatsPoint[];
  /** overall 이 담은 기간. 화면이 「언제부터 언제까지의 합계」인지 밝힌다 */
  overall_period: StatsPeriod | null;
  totals: {
    users: MetricCompare;
    new_users: MetricCompare;
    sessions: MetricCompare;
    views: MetricCompare;
    events: MetricCompare;
    clicks: MetricCompare;
    impressions: MetricCompare;
    ctr: MetricCompare;
    position: MetricCompare;
    engagement_rate: MetricCompare;
    avg_seconds: MetricCompare;
  };
  by_key: KeyCompare[];
};

/** kind 여러 개를 한 번에 받은 것 */
export type StatsBundle = Record<string, StatsQueryResult>;

/** GA4 Realtime — 부를 때마다 새로 받는다. DB 에 쌓지 않는다 */
export type StatsRealtimePage = {
  /** Realtime 의 unifiedScreenName — 경로가 아니라 페이지 제목이다 */
  name: string;
  users: number;
};

export type StatsRealtime = {
  /** GA4 오류면 null. 0 명과 구분한다 */
  activeUsers: number | null;
  pages: StatsRealtimePage[];
};

export type StatsScreenId =
  | "summary"
  | "content"
  | "search"
  | "ai-visibility"
  | "ai-crawler"
  | "behavior";

export const STATS_SCREENS: {
  id: StatsScreenId;
  href: string;
  label: string;
  lede: string;
}[] = [
  {
    id: "summary",
    href: "/website/stats/summary",
    label: "요약",
    lede: "이번 기간에 무엇이 달라졌고 그래서 무엇을 할지 정하는 화면입니다."
  },
  {
    id: "content",
    href: "/website/stats/content",
    label: "콘텐츠",
    lede: "사이트의 모든 페이지를 봅니다. 어디가 많이 읽히고, 어디로 들어와 어디로 가는지 봅니다."
  },
  {
    id: "search",
    href: "/website/stats/search",
    label: "검색",
    lede: "구글 검색에서 우리가 얼마나 보이는지 봅니다. 회사 이름 외의 검색어가 늘어야 새 사람이 옵니다."
  },
  {
    id: "ai-visibility",
    href: "/website/stats/ai-visibility",
    label: "AI 노출",
    lede: "AI에 질문을 던져 아폴론이 답변에 나오는지 셉니다. AI 회사가 이 데이터를 주지 않아 직접 물어보는 방법뿐입니다."
  },
  {
    id: "ai-crawler",
    href: "/website/stats/ai-crawler",
    label: "AI 크롤러",
    lede: "AI 회사의 수집 로봇이 다녀갔는지 봅니다. 로봇이 오지 않으면 아무리 잘 써도 인용될 수 없습니다. 인용의 앞 단계입니다."
  },
  {
    id: "behavior",
    href: "/website/stats/behavior",
    label: "행동",
    lede: "들어온 사람이 무엇을 하는지 봅니다. 홈페이지의 목표는 오래 머물다 문의로 이어지는 것입니다."
  }
];

export function isStatsScreenId(value: string): value is StatsScreenId {
  return STATS_SCREENS.some((item) => item.id === value);
}

export const PERIOD_PRESETS = [
  { id: "today", label: "오늘" },
  { id: "7d", label: "7일" },
  { id: "30d", label: "30일" },
  { id: "3m", label: "3개월" },
  { id: "6m", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "custom", label: "직접 설정" }
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];
