/**
 * 요약 화면 데이터 — website_stats 행을 화면 모델로 옮긴다.
 *
 * 규칙 하나: 값이 없으면 null·빈 배열로 둔다. 0 으로 바꾸지 않는다.
 * GA4 는 사이트 공개 전이라 아직 한 줄도 없어서 대부분 「없음」으로 나온다.
 * null 을 0 으로 바꾸면 진짜 0 인지 아직 안 걷힌 것인지 구분할 수 없다.
 */

import {
  STATS_COLORS,
  STATS_TEXT,
  type StatsRow,
  type StatsScatterGroup,
  type StatsSlice
} from "@/components/website/stats/stats-chart";
import {
  byDate,
  intText,
  makeDelta,
  pctText,
  pickRows,
  ranked,
  shortDate,
  sparkOf,
  sumByKey,
  sumField,
  weightedField,
  type DeltaTone,
  type StatsMetric
} from "@/components/website/stats/stats-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

/** 요약 화면이 쓰는 kind 전부. 한 번에 받아 온다 */
export const SUMMARY_KINDS = [
  "daily",
  "channel",
  "country",
  "device",
  "page",
  "query",
  "event"
];

/** 아직 안 걷힌 자리에 붙이는 한 줄 */
export const SUMMARY_EMPTY_HINT = "사이트 공개 후 수집이 시작됩니다.";

/** 문의 수를 세는 GA4 이벤트 — apollon-website 의 submitInquiry 가 보낸다 */
const LEAD_EVENT = "generate_lead";

/**
 * GA4 기본 채널 그룹에는 AI 항목이 없다. AI 답변으로 들어온 방문은 대개
 * Referral 에 섞여 따로 셀 수 없다. 채널 이름에 AI 가 생기면 그때 잡히도록
 * 열어만 두고, 지금은 걸리는 것이 없어 「—」로 나온다.
 */
const AI_CHANNEL = /(^|[^a-z])ai([^a-z]|$)/i;

type Rows = StatsPoint[];
type Metric = StatsMetric;

/** 요약 화면은 지금 사이트 값만 본다 */
function pick(
  bundle: StatsBundle | null,
  kind: string,
  source: string,
  when: "current" | "previous"
): Rows {
  return pickRows(bundle, kind, source, when);
}

const total = sumField;
const weighted = weightedField;

export type SummaryKpi = {
  id: string;
  /** 없으면 null — 화면은 「—」로 그린다 */
  value: string | null;
  delta: string | null;
  tone: DeltaTone;
  sparkColor: string;
  /** 두 점 미만이면 빈 배열 — 선이 그려지지 않는다 */
  spark: StatsRow[];
};

export function buildKpis(bundle: StatsBundle | null): SummaryKpi[] {
  const ga4 = pick(bundle, "daily", "ga4", "current");
  const ga4Prev = pick(bundle, "daily", "ga4", "previous");
  const gsc = pickRows(bundle, "daily", ["gsc", "gsc_http"], "current");
  const gscPrev = pickRows(bundle, "daily", ["gsc", "gsc_http"], "previous");

  const aiNow = pick(bundle, "channel", "ga4", "current").filter((row) =>
    AI_CHANNEL.test(row.key ?? "")
  );
  const aiPrev = pick(bundle, "channel", "ga4", "previous").filter((row) =>
    AI_CHANNEL.test(row.key ?? "")
  );

  const leadNow = pick(bundle, "event", "ga4", "current").filter((row) => row.key === LEAD_EVENT);
  const leadPrev = pick(bundle, "event", "ga4", "previous").filter((row) => row.key === LEAD_EVENT);

  const visits = total(ga4, "users");
  const visitsPrev = total(ga4Prev, "users");
  const impressions = total(gsc, "impressions");
  const impressionsPrev = total(gscPrev, "impressions");
  const ai = total(aiNow, "sessions");
  const aiBefore = total(aiPrev, "sessions");
  const lead = total(leadNow, "events");
  const leadBefore = total(leadPrev, "events");

  // 참여율의 반대가 이탈률이다
  const engaged = weighted(ga4, "engagement_rate", "sessions");
  const engagedPrev = weighted(ga4Prev, "engagement_rate", "sessions");
  const bounce = engaged == null ? null : 1 - engaged;
  const bouncePrev = engagedPrev == null ? null : 1 - engagedPrev;

  return [
    {
      id: "visit",
      value: intText(visits),
      ...makeDelta(visits, visitsPrev, "ratio", true),
      sparkColor: STATS_COLORS[0],
      spark: sparkOf(ga4, "users")
    },
    {
      id: "imp",
      value: intText(impressions),
      ...makeDelta(impressions, impressionsPrev, "ratio", true),
      sparkColor: STATS_COLORS[0],
      spark: sparkOf(gsc, "impressions")
    },
    {
      id: "ai",
      value: intText(ai),
      ...makeDelta(ai, aiBefore, "ratio", true),
      sparkColor: STATS_COLORS[2],
      spark: sparkOf(aiNow, "sessions")
    },
    {
      id: "bounce",
      value: pctText(bounce),
      ...makeDelta(bounce, bouncePrev, "point", false),
      sparkColor: "#b93b3b",
      spark: sparkOf(ga4, "engagement_rate")
    },
    {
      id: "lead",
      value: intText(lead),
      ...makeDelta(lead, leadBefore, "ratio", true),
      sparkColor: STATS_TEXT,
      spark: sparkOf(leadNow, "events")
    }
  ];
}

