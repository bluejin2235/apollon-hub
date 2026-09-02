/**
 * 행동 화면 데이터 — 들어온 사람이 무엇을 하는지.
 *
 * summary-data.ts 와 같은 규칙이다. 값이 없으면 null·빈 배열로 두고 0 으로
 * 바꾸지 않는다. GA4 는 사이트 공개 전이라 아직 한 줄도 없다.
 *
 * ── 지금 걷는 리포트 (apollon-website/src/lib/google/ga4.ts 의 REPORTS)
 *   daily    [date]                totalUsers · newUsers · sessions · engagedSessions
 *                                  · engagementRate · averageSessionDuration
 *                                  · screenPageViews · eventCount
 *   page     [date, pagePath]      screenPageViews · totalUsers · averageSessionDuration
 *   landing  [date, landingPage]   sessions · engagementRate
 *   event    [date, eventName]     eventCount · totalUsers
 *
 * ── 만들 수 있는 것
 *   깔때기 1·4·5 칸 · 평균 머문 시간 · 세션당 본 페이지 · 신규와 재방문
 *   · 문의·뉴스레터·인재풀
 *
 * ── 만들 수 없는 것과 이유 (화면 그 자리에도 적었다)
 *   · 깔때기 2·3 칸 — 「사람 단위로 어느 종류를 봤나」와 「한 세션에 몇 장 봤나」를
 *     셀 차원이 runReport 에 없다. page 의 totalUsers 를 여러 경로에 걸쳐 더하면
 *     같은 사람이 여러 번 세어져 들어옴보다 커질 수 있다. 그래서 비운다.
 *   · 머문 시간 분포 · 본 페이지 수 분포 — 세션 하나하나가 아니라 이미 평균된
 *     값만 온다. 구간별로 가를 원자료가 없다.
 *   · 요일 × 시간 — hour 차원을 걷지 않는다. hourly 리포트를 더하면 된다.
 *   · 나가는 페이지 — GA4 Data API 에 exits 지표가 아예 없다. Explorations 와
 *     BigQuery 에만 있어 리포트를 더해도 안 된다. 대신 landing 의 참여율로
 *     「들어와서 아무것도 안 하고 나간 세션」을 낸다.
 */

import {
  STATS_BAD,
  STATS_COLORS,
  STATS_MUTED,
  type StatsRow
} from "@/components/website/stats/stats-chart";
import {
  byDate,
  clip,
  intText,
  makeDelta,
  numText,
  pickRows,
  shortDate,
  sumField,
  type DeltaTone
} from "@/components/website/stats/stats-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

/**
 * 행동 화면이 쓰는 kind.
 *
 * hourly 는 ga4.ts 가 아직 걷지 않는다. 미리 받아 두면 리포트를 더하는 날
 * 화면을 고치지 않아도 히트맵이 켜진다. 그때까지는 0행이라 안내가 나온다.
 */
export const BEHAVIOR_KINDS = ["daily", "page", "landing", "event", "hourly"];

type Rows = StatsPoint[];

/** 행동 화면은 GA4 값만 본다 */
function pick(
  bundle: StatsBundle | null,
  kind: string,
  when: "current" | "previous" = "current"
): Rows {
  return pickRows(bundle, kind, "ga4", when);
}

