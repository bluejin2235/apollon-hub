/**
 * 방문 패턴 v3 — 「언제 오고, 어떻게 돌아다니나요?」
 *
 * 카드 · 추이는 지금 행동 화면과 같은 식(buildDwellSummary · buildDwellTrend · buildDepthTrend),
 * 처음/다시는 기간 전체 방문자(period_users)의 새 방문자, 기기 · 나라는 GA device · country,
 * 성과는 응답의 lets_talk_click · generate_lead 와 event(newsletter_signup · talent_signup).
 * 요일과 시간대(hourly) · 나간 페이지(BigQuery)는 아직 모으지 않아 화면이 「준비 중」으로 둔다.
 */

import { pageTitleFromPath, type TitleMap } from "@/components/website/stats/content-data";
import {
  intText,
  makeCountDelta,
  makeDelta,
  numText,
  readMetricCompare,
  sumField,
  type DeltaView
} from "@/components/website/stats/stats-data";
import { countryLabel } from "@/components/website/stats/stats-labels";
import type { HBarRow } from "@/components/website/stats-v3/v3-parts";
import {
  articleEntriesOf,
  dailySumOf,
  dayRows,
  durationParts,
  durationText,
  dwellSecondsOf,
  ga4,
  intKo,
  newReturningOf,
  normalizePath,
  pagesPerSessionOf,
  pathLang,
  prevGuard,
  ratioDelta,
  visitsOf,
  type When
} from "@/components/website/stats-v3/v3-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

const withUnit = (unit: string) => (value: string | null) => (value == null ? null : `${value}${unit}`);

/* ─────────────────────── 카드 다섯 칸 ─────────────────────── */

export type VisitCard = { id: string; label: string; value: string | null; unit: string; delta: DeltaView };

export function visitCards(bundle: StatsBundle | null): VisitCard[] {
  const prev = prevGuard(bundle);
  const visits = visitsOf(bundle);
  const visitors = { current: visits.current, previous: prev(visits.previous) };
  const sessions = { current: dailySumOf(bundle, "sessions", "current"), previous: prev(dailySumOf(bundle, "sessions", "previous")) };
  const depth = { current: pagesPerSessionOf(bundle, "current"), previous: prev(pagesPerSessionOf(bundle, "previous")) };
  const dwell = { current: dwellSecondsOf(bundle, "current"), previous: prev(dwellSecondsOf(bundle, "previous")) };
  const entries = { current: articleEntriesOf(bundle, "current"), previous: prev(articleEntriesOf(bundle, "previous")) };
  const dwellParts = durationParts(dwell.current);
  return [
    { id: "visitors", label: "방문자", value: intKo(visitors.current), unit: "명", delta: ratioDelta(visitors, (v) => withUnit("명")(intKo(v))) },
    { id: "sessions", label: "방문 횟수", value: intKo(sessions.current), unit: "회", delta: ratioDelta(sessions, (v) => withUnit("회")(intKo(v))) },
    {
      id: "depth",
      label: "한 번에 본 페이지 수",
      value: numText(depth.current, 1),
      unit: "개",
      delta: ratioDelta(depth, (v) => withUnit("개")(numText(v, 1)))
    },
    {
      id: "dwell",
      label: "평균 머문 시간",
      value: dwellParts?.value ?? null,
      unit: dwellParts?.unit ?? "초",
      delta: ratioDelta(dwell, durationText)
    },
    {
      id: "entries",
      label: "글로 바로 들어온 방문",
      value: intKo(entries.current),
      unit: "회",
      delta: makeCountDelta(entries.current, entries.previous, true, withUnit("회")(intKo(entries.previous)))
    }
  ];
}

/* ─────────────────────── 들어온 페이지 상위 5 ─────────────────────── */

export type LandingRow = { path: string; title: string; lang: "ko" | "en"; sessions: number; delta: DeltaView };

function landingSessions(rows: StatsPoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const path = normalizePath(row.key);
    if (!path || typeof row.sessions !== "number") continue;
    map.set(path, (map.get(path) ?? 0) + row.sessions);
  }
  return map;
}