/** 방문 추이 — 실선 이번 기간, 점선 지난 기간. 같은 자리끼리 맞춘다 */
export function buildTrend(bundle: StatsBundle | null): StatsRow[] {
  const current = [...pick(bundle, "daily", "ga4", "current")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate);
  if (current.length === 0) return [];

  const previous = [...pick(bundle, "daily", "ga4", "previous")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate);

  return current.map((row, index) => ({
    date: shortDate(row.date),
    current: row.users as number,
    previous: previous[index]?.users ?? null
  }));
}

/** 경로별 비중 */
export function buildSourcePie(bundle: StatsBundle | null): StatsSlice[] {
  return ranked(sumByKey(pick(bundle, "channel", "ga4", "current"), "sessions"));
}

export type SeriesSpec = { key: string; name: string; color: string };

/** 경로별 일별 추이 — 날짜를 가로로, 경로를 계열로 편다 */
export function buildSourceDaily(bundle: StatsBundle | null): {
  rows: StatsRow[];
  series: SeriesSpec[];
} {
  const source = pick(bundle, "channel", "ga4", "current");
  const names = ranked(sumByKey(source, "sessions"))
    .slice(0, STATS_COLORS.length)
    .map((item) => item.name);
  if (names.length === 0) return { rows: [], series: [] };

  const wanted = new Set(names);
  const byDay = new Map<string, StatsRow>();
  for (const row of [...source].sort(byDate)) {
    const name = row.key?.trim() || "(없음)";
    if (!wanted.has(name) || typeof row.sessions !== "number") continue;
    let bucket = byDay.get(row.date);
    if (!bucket) {
      bucket = { date: shortDate(row.date) };
      byDay.set(row.date, bucket);
    }
    bucket[name] = ((bucket[name] as number | undefined) ?? 0) + row.sessions;
  }

  return {
    rows: [...byDay.values()],
    series: names.map((name, index) => ({
      key: name,
      name,
      color: STATS_COLORS[index % STATS_COLORS.length]
    }))
  };
}

/**
 * 경로별 질.
 * 가로 머문 시간(초) · 세로 참여율(%) · 원 크기 방문 수.
 * 목업은 세로를 「본 페이지 수」로 뒀지만 GA4 channel 리포트에 페이지 수가
 * 없다. 있는 값으로 바꾸고 이름도 함께 바꿨다.
 */
export function buildSourceQuality(bundle: StatsBundle | null): StatsScatterGroup[] {
  const source = pick(bundle, "channel", "ga4", "current");
  const names = ranked(sumByKey(source, "sessions")).map((item) => item.name);

  const groups: StatsScatterGroup[] = [];
  names.forEach((name, index) => {
    const rows = source.filter((row) => (row.key?.trim() || "(없음)") === name);
    const seconds = weighted(rows, "avg_seconds", "sessions");
    const rate = weighted(rows, "engagement_rate", "sessions");
    const sessions = total(rows, "sessions");
    if (seconds == null || rate == null || sessions == null) return;
    groups.push({
      name,
      color: STATS_COLORS[index % STATS_COLORS.length],
      points: [{ x: Math.round(seconds), y: Math.round(rate * 100), z: sessions }]
    });
  });

  return groups;
}

