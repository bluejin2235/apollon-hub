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
  /** page_engagement 의 글별 평균 참여 시간(초). 옛 응답에는 없다 */
  avg_seconds?: MetricCompare;
};

/** 목표 키워드(3-8) 한 줄의 노출·클릭·순위 */
export type TargetKeywordMetrics = { impressions: number; clicks: number; position: number | null };

/** kind=target_keywords 응답. 홈페이지 lib/stats/target-keywords-core.ts 와 같은 모양 */
export type TargetKeywordsPayload = {
  total: number;
  goal: number;
  top10: number;
  not_seen: number;
  rows: {
    id: number;
    keyword: string;
    lang: "ko" | "en";
    keyword_group: string | null;
    priority: number;
    target_page: string | null;
    current: TargetKeywordMetrics;
    previous: TargetKeywordMetrics;
    newly_seen: boolean;
    related_queries: number;
  }[];
};

/** AI ② 「답에 씀」 요약 — 홈페이지 lib/stats/ai-answers.ts AiAnswerSummary 와 같은 모양 */
export type AiAnswerCount = {
  mentioned: number;
  checked: number;
  previous: { mentioned: number; checked: number } | null;
  diff_pp: number | null;
  diff_count: number | null;
};

/**
 * 질문 × AI 한 칸. 아래 네 칸(답변 내용 · 인용 주소 · 답 속 순서 · 틀린 사실)은 홈페이지가 아직 주지 않는다.
 * 홈페이지 summarizeAiAnswers 가 website_ai_answer_checks 의 같은 이름 열을 칸에 붙이면 화면이 바로 보인다.
 */
export type AiAnswerCell = {
  mentioned: boolean;
  previous: boolean | null;
  changed: boolean;
  answer_excerpt?: string | null;
  cited_urls?: string[];
  rank_in_answer?: number | null;
  wrong_fact_note?: string | null;
};

export type AiAnswerSummary = {
  rounds: { checked_on: string; services: string[]; checks: number }[];
  latest: string | null;
  previous: string | null;
  total: AiAnswerCount;
  services: (AiAnswerCount & { ai_service: string; label: string })[];
  grid: {
    question_id: number;
    question: string;
    group: string;
    cells: Record<string, AiAnswerCell | undefined>;
    changed: boolean;
  }[];
  cited_top: { url: string; count: number }[];
  wrong_facts: { question_id: number; question: string; ai_service: string; label: string; note: string | null }[];
};

/** 목표 키워드 설정 화면 한 줄(관리 API) */
export type TargetKeywordItem = {
  id: number;
  keyword: string;
  keyword_norm: string;
  lang: "ko" | "en";
  keyword_group: string | null;
  priority: number;
  target_page: string | null;
  note: string | null;
  active: boolean;
  added_at: string;
  removed_at: string | null;
  updated_by: string | null;
  updated_at: string;
};

type AiVisitsPeriodShape = {
  total: number;
  by_name: { name: string; sessions: number }[];
  top_pages: { path: string; lang: "ko" | "en"; sessions: number }[];
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
  /** 기간 전체 방문자. 옛 응답에는 없다 */
  period_users?: PeriodUsersCompare;
  /** 고른 기간 + 앞 기간 안의 조치 기록. 옛 응답에는 없다 */
  actions?: StatsAction[];
  /** Let's Talk 문의하기 누름 · 문의 실제 보냄. 옛 응답에는 없다 */
  lets_talk_click?: MetricCompare;
  generate_lead?: MetricCompare;
  /** 구글 검색 자료가 들어온 마지막 날. 옛 응답에는 없고, 자료가 없으면 null */
  gsc_last_date?: string | null;
  /**
   * kind=bots 일 때만. 홈페이지 website_bot_hits_raw 를 기간으로 센 값.
   * 타입은 ai-data 의 BotsStatsPayload 와 같다. 순환 import 를 피하려고 여기서는 구조만 둔다.
   */
  bots?: {
    since: string;
    ai: {
      total: { current: number; previous: number | null };
      byCompany: Record<string, { current: number; previous: number | null }>;
      byPurpose: Record<string, { current: number; previous: number | null }>;
      askedTotal: { current: number; previous: number | null };
      topPaths: {
        path: string;
        lang: "ko" | "en";
        count: { current: number; previous: number | null };
      }[];
      failed: { current: number; previous: number | null };
      /** llms.txt 읽은 횟수. 홈페이지가 따로 주기 전 응답에는 없다 */
      llmsTxt?: { current: number; previous: number | null };
      /** AI 로봇 이름별 횟수. 홈페이지가 주기 전 응답에는 없다 */
      byName?: Record<string, { current: number; previous: number | null }>;
    };
    searchEngines: {
      total: { current: number; previous: number | null };
      byName: Record<string, { current: number; previous: number | null }>;
    };
    verified: boolean;
  };
  /**
   * kind=ai_visits 일 때만. GA 출처 × 도착 페이지(source_landing)를 AI 출처로 묶은 세션.
   * 타입은 ai-data 의 AiVisitsPeriod 와 같다.
   */
  ai_visits?: {
    current: AiVisitsPeriodShape;
    previous: AiVisitsPeriodShape;
  };
  /** kind=target_keywords 일 때만. 목표 키워드 × 구글 검색어(정규화 완전 일치) */
  target_keywords?: TargetKeywordsPayload;
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

export const STATS_ACTION_CATEGORIES = ["seo", "aeo", "content", "design", "other"] as const;

export type StatsActionCategory = (typeof STATS_ACTION_CATEGORIES)[number];

/** 홈페이지 website_stats_actions 한 줄 — 그날 한 일 */
export type StatsAction = {
  id: string;
  action_date: string;
  title: string;
  category: StatsActionCategory | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** 기간 전체를 한 번 센 방문자. kind 마다 같은 값이 붙는다 */
export type PeriodUsersCompare = {
  current: number | null;
  previous: number | null;
  current_new: number | null;
  previous_new: number | null;
  /** 오픈 전 옛 속성과 오픈 이후 새 속성을 더한 값인지 */
  current_summed: boolean;
  previous_summed: boolean;
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

export type StatsScreenId = "summary" | "content" | "search" | "ai" | "behavior" | "actions";

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
    lede: "AI 가 우리 글을 읽고, 쓰고, 사람을 보내 주나요?"
  },
  {
    id: "behavior",
    href: "/website/stats/behavior",
    label: "방문 패턴",
    lede: "들어온 사람이 무엇을 하는지 봅니다. 홈페이지의 목표는 오래 머물다 문의로 이어지는 것입니다."
  },
  {
    id: "actions",
    href: "/website/stats/actions",
    label: "조치 기록",
    lede: "홈페이지에 한 일을 날짜와 함께 적어 둡니다. 적은 날은 모든 그래프에 세로선으로 표시해 전후를 비교합니다."
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