export function landingTop(bundle: StatsBundle | null, titles: TitleMap, limit = 5): LandingRow[] {
  const prevRows = prevGuard(bundle)(ga4(bundle, "landing", "previous"));
  const previous = prevRows && prevRows.length > 0 ? landingSessions(prevRows) : null;
  return [...landingSessions(ga4(bundle, "landing", "current")).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, sessions]) => {
      const before = previous ? (previous.get(path) ?? 0) : null;
      return {
        path,
        title: pageTitleFromPath(path, titles),
        lang: pathLang(path),
        sessions,
        delta: makeCountDelta(sessions, before, true, withUnit("회")(intText(before)))
      };
    });
}

/* ─────────────────────── 한 번에 본 페이지 수 · 평균 머문 시간 추이 ─────────────────────── */

export type MiniTrend = { dates: string[]; current: (number | null)[]; previous: (number | null)[] };

/** buildDepthTrend · buildDwellTrend 와 같은 식 — 앞 기간은 같은 순번 날짜 */
function trendOf(
  bundle: StatsBundle | null,
  keep: (row: StatsPoint) => boolean,
  value: (row: StatsPoint) => number
): MiniTrend {
  const rows = (when: When) => dayRows(ga4(bundle, "daily", when)).filter(keep);
  const current = rows("current");
  const previous = prevGuard(bundle)(rows("previous")) ?? [];
  return {
    dates: current.map((row) => row.date),
    current: current.map(value),
    previous: current.map((_, index) => (previous[index] ? value(previous[index]) : null))
  };
}

export function depthTrend(bundle: StatsBundle | null): MiniTrend {
  return trendOf(
    bundle,
    (row) => typeof row.views === "number" && typeof row.sessions === "number" && row.sessions > 0,
    (row) => (row.views as number) / (row.sessions as number)
  );
}

export function dwellTrend(bundle: StatsBundle | null): MiniTrend {
  return trendOf(bundle, (row) => typeof row.avg_seconds === "number", (row) => row.avg_seconds as number);
}

/* ─────────────────────── 어떤 사람이 오나요 ─────────────────────── */

const unitPeople = (value: number | null) => withUnit("명")(intText(value));

function bar(name: string, current: number | null, previous: number | null): HBarRow {
  return { name, value: current, change: makeCountDelta(current, previous, true, unitPeople(previous)) };
}

/** 처음 온 사람 = 새 방문자, 다시 온 사람 = 나머지 (기간 전체 방문자 기준) */
export function newReturningBars(bundle: StatsBundle | null): HBarRow[] | null {
  const split = newReturningOf(bundle);
  if (!split) return null;
  const prev = prevGuard(bundle);
  return [
    bar("처음 온 사람", split.fresh.current, prev(split.fresh.previous)),
    bar("다시 온 사람", split.again.current, prev(split.again.previous))
  ];
}

const DEVICE_NAMES: { key: string; name: string }[] = [
  { key: "mobile", name: "휴대폰" },
  { key: "desktop", name: "컴퓨터" },
  { key: "tablet", name: "태블릿" }
];

function usersBy(rows: StatsPoint[], label: (key: string) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.key?.trim();
    if (!key || typeof row.users !== "number") continue;
    const name = label(key);
    map.set(name, (map.get(name) ?? 0) + row.users);
  }
  return map;
}

/** 기기 세 칸 — 날짜별 방문자를 더한 값(GA device) */
export function deviceBars(bundle: StatsBundle | null): HBarRow[] {
  const label = (key: string) => DEVICE_NAMES.find((item) => item.key === key.toLowerCase())?.name ?? key;
  const cur = usersBy(ga4(bundle, "device", "current"), label);
  const prevRows = prevGuard(bundle)(ga4(bundle, "device", "previous"));
  const prev = prevRows && prevRows.length > 0 ? usersBy(prevRows, label) : null;
  return DEVICE_NAMES.map(({ name }) => bar(name, cur.get(name) ?? 0, prev ? (prev.get(name) ?? 0) : null));
}