/** 국가 — 많은 순 다섯 개와 나머지 */
export function buildCountry(bundle: StatsBundle | null): StatsRow[] {
  const all = ranked(sumByKey(pick(bundle, "country", "ga4", "current"), "users"));
  if (all.length === 0) return [];

  const head = all.slice(0, 5);
  const rest = all.slice(5);
  const rows: StatsRow[] = head.map((item) => ({ name: item.name, value: item.value }));
  if (rest.length > 0) {
    rows.push({ name: "기타", value: rest.reduce((acc, item) => acc + item.value, 0) });
  }
  return rows;
}

/** GA4 deviceCategory 는 영문 고정값이다 */
const DEVICE_LABEL: Record<string, string> = {
  desktop: "데스크톱",
  mobile: "모바일",
  tablet: "태블릿",
  "smart tv": "TV"
};

export function buildDevice(bundle: StatsBundle | null): StatsSlice[] {
  return ranked(sumByKey(pick(bundle, "device", "ga4", "current"), "users")).map(
    (item, index) => ({
      name: DEVICE_LABEL[item.name.toLowerCase()] ?? item.name,
      value: item.value,
      color: STATS_COLORS[index % STATS_COLORS.length]
    })
  );
}

/**
 * 언어별 페이지.
 * apollon-website 는 localePrefix 가 as-needed 라 국문에는 접두어가 없고
 * 영문만 /en 으로 시작한다. 따로 언어 표가 없어 경로로 가른다.
 */
export function buildLanguage(bundle: StatsBundle | null): StatsSlice[] {
  const rows = pick(bundle, "page", "ga4", "current");
  let ko = 0;
  let en = 0;
  let seen = false;

  for (const row of rows) {
    if (typeof row.views !== "number") continue;
    seen = true;
    const path = row.key ?? "";
    if (path === "/en" || path.startsWith("/en/")) en += row.views;
    else ko += row.views;
  }
  if (!seen) return [];

  const sum = ko + en;
  const label = (name: string, value: number) =>
    sum > 0 ? `${name} ${Math.round((value / sum) * 100)}%` : name;

  return [
    { name: label("국문", ko), value: ko, color: STATS_COLORS[0] },
    { name: label("영문", en), value: en, color: STATS_COLORS[2] }
  ];
}

/**
 * 검색어 — 노출 많은 순 다섯 개.
 *
 * 검색어에는 날짜가 없다. 옛 CSV 가 기간 합계로만 줘서 기간으로 자를 수 없다.
 * 그래서 current 가 아니라 overall 을 읽는다. 담은 기간은 검색 화면에 적혀 있다.
 */
export function buildKeywords(bundle: StatsBundle | null): StatsRow[] {
  const rows = pickRows(bundle, "query", ["gsc", "gsc_http"], "overall");
  const map = new Map<string, { impressions: number; clicks: number }>();

  for (const row of rows) {
    const key = row.key?.trim();
    if (!key) continue;
    const bucket = map.get(key) ?? { impressions: 0, clicks: 0 };
    if (typeof row.impressions === "number") bucket.impressions += row.impressions;
    if (typeof row.clicks === "number") bucket.clicks += row.clicks;
    map.set(key, bucket);
  }

  return [...map.entries()]
    .sort((a, b) => b[1].impressions - a[1].impressions)
    .slice(0, 5)
    .map(([name, value]) => ({ name, impressions: value.impressions, clicks: value.clicks }));
}

/* ─────────────────────── 루나 총평 · 할 일에 넘길 숫자 ─────────────────────── */

/** 0~1 비율 → 사람이 읽는 백분율 숫자 (56 · 4.4) */
function ratePct(rate: number | null, digits = 1): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const factor = 10 ** digits;
  return Math.round(rate * 100 * factor) / factor;
}

/** 초 → 「1분 12초」. 루나에게 넘길 때만 쓴다 */
function durationKo(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
}

export type SummaryBriefFacts = {
  from: string;
  to: string;
  visits: { current: number | null; previous: number | null };
  impressions: { current: number | null; previous: number | null };
  clicks: { current: number | null; previous: number | null };
  /** 검색 클릭률 (%). 노출이 있을 때만 */
  clickRate: { current: number | null; previous: number | null };
  aiSessions: { current: number | null; previous: number | null };
  /** 이탈률 (%). 소수 0.56 이 아니라 56 */
  bounceRate: { current: number | null; previous: number | null };
  /** 참여율 (%) */
  engagementRate: { current: number | null; previous: number | null };
  /** 평균 참여시간 — 「1분 12초」 문자열 */
  avgEngagementTime: { current: string | null; previous: string | null };
  leads: { current: number | null; previous: number | null };
  channels: { name: string; sessions: number }[];
  queries: { name: string; impressions: number; clicks: number; clickRate: number | null }[];
  pages: { path: string; views: number }[];
};

