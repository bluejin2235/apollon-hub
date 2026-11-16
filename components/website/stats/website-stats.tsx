"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ActionsScreen } from "@/components/website/stats/actions-screen";
import { AI_KINDS } from "@/components/website/stats/ai-data";
import { AiScreen } from "@/components/website/stats/ai-screen";
import { BEHAVIOR_KINDS } from "@/components/website/stats/behavior-data";
import { BehaviorScreen } from "@/components/website/stats/behavior-screen";
import { CONTENT_KINDS } from "@/components/website/stats/content-data";
import { ContentScreen } from "@/components/website/stats/content-screen";
import { SEARCH_KINDS } from "@/components/website/stats/search-data";
import { SearchScreen } from "@/components/website/stats/search-screen";
import {
  StatsActionsContext,
  useStatsActionsLoader
} from "@/components/website/stats/stats-actions";
import {
  readActualRange,
  SITE_LAUNCH_DATE,
  type ActualCompareRange
} from "@/components/website/stats/stats-data";
import { type LoadStatus, type StatsData } from "@/components/website/stats/stats-slot";
import { SUMMARY_KINDS } from "@/components/website/stats/summary-data";
import { SummaryScreen } from "@/components/website/stats/summary-screen";
import "./stats.css";
import { getStatsBundle, getStatsRealtime } from "@/lib/website/api";
import {
  PERIOD_PRESETS,
  STATS_SCREENS,
  type PeriodPresetId,
  type StatsBundle,
  type StatsScreenId,
  type StatsSyncKindStatus,
  type StatsSyncStatus
} from "@/lib/website/stats";

/** 화면마다 필요한 kind 가 다르다. 안 쓰는 것까지 받지 않는다 */
const KINDS_BY_SCREEN: Partial<Record<StatsScreenId, string[]>> = {
  summary: SUMMARY_KINDS,
  content: CONTENT_KINDS,
  search: SEARCH_KINDS,
  ai: [...AI_KINDS],
  behavior: BEHAVIOR_KINDS
};

function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function addIsoDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return utc.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1 + months, day));
  return utc.toISOString().slice(0, 10);
}

function rangeForPreset(preset: PeriodPresetId, today: string): { from: string; to: string } {
  if (preset === "yesterday") {
    const day = addIsoDays(today, -1);
    return { from: day, to: day };
  }
  // 방문 데이터는 어제까지다. 끝만 어제로 두고, 일수는 오늘을 포함하던 때와 같게 하루씩 당긴다.
  const end = addIsoDays(today, -1);
  if (preset === "7d") return { from: addIsoDays(end, -6), to: end };
  if (preset === "30d") return { from: addIsoDays(end, -29), to: end };
  if (preset === "3m") return { from: addIsoDays(addMonths(today, -3), -1), to: end };
  if (preset === "6m") return { from: addIsoDays(addMonths(today, -6), -1), to: end };
  if (preset === "1y") return { from: addIsoDays(addMonths(today, -12), -1), to: end };
  return { from: addIsoDays(end, -29), to: end };
}

function isoParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** 시작·끝 포함 일수 */
function inclusiveDays(from: string, to: string): number {
  const a = isoParts(from);
  const b = isoParts(to);
  const start = Date.UTC(a.y, a.m - 1, a.d);
  const end = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** 고른 기간 바로 앞의 같은 길이 */
function previousRange(from: string, to: string): { from: string; to: string } {
  const length = inclusiveDays(from, to);
  const prevTo = addIsoDays(from, -1);
  const prevFrom = addIsoDays(prevTo, -(length - 1));
  return { from: prevFrom, to: prevTo };
}

/** 올해가 아니면 해를 붙인다. 11월 11일 · 2025년 11월 11일 */
function dayText(iso: string, todayYear: number): string {
  const { y, m, d } = isoParts(iso);
  const year = y !== todayYear ? `${y}년 ` : "";
  return `${year}${m}월 ${d}일`;
}

/** 같은 달이면 끝 날짜의 달을 빼 11월 5일~11일 로 적는다 */
function rangeText(from: string, to: string, todayYear: number): string {
  if (from === to) return dayText(from, todayYear);
  const a = isoParts(from);
  const b = isoParts(to);
  const start = dayText(from, todayYear);
  if (a.y === b.y && a.m === b.m) return `${start}~${b.d}일`;
  const endYear = a.y !== b.y ? `${b.y}년 ` : "";
  return `${start}~${endYear}${b.m}월 ${b.d}일`;
}

/** 앞 기간 끝 글자의 받침으로 「와/과」를 고른다. 괄호는 건너뛴다. */
function compareParticle(text: string): "와" | "과" {
  for (let i = text.length - 1; i >= 0; i--) {
    const code = text.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) continue;
    return (code - 0xac00) % 28 === 0 ? "와" : "과";
  }
  return "와";
}