/** 물음표·우물정과 끝 빗금을 떼어 같은 페이지가 갈라지지 않게 한다 */
function normalizePath(raw: string | null): string | null {
  if (!raw) return null;
  let path = raw.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

/** 국문에는 접두어가 없고 영문만 /en 으로 시작한다 */
function routeOf(path: string): string {
  if (path === "/en") return "/";
  return path.startsWith("/en/") ? path.slice(3) : path;
}

/* ─────────────────────── 1. 문의까지 가는 길 ─────────────────────── */

/** Let's Talk 페이지. 국문·영문 두 경로가 같은 화면이다 */
const CONTACT_ROUTE = "/contact";

/** 문의 폼이 실제로 보내졌을 때 apollon-website 가 쏘는 이름 */
const LEAD_EVENT = "generate_lead";

export type FunnelStep = {
  id: string;
  label: string;
  /** 못 만드는 칸은 null */
  value: number | null;
  /** null 인 칸에 그 자리에 적을 이유 */
  reason: string | null;
  /** 첫 칸 대비 몇 %. 첫 칸은 null */
  share: string | null;
  /** 막대 높이 0~100. 값이 없으면 0 */
  height: number;
};

/** 한 경로(국문·영문 합쳐)의 사람 수 */
function usersOnRoute(bundle: StatsBundle | null, route: string): number | null {
  let total = 0;
  let seen = false;
  for (const row of pick(bundle, "page")) {
    const path = normalizePath(row.key);
    if (path === null || routeOf(path) !== route) continue;
    if (typeof row.users !== "number") continue;
    total += row.users;
    seen = true;
  }
  return seen ? total : null;
}

function usersOnEvent(bundle: StatsBundle | null, name: string): number | null {
  const rows = pick(bundle, "event").filter((row) => row.key === name);
  return sumField(rows, "users");
}

/**
 * 다섯 칸 중 셋만 채운다.
 *
 * 가운데 두 칸(워크·인사이트 봄 · 두 개 이상 봄)은 지금 리포트로 셀 수 없다.
 * 억지로 채우면 깔때기가 거짓이 되므로 「—」로 두고 이유를 적는다.
 */
export function buildFunnel(bundle: StatsBundle | null): FunnelStep[] {
  const entered = sumField(pick(bundle, "daily"), "users");
  const talkSeen = usersOnRoute(bundle, CONTACT_ROUTE);
  const sent = usersOnEvent(bundle, LEAD_EVENT);

  const base = entered && entered > 0 ? entered : null;
  const shareOf = (value: number | null): string | null => {
    if (value == null || base == null) return null;
    const pct = Math.round((value / base) * 100);
    // 2명이 「들어옴의 0%」로 보이면 0 인지 반올림인지 알 수 없다
    if (pct === 0 && value > 0) return "들어옴의 1% 미만";
    return `들어옴의 ${pct}%`;
  };
  const heightOf = (value: number | null): number => {
    if (value == null || base == null || base === 0) return 0;
    // 아주 작은 값도 막대가 보이게 밑을 4% 로 둔다
    return Math.max(4, Math.min(100, (value / base) * 100));
  };

  return [
    {
      id: "entered",
      label: "들어옴",
      value: entered,
      reason: null,
      share: null,
      height: entered == null ? 0 : 100
    },
    {
      id: "sawWork",
      label: "워크·인사이트 봄",
      value: null,
      reason:
        "사람 단위로 「어느 종류를 봤나」를 셀 차원이 GA4 runReport 에 없습니다. 경로별 사람 수를 더하면 같은 사람이 여러 번 세어져 들어옴보다 커집니다.",
      share: null,
      height: 0
    },
    {
      id: "sawTwo",
      label: "두 개 이상 봄",
      value: null,
      reason:
        "한 세션에 몇 장을 봤는지 가르는 차원이 GA4 runReport 에 없습니다. 세션별 원자료가 필요해 BigQuery 내보내기로만 됩니다.",
      share: null,
      height: 0
    },
    {
      id: "talkSeen",
      label: "Let's Talk 열람",
      value: talkSeen,
      reason: null,
      share: shareOf(talkSeen),
      height: heightOf(talkSeen)
    },
    {
      id: "sent",
      label: "문의 보냄",
      value: sent,
      reason: null,
      share: shareOf(sent),
      height: heightOf(sent)
    }
  ];
}

/* ─────────────────────── 2. 머문 시간 · 본 페이지 수 ─────────────────────── */

/**
 * 목업은 구간별 분포였다. GA4 는 세션 하나하나를 주지 않고 하루 평균만 주므로
 * 분포를 그릴 수 없다. 대신 평균이 어떻게 움직이는지 보인다.
 */
export function buildDwellTrend(bundle: StatsBundle | null): StatsRow[] {
  return [...pick(bundle, "daily")]
    .filter((row) => typeof row.avg_seconds === "number")
    .sort(byDate)
    .map((row) => ({ date: shortDate(row.date), seconds: row.avg_seconds }));
}

/** 세션 하나가 평균 몇 장을 봤나 — 조회 ÷ 세션 */
export function buildDepthTrend(bundle: StatsBundle | null): StatsRow[] {
  return [...pick(bundle, "daily")]
    .filter(
      (row) =>
        typeof row.views === "number" && typeof row.sessions === "number" && row.sessions > 0
    )
    .sort(byDate)
    .map((row) => ({
      date: shortDate(row.date),
      pages: (row.views as number) / (row.sessions as number)
    }));
}

/** 카드 위에 한 줄로 보일 요약값 */
export function buildDwellSummary(bundle: StatsBundle | null): {
  avgSeconds: string | null;
  avgPages: string | null;
} {
  const rows = pick(bundle, "daily");
  const sessions = sumField(rows, "sessions");
  const views = sumField(rows, "views");

  // 평균 체류는 세션 수로 무게를 실어야 한다. 하루 평균을 그냥 또 평균하면 틀린다
  let acc = 0;
  let mass = 0;
  for (const row of rows) {
    if (typeof row.avg_seconds !== "number" || typeof row.sessions !== "number") continue;
    if (row.sessions <= 0) continue;
    acc += row.avg_seconds * row.sessions;
    mass += row.sessions;
  }

  return {
    avgSeconds: mass > 0 ? `${Math.round(acc / mass)}초` : null,
    avgPages:
      views != null && sessions != null && sessions > 0
        ? `${numText(views / sessions, 1)}장`
        : null
  };
}

/* ─────────────────────── 3. 언제 오나 — 요일 × 시간 ─────────────────────── */

/** 월요일부터. 목업과 같은 순서 */
export const HEAT_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

export type HeatModel = {
  /** [요일 7][시간 24]. 값이 없는 칸은 null */
  grid: (number | null)[][];
  max: number;
};

/** 2026-09-02 → 2 (0 이 월요일) */
function weekdayIndex(iso: string): number | null {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utc.getTime())) return null;
  return (utc.getUTCDay() + 6) % 7;
}