/**
 * 루나에게 넘길 숫자·이름만 뽑는다. 본문·긴 설명은 넣지 않는다.
 * 비율은 백분율, 시간은 「분·초」 문자열. 기간에 값이 없으면 null.
 */
export function buildSummaryBriefFacts(
  bundle: StatsBundle | null,
  from: string,
  to: string
): SummaryBriefFacts | null {
  if (!bundle) return null;

  const ga4 = pick(bundle, "daily", "ga4", "current");
  const ga4Prev = pick(bundle, "daily", "ga4", "previous");
  const gsc = pickRows(bundle, "daily", ["gsc", "gsc_http"], "current");
  const gscPrev = pickRows(bundle, "daily", ["gsc", "gsc_http"], "previous");

  const visits = total(ga4, "users");
  const impressions = total(gsc, "impressions");
  if (visits == null && impressions == null) return null;

  const aiNow = pick(bundle, "channel", "ga4", "current").filter((row) =>
    AI_CHANNEL.test(row.key ?? "")
  );
  const aiPrev = pick(bundle, "channel", "ga4", "previous").filter((row) =>
    AI_CHANNEL.test(row.key ?? "")
  );
  const leadNow = pick(bundle, "event", "ga4", "current").filter((row) => row.key === LEAD_EVENT);
  const leadPrev = pick(bundle, "event", "ga4", "previous").filter((row) => row.key === LEAD_EVENT);

  const engaged = weighted(ga4, "engagement_rate", "sessions");
  const engagedPrev = weighted(ga4Prev, "engagement_rate", "sessions");
  const clicksNow = total(gsc, "clicks");
  const clicksPrev = total(gscPrev, "clicks");
  const impressionsPrev = total(gscPrev, "impressions");

  const channels = ranked(sumByKey(pick(bundle, "channel", "ga4", "current"), "sessions"))
    .slice(0, 5)
    .map((item) => ({ name: item.name, sessions: item.value }));

  const queries = buildKeywords(bundle)
    .slice(0, 5)
    .map((row) => {
      const imp = Number(row.impressions) || 0;
      const clk = Number(row.clicks) || 0;
      return {
        name: String(row.name),
        impressions: imp,
        clicks: clk,
        clickRate: imp > 0 ? ratePct(clk / imp) : null
      };
    });

  const pages = ranked(sumByKey(pick(bundle, "page", "ga4", "current"), "views"))
    .slice(0, 5)
    .map((item) => ({ path: item.name, views: item.value }));

  return {
    from,
    to,
    visits: { current: visits, previous: total(ga4Prev, "users") },
    impressions: { current: impressions, previous: impressionsPrev },
    clicks: { current: clicksNow, previous: clicksPrev },
    clickRate: {
      current:
        impressions != null && impressions > 0 && clicksNow != null
          ? ratePct(clicksNow / impressions)
          : null,
      previous:
        impressionsPrev != null && impressionsPrev > 0 && clicksPrev != null
          ? ratePct(clicksPrev / impressionsPrev)
          : null
    },
    aiSessions: { current: total(aiNow, "sessions"), previous: total(aiPrev, "sessions") },
    bounceRate: {
      current: engaged == null ? null : ratePct(1 - engaged),
      previous: engagedPrev == null ? null : ratePct(1 - engagedPrev)
    },
    engagementRate: {
      current: ratePct(engaged),
      previous: ratePct(engagedPrev)
    },
    avgEngagementTime: {
      current: durationKo(weighted(ga4, "avg_seconds", "sessions")),
      previous: durationKo(weighted(ga4Prev, "avg_seconds", "sessions"))
    },
    leads: { current: total(leadNow, "events"), previous: total(leadPrev, "events") },
    channels,
    queries,
    pages
  };
}

/** 같은 기간·같은 숫자면 캐시 키를 같게 한다 */
export function summaryBriefFingerprint(facts: SummaryBriefFacts): string {
  return JSON.stringify(facts);
}
