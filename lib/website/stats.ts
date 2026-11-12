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
  /**
   * 아래 칸은 홈페이지가 오픈일 기준으로 기간을 자른 뒤에 붙인다.
   * 아직 없는 응답이면 undefined 이고, 화면은 고른 기간으로 직접 계산한다.
   */
  actual_from?: string;
  actual_to?: string;
  clipped_to_launch?: boolean;
  prev_includes_pre_launch?: boolean;
  launch_date?: string;
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

/** 수집 종류 하나의 마지막 상태 — 홈페이지 website_stats_sync_state */
export type StatsSyncKindStatus = {
  source: string;
  kind: string;
  last_status: string | null;
  /** API 호출이 성공한 마지막 시각 (데이터 없음 포함) */
  last_ok_at: string | null;
  last_error: string | null;
  fail_streak: number;
  /** last_status 가 failed */
  failed: boolean;
  /** last_ok_at 이 없거나 36시간을 넘었다 */
  overdue: boolean;
};

export type StatsSyncStatus = {
  kinds: StatsSyncKindStatus[];
  /** GA daily 최근 데이터가 3일 넘게 비었다. 실패가 아니라 경고 */
  ga_daily_data_missing: boolean;
  ga_daily_latest_date: string | null;
};

/** 통계 묶음 + 수집 상태. 홈페이지가 수집 상태를 주지 않으면 sync_status 는 null */
export type StatsBundleResult = {
  bundle: StatsBundle;
  sync_status: StatsSyncStatus | null;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** 응답의 sync_status 를 읽는다. 모양이 다르면 null */
export function readStatsSyncStatus(value: unknown): StatsSyncStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.kinds)) return null;

  const kinds: StatsSyncKindStatus[] = record.kinds
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      source: typeof row.source === "string" ? row.source : "",
      kind: typeof row.kind === "string" ? row.kind : "",
      last_status: textOrNull(row.last_status),
      last_ok_at: textOrNull(row.last_ok_at),
      last_error: textOrNull(row.last_error),
      fail_streak: typeof row.fail_streak === "number" ? row.fail_streak : 0,
      failed: row.failed === true,
      overdue: row.overdue === true
    }));

  return {
    kinds,
    ga_daily_data_missing: record.ga_daily_data_missing === true,
    ga_daily_latest_date: textOrNull(record.ga_daily_latest_date)
  };
}

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

export type StatsScreenId = "summary" | "content" | "search" | "ai" | "behavior";

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
    id: "ai",
    href: "/website/stats/ai",
    label: "AI",
    /** 메뉴 이름은 label. 이 문장은 화면 제목으로만 쓴다. */
    lede: "AI가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?"
  },
  {
    id: "behavior",
    href: "/website/stats/behavior",
    label: "방문 패턴",
    lede: "들어온 사람이 무엇을 하는지 봅니다. 홈페이지의 목표는 오래 머물다 문의로 이어지는 것입니다."
  }
];

export function isStatsScreenId(value: string): value is StatsScreenId {
  return STATS_SCREENS.some((item) => item.id === value);
}

export const PERIOD_PRESETS = [
  { id: "yesterday", label: "어제" },
  { id: "7d", label: "7일" },
  { id: "30d", label: "30일" },
  { id: "3m", label: "3개월" },
  { id: "6m", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "custom", label: "직접 설정" }
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];