/**
 * hourly 리포트가 걷히면 켜진다. key 가 시간(00~23)이고 날짜에서 요일을 낸다.
 * 아직 걷지 않으므로 null 을 돌려주고 화면이 안내를 보인다.
 */
export function buildHourHeat(bundle: StatsBundle | null): HeatModel | null {
  const rows = pick(bundle, "hourly");
  if (rows.length === 0) return null;

  const grid: (number | null)[][] = HEAT_DAYS.map(() => Array.from({ length: 24 }, () => null));
  let max = 0;

  for (const row of rows) {
    const day = weekdayIndex(row.date);
    const hour = Number(row.key);
    if (day == null || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const value = typeof row.users === "number" ? row.users : row.sessions;
    if (typeof value !== "number") continue;
    grid[day][hour] = (grid[day][hour] ?? 0) + value;
    if (grid[day][hour]! > max) max = grid[day][hour]!;
  }

  return max > 0 ? { grid, max } : null;
}

/* ─────────────────────── 4. 이탈 · 신규와 재방문 ─────────────────────── */

/**
 * 목업은 「많이 나가는 페이지」였다. GA4 Data API 에 exits 가 없어 그대로는
 * 못 만든다. 대신 진입 페이지별로 「들어와서 아무것도 안 하고 나간 세션」을 낸다.
 * 참여하지 않은 세션 = 세션 × (1 − 참여율).
 */
export function buildBouncedEntries(
  bundle: StatsBundle | null,
  limit = 6
): { rows: StatsRow[]; colors: string[] } {
  const map = new Map<string, { sessions: number; engaged: number }>();

  for (const row of pick(bundle, "landing")) {
    const path = normalizePath(row.key);
    if (path === null || typeof row.sessions !== "number" || row.sessions <= 0) continue;
    let item = map.get(path);
    if (!item) {
      item = { sessions: 0, engaged: 0 };
      map.set(path, item);
    }
    item.sessions += row.sessions;
    if (typeof row.engagement_rate === "number") {
      item.engaged += row.engagement_rate * row.sessions;
    }
  }

  const ranked = [...map.entries()]
    .map(([path, item]) => {
      const rate = item.sessions > 0 ? item.engaged / item.sessions : 0;
      return { path, bounced: item.sessions * (1 - rate), sessions: item.sessions };
    })
    .filter((item) => item.bounced > 0)
    .sort((a, b) => b.bounced - a.bounced)
    .slice(0, limit);

  return {
    rows: ranked.map((item) => ({
      name: clip(item.path, 26),
      value: Math.round(item.bounced)
    })),
    // 가장 많이 빠지는 곳부터 붉게
    colors: ranked.map((_, index) =>
      index === 0 ? STATS_BAD : index < 2 ? "#eecfae" : STATS_MUTED
    )
  };
}

/** 신규는 newUsers, 재방문은 나머지. 음수가 되지 않게 자른다 */
export function buildNewVsReturning(bundle: StatsBundle | null): StatsRow[] {
  return [...pick(bundle, "daily")]
    .filter((row) => typeof row.users === "number")
    .sort(byDate)
    .map((row) => {
      const users = row.users as number;
      const fresh = typeof row.new_users === "number" ? Math.min(row.new_users, users) : null;
      return {
        date: shortDate(row.date),
        fresh,
        again: fresh == null ? null : Math.max(0, users - fresh)
      };
    });
}

/* ─────────────────────── 5. 문의 · 뉴스레터 · 인재풀 ─────────────────────── */

/** apollon-website 가 폼 제출 성공에서 쏘는 이름 그대로다 */
export const LEAD_EVENTS: { id: string; label: string; color: string }[] = [
  { id: LEAD_EVENT, label: "프로젝트 문의", color: STATS_COLORS[0] },
  { id: "newsletter_signup", label: "뉴스레터 구독", color: STATS_COLORS[2] },
  { id: "talent_signup", label: "인재풀 등록", color: STATS_COLORS[3] }
];

export type LeadKpi = {
  id: string;
  label: string;
  value: string;
  sub: string;
  delta: string | null;
  tone: DeltaTone;
};

/** 제출 수는 사람이 아니라 건수다. 한 사람이 두 번 보내면 두 건 */
export function buildLeadKpis(bundle: StatsBundle | null): LeadKpi[] {
  return LEAD_EVENTS.map((event) => {
    const cur = sumField(
      pick(bundle, "event").filter((row) => row.key === event.id),
      "events"
    );
    const prev = sumField(
      pick(bundle, "event", "previous").filter((row) => row.key === event.id),
      "events"
    );
    return {
      id: event.id,
      label: event.label,
      value: intText(cur) ?? "—",
      sub: "이번 기간 제출 수",
      ...makeDelta(cur, prev, "ratio", true)
    };
  });
}

export function buildLeadTrend(bundle: StatsBundle | null): StatsRow[] {
  const byDay = new Map<string, StatsRow>();

  for (const row of pick(bundle, "event")) {
    const event = LEAD_EVENTS.find((item) => item.id === row.key);
    if (!event || typeof row.events !== "number") continue;
    let day = byDay.get(row.date);
    if (!day) {
      day = { date: shortDate(row.date) };
      byDay.set(row.date, day);
    }
    day[event.id] = ((day[event.id] as number | undefined) ?? 0) + row.events;
  }

  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, row]) => row);
}