function compareLine(
  preset: PeriodPresetId,
  from: string,
  to: string,
  today: string,
  api: ActualCompareRange | null
): string {
  const todayYear = Number(today.slice(0, 4));
  if (!api) {
    if (!from || !to || from > to) return "";
    const prev = previousRange(from, to);
    const currentMark = preset === "yesterday" ? " (어제)" : "";
    const before = `${rangeText(prev.from, prev.to, todayYear)}${preset === "yesterday" ? " (그저께)" : ""}`;
    return `${rangeText(from, to, todayYear)}${currentMark} ↔ ${before}${compareParticle(before)} 비교`;
  }
  if (api.actualFrom > api.actualTo) return "";

  const yesterday =
    preset === "yesterday" && !api.clipped && api.actualFrom === api.actualTo && api.prevFrom === api.prevTo;
  const current = api.clipped
    ? `오픈 후 ${inclusiveDays(api.actualFrom, api.actualTo)}일 (${rangeText(api.actualFrom, api.actualTo, todayYear)})`
    : `${rangeText(api.actualFrom, api.actualTo, todayYear)}${yesterday ? " (어제)" : ""}`;
  const before = `${rangeText(api.prevFrom, api.prevTo, todayYear)}${yesterday ? " (그저께)" : ""}`;
  return `${current} ↔ ${before}${compareParticle(before)} 비교`;
}

/** 앞 기간 시작이 오픈일보다 앞이면 옛 사이트 구간이다. 오픈일이 없으면 표시하지 않는다. */
function previousStartsBeforeLaunch(from: string, to: string): boolean {
  if (!SITE_LAUNCH_DATE || !from || !to || from > to) return false;
  return previousRange(from, to).from < SITE_LAUNCH_DATE;
}

function ScreenShell({
  id,
  children
}: {
  id: StatsScreenId;
  children?: ReactNode;
}) {
  const screen = STATS_SCREENS.find((item) => item.id === id);
  if (!screen) return null;
  return (
    <section className="ws-screen">
      <h2 className="ws-pt">{screen.label}</h2>
      <p className="ws-lede">{screen.lede}</p>
      {children}
    </section>
  );
}

type LiveLang = "국" | "영";

type LivePage = { title: string; lang: LiveLang | null };

type LiveVisitors = {
  count: number | null;
  pages: LivePage[];
};

const LIVE_TITLE_TAILS = [" | 아폴론이머시브웍스", " | Apollon Immersive Works"];
const LIVE_ROLL_MS = 4_000;

/**
 * Realtime 은 경로가 없어 제목의 회사명으로 국문·영문을 가른다.
 * 홈은 회사명이 앞에 오므로 끝이 아니라 들어 있는지로 본다. 둘 다 없으면 표시하지 않는다.
 */
function liveLang(name: string): LiveLang | null {
  if (name.includes("Apollon Immersive Works")) return "영";
  if (name.includes("아폴론이머시브웍스")) return "국";
  return null;
}

/** 제목 끝의 사이트 이름을 떼고, 빈 값과 (other) 는 뺀다 */
function cleanLiveTitle(name: string): string | null {
  let text = name.trim();
  if (!text || text === "(other)") return null;
  let tail = LIVE_TITLE_TAILS.find((item) => text.endsWith(item));
  while (tail) {
    text = text.slice(0, -tail.length).trim();
    tail = LIVE_TITLE_TAILS.find((item) => text.endsWith(item));
  }
  if (!text || text === "(other)") return null;
  return text;
}