/** 나라 — 많은 셋 + 기타 */
export function countryBars(bundle: StatsBundle | null, top = 3): HBarRow[] {
  const label = (key: string) => (countryLabel(key) === "한국" ? "대한민국" : countryLabel(key));
  const cur = usersBy(ga4(bundle, "country", "current"), label);
  const prevRows = prevGuard(bundle)(ga4(bundle, "country", "previous"));
  const prev = prevRows && prevRows.length > 0 ? usersBy(prevRows, label) : null;
  const ranked = [...cur.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = ranked.slice(0, top);
  const names = new Set(head.map(([name]) => name));
  const rows = head.map(([name, value]) => bar(name, value, prev ? (prev.get(name) ?? 0) : null));
  const restNow = ranked.slice(top).reduce((acc, [, value]) => acc + value, 0);
  const restBefore = prev ? [...prev.entries()].filter(([name]) => !names.has(name)).reduce((acc, [, v]) => acc + v, 0) : null;
  if (ranked.length > top) rows.push(bar("기타", restNow, restBefore));
  return rows;
}

/* ─────────────────────── 성과 ─────────────────────── */

export type Outcome = {
  id: string;
  title: string;
  sub: string;
  value: number | null;
  unit: string;
  delta: DeltaView;
  note?: string;
};

function eventCount(bundle: StatsBundle | null, name: string, when: When): number | null {
  const rows = ga4(bundle, "event", when);
  if (rows.length === 0) return null;
  return sumField(rows.filter((row) => row.key === name), "events") ?? 0;
}

/** 지금·앞 기간 어디에도 그 이벤트가 한 번도 없으면 아직 모으지 않은 것 — 0 이 아니라 「—」 */
function eventSeen(bundle: StatsBundle | null, name: string): boolean {
  return (["current", "previous"] as const).some((when) =>
    ga4(bundle, "event", when).some((row) => row.key === name)
  );
}

/** 문의하기 누름 = lets_talk_click 만. 문의 접수 = generate_lead (요약 카드 아래 줄과 같은 값) */
export function outcomes(bundle: StatsBundle | null): Outcome[] {
  const prev = prevGuard(bundle);
  const metric = (field: "lets_talk_click" | "generate_lead") => {
    const value = readMetricCompare(bundle, field);
    return {
      current: typeof value?.current === "number" ? value.current : null,
      previous: prev(typeof value?.previous === "number" ? value.previous : null)
    };
  };
  const event = (name: string) => {
    if (!eventSeen(bundle, name)) return { current: null, previous: null };
    return {
      current: eventCount(bundle, name, "current"),
      previous: prev(eventCount(bundle, name, "previous"))
    };
  };
  const make = (pair: { current: number | null; previous: number | null }, unit: string): Pick<Outcome, "value" | "delta" | "unit"> => ({
    value: pair.current,
    unit,
    delta: makeDelta(pair.current, pair.previous, "ratio", true, withUnit(unit)(intText(pair.previous)))
  });
  return [
    { id: "click", title: "문의하기 누름", sub: "Let's Talk", ...make(metric("lets_talk_click"), "회") },
    {
      id: "lead",
      title: "문의 접수",
      sub: "실제로 제출된 문의 양식",
      ...make(metric("generate_lead"), "건"),
      note: "메일·전화 문의는 포함하지 않습니다"
    },
    { id: "newsletter", title: "뉴스레터 신청", sub: "새 소식 받아 보기", ...make(event("newsletter_signup"), "건") },
    { id: "talent", title: "채용 알림 신청", sub: "새 채용 소식 받아 보기", ...make(event("talent_signup"), "건") }
  ];
}

/* ─────────────────────── 맨 위 답 문장 ─────────────────────── */

/** 「한 번에 <em>2.3개 페이지</em>를 보고, 평균 1분 18초 머물러요.」 — 시간대(낮에)는 모으기 전이라 쓰지 않는다 */
export function visitsAnswer(bundle: StatsBundle | null): { lead: string; em: string; tail: string } | null {
  const depth = pagesPerSessionOf(bundle, "current");
  if (depth == null) return null;
  const dwell = durationText(dwellSecondsOf(bundle, "current"));
  return {
    lead: "한 번에 ",
    em: `${numText(depth, 1)}개 페이지`,
    tail: dwell ? `를 보고, 평균 ${dwell} 머물러요.` : "를 살펴봐요."
  };
}