function liveTitles(pages: { name: string }[]): LivePage[] {
  const seen = new Set<string>();
  const titles: LivePage[] = [];
  for (const page of pages) {
    const title = cleanLiveTitle(page.name);
    if (!title) continue;
    const lang = liveLang(page.name);
    const key = `${lang ?? ""}:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push({ title, lang });
  }
  return titles;
}

/**
 * GA4 Realtime — 30초마다. 오류여도 통계 화면은 멈추지 않는다.
 *
 * Realtime 은 pagePath 가 없어 unifiedScreenName(페이지 제목) 을 그대로 쓴다.
 * 경로 → 워크·인사이트 제목 매핑은 할 수 없다.
 */
function useLiveVisitors(): LiveVisitors {
  const [live, setLive] = useState<LiveVisitors>({ count: null, pages: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function pull() {
      const result = await getStatsRealtime(controller.signal);
      if (cancelled) return;
      if (!result.ok || result.data.activeUsers === null) {
        setLive({ count: null, pages: [] });
        return;
      }
      const count = result.data.activeUsers;
      const names = liveTitles(result.data.pages);
      setLive((prev) => {
        const samePages =
          prev.pages.length === names.length &&
          prev.pages.every(
            (page, i) => page.title === names[i].title && page.lang === names[i].lang
          );
        if (prev.count === count && samePages) return prev;
        return { count, pages: samePages ? prev.pages : names };
      });
    }

    void pull();
    const timer = setInterval(() => {
      void pull();
    }, 30_000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return live;
}

/** 제목이 둘 이상일 때만 넘긴다. 하나면 그 제목을 그대로 둔다. */
function LiveTitleRoll({ titles }: { titles: LivePage[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (titles.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % titles.length);
    }, LIVE_ROLL_MS);
    return () => clearInterval(timer);
  }, [titles]);

  const page = titles[index] ?? titles[0];
  if (!page) return null;
  return (
    <>
      {page.lang ? <span className="ws-tag">{page.lang}</span> : null}
      <span className="ws-live-title" key={`${index}-${page.title}`}>
        {page.title}
      </span>
    </>
  );
}

const SYNC_TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** 서울 시간 「M월 D일 HH:mm」 */
function syncTimeText(iso: string): string {
  const parts = SYNC_TIME_FORMAT.formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("month")}월 ${pick("day")}일 ${pick("hour")}:${pick("minute")}`;
}

/** 수집 상태 줄에 보이는 이름. 표에 없는 kind 는 그대로 */
const SYNC_KIND_LABEL: Record<string, string> = {
  daily: "일별",
  channel: "유입 경로",
  country: "국가",
  device: "기기",
  page: "페이지",
  query: "검색어",
  event: "이벤트",
  landing: "첫 페이지",
  landing_channel: "경로별 첫 페이지",
  scroll: "읽은 깊이",
  hourly: "시간대"
};

function syncKindName(item: StatsSyncKindStatus): string {
  const source = item.source === "ga4" ? "GA" : item.source === "gsc" ? "검색" : item.source;
  return `${source}·${SYNC_KIND_LABEL[item.kind] ?? item.kind}`;
}

function okTimes(kinds: StatsSyncKindStatus[]): string[] {
  return kinds
    .map((item) => item.last_ok_at)
    .filter((value): value is string => value !== null)
    .sort();
}

type SyncLine = { tone: "fail" | "warn" | null; text: string };

/** 수집 상태 한 줄. 실패 → 늦음 → 마지막 수집 순서로 하나만 */
function syncMainLine(kinds: StatsSyncKindStatus[]): SyncLine | null {
  if (kinds.length === 0) return null;

  const failed = kinds.filter((item) => item.failed);
  if (failed.length > 0) {
    const names = failed.map(syncKindName).join(", ");
    const error = failed.find((item) => item.last_error)?.last_error;
    const errorHead = error ? `${error.slice(0, 60)}${error.length > 60 ? "…" : ""}` : null;
    return {
      tone: "fail",
      text: errorHead ? `수집 실패 · ${names} · ${errorHead}` : `수집 실패 · ${names}`
    };
  }

  const times = okTimes(kinds);
  if (kinds.some((item) => item.overdue)) {
    const oldest = kinds.some((item) => item.last_ok_at === null) ? null : times[0];
    return {
      tone: "warn",
      text: oldest ? `수집 늦음 · 마지막 수집 ${syncTimeText(oldest)}` : "수집 늦음 · 수집 기록 없음"
    };
  }

  const latest = times[times.length - 1];
  return latest ? { tone: null, text: `마지막 수집 ${syncTimeText(latest)}` } : null;
}

function SyncStatusLine({ status }: { status: StatsSyncStatus | null }) {
  if (!status) return null;
  const main = syncMainLine(status.kinds);
  const gaMissing = status.ga_daily_data_missing;
  if (!main && !gaMissing) return null;

  return (
    <div className="ws-sync" role="status">
      {main ? <span className={main.tone ?? undefined}>{main.text}</span> : null}
      {gaMissing ? (
        <span className="warn">
          {status.ga_daily_latest_date
            ? `GA 최근 데이터 없음 (마지막 ${status.ga_daily_latest_date})`
            : "GA 최근 데이터 없음"}
        </span>
      ) : null}
    </div>
  );
}

export function WebsiteStats({ screen }: { screen: StatsScreenId }) {
  const today = useMemo(() => seoulToday(), []);
  const [preset, setPreset] = useState<PeriodPresetId>("yesterday");
  const initial = rangeForPreset("yesterday", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [bundle, setBundle] = useState<StatsBundle | null>(null);
  const [syncStatus, setSyncStatus] = useState<StatsSyncStatus | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const kinds = KINDS_BY_SCREEN[screen];
  const live = useLiveVisitors();

  useEffect(() => {
    if (!kinds) {
      setBundle(null);
      setStatus("ready");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");

    void getStatsBundle({ from, to, kinds, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setBundle(null);
          setSyncStatus(null);
          setStatus("error");
          return;
        }
        setBundle(result.data.bundle);
        setSyncStatus(result.data.sync_status);
        setStatus("ready");
      }
    );

    return () => {
      controller.abort();
    };
  }, [from, to, kinds]);

  const data: StatsData = { bundle, status };
  const apiRange = readActualRange(bundle);
  const markRange = apiRange
    ? { from: apiRange.actualFrom, to: apiRange.actualTo }
    : from && to && from <= to
      ? { from, to }
      : null;
  const actions = useStatsActionsLoader(today, bundle, markRange);
  const usesPeriod = screen !== "actions";
  const compareText = compareLine(preset, from, to, today, apiRange);
  const showOldSite = apiRange?.prevIncludesPreLaunch ?? previousStartsBeforeLaunch(from, to);

  function applyPreset(next: PeriodPresetId) {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <div className="ws">
      <div className="ws-main">
        <div className="ws-bar">
          <div className="ws-bar-row">
            {usesPeriod ? (
              <div>
                <div className="ws-seg" role="group" aria-label="기간">
                  {PERIOD_PRESETS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={preset === item.id ? "on" : undefined}
                      onClick={() => applyPreset(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <SyncStatusLine status={syncStatus} />
            <div className="ws-live">
              <span className="ws-dot" aria-hidden />
              <span>
                지금 방문객 {live.count === null ? "—" : <b>{live.count}</b>}
                {live.count === null ? null : "명"}
              </span>
              <small>최근 30분</small>
              {live.pages.length > 0 ? (
                <span className="ws-live-watch">
                  <span>보고 있는 콘텐츠</span>
                  <LiveTitleRoll titles={live.pages} />
                </span>
              ) : null}
            </div>
          </div>
          {usesPeriod && compareText ? (
            <p className="ws-compare">
              <span>{compareText}</span>
              {showOldSite ? <span className="ws-stamp">앞 기간은 옛 사이트</span> : null}
            </p>
          ) : null}
          {usesPeriod && preset === "custom" ? (
            <div className="ws-custom">
              <label>
                시작
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                끝
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="ws-bar-spacer" aria-hidden="true" />

        <StatsActionsContext.Provider value={actions}>
        <div className="ws-body">
          {screen === "summary" ? (
          <ScreenShell id="summary">
            <SummaryScreen data={data} from={from} to={to} />
          </ScreenShell>
          ) : null}

          {screen === "content" ? (
            <ScreenShell id="content">
              <ContentScreen data={data} />
            </ScreenShell>
          ) : null}
          {screen === "search" ? (
            <ScreenShell id="search">
              <SearchScreen data={data} />
            </ScreenShell>
          ) : null}
          {screen === "ai" ? <AiScreen data={data} /> : null}
          {screen === "behavior" ? (
            <ScreenShell id="behavior">
              <BehaviorScreen data={data} />
            </ScreenShell>
          ) : null}
          {screen === "actions" ? (
            <ScreenShell id="actions">
              <ActionsScreen today={today} />
            </ScreenShell>
          ) : null}
        </div>
        </StatsActionsContext.Provider>
      </div>
    </div>
  );
}
