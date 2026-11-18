"use client";

/**
 * 홈페이지 통계 — 목업 hub-stats-v3 의 공통 머리(기간 · 마지막 수집 · 비교 줄 · 지금 방문객)와 아래 줄.
 * 주소는 /website/stats/... (요약·콘텐츠·검색·AI·방문 패턴).
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";

import { useStatsActionsLoader } from "@/components/website/stats/stats-actions";
import { previousIsOldSite, readActualRange } from "@/components/website/stats/stats-data";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import { V3Ai } from "@/components/website/stats-v3/v3-ai";
import { aiDayBucket, aiDayRanges, prevDayRanges, type V3AiDays } from "@/components/website/stats-v3/v3-ai-days";
import { useV3Catalog } from "@/components/website/stats-v3/v3-catalog";
import { V3Content } from "@/components/website/stats-v3/v3-content";
import { V3Live } from "@/components/website/stats-v3/v3-live";
import { V3Overview } from "@/components/website/stats-v3/v3-overview";
import {
  compareLine,
  previousStartsBeforeLaunch,
  rangeForPreset,
  seoulToday,
  V3_DEFAULT_PRESET,
  syncMainLine
} from "@/components/website/stats-v3/v3-period";
import {
  V3_NEEDS_CATALOG,
  V3_SCREENS,
  type V3Extras,
  type V3ScreenId,
  type V3ScreenProps
} from "@/components/website/stats-v3/v3-screens";
import { V3Search } from "@/components/website/stats-v3/v3-search";
import { V3Visits } from "@/components/website/stats-v3/v3-visits";
import "./v3.css";
import { getAiAnswerSummary, getStatsBundle } from "@/lib/website/api";
import {
  PERIOD_PRESETS,
  type AiAnswerSummary,
  type PeriodPresetId,
  type StatsBundle,
  type StatsSyncStatus
} from "@/lib/website/stats";

/**
 * AI 화면만 쓰는 따로 받는 자료 — 「답에 씀」 기록과 날짜별 로봇 · 방문.
 * 기간은 고른 날짜가 아니라 본 응답이 실제로 센 기간(actual_from ~ actual_to)이다.
 * 홈페이지는 오픈일(11-11)을 넘는 기간을 오픈일부터로 자르므로, 고른 날짜로 받으면 맨 위 숫자에 없는 오픈 전 날이 그래프에 섞인다.
 * 그래서 본 응답이 오기 전(range=null)에는 받지 않고 「불러오는 중」으로 둔다.
 * 받은 값이 어느 기간 것인지 같이 둔다. 기간을 바꾸면 새 응답 전까지 옛 기간 값을 보이지 않는다.
 */
type ExtrasRange = {
  from: string;
  to: string;
  /** 앞 기간(본 응답의 prev_from ~ prev_to). 모르면 빈 글 */
  prevFrom: string;
  prevTo: string;
  /** 앞 기간이 새 홈페이지를 열기 전이면 앞 기간 칸은 받지 않는다 */
  oldSite: boolean;
};

/** 앞 기간 칸을 받지 않을 때 마우스 상자에 쓰는 까닭. 받을 수 있으면 null */
function previousSkipReason(range: ExtrasRange): string | null {
  if (range.oldSite) return "앞 기간은 새 홈페이지를 열기 전";
  if (!range.prevFrom || !range.prevTo) return "앞 기간 날짜를 알 수 없음";
  return null;
}

function useV3Extras(enabled: boolean, range: ExtrasRange | null, mainFailed = false): V3Extras {
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  const prevFrom = range?.prevFrom ?? "";
  const prevTo = range?.prevTo ?? "";
  const oldSite = range?.oldSite ?? false;
  const key = `${from}|${to}`;
  const [answers, setAnswers] = useState<{ key: string; summary: AiAnswerSummary | null; ok: boolean } | null>(null);
  const [days, setDays] = useState<{ key: string; value: V3AiDays } | null>(null);

  useEffect(() => {
    if (!enabled || !from || !to || from > to) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const at = `${from}|${to}`;
    void getAiAnswerSummary({ from, to, signal }).then((result) => {
      if (signal.aborted) return;
      // 표가 아직 없거나 읽기 실패면 「기록 없음」으로 둔다
      setAnswers({ key: at, summary: result.ok ? result.data : null, ok: result.ok });
    });
    const ranges = aiDayRanges(from, to);
    const fetchDay = (day: { from: string; to: string }) =>
      getStatsBundle({ from: day.from, to: day.to, kinds: ["bots", "ai_visits"], signal });
    // 같은 자리 앞 기간 칸: 마우스 상자에서 견줄 값. 받기 실패해도 이번 기간 그래프는 그린다
    const skip = previousSkipReason({ from, to, prevFrom, prevTo, oldSite });
    const prevRanges = skip ? null : prevDayRanges(ranges, from, prevFrom, prevTo);
    const prevJob = prevRanges
      ? Promise.all(prevRanges.map((day) => (day ? fetchDay(day) : Promise.resolve(null))))
      : Promise.resolve(null);
    void Promise.all([Promise.all(ranges.map(fetchDay)), prevJob]).then(([results, prevResults]) => {
      if (signal.aborted) return;
      if (results.some((result) => !result.ok)) {
        setDays({ key: at, value: { state: "error", buckets: [] } });
        return;
      }
      const bundles = results.map((result) => (result.ok ? result.data.bundle : null));
      const prevFailed = prevResults != null && prevResults.some((result) => result != null && !result.ok);
      const previous =
        prevRanges && prevResults && !prevFailed
          ? prevRanges.map((day, i) => {
              const result = prevResults[i];
              return day && result && result.ok ? aiDayBucket(day, result.data.bundle) : null;
            })
          : null;
      setDays({
        key: at,
        value: {
          state: "ready",
          buckets: ranges.map((range, i) => aiDayBucket(range, bundles[i])),
          since: bundles.find((bundle) => bundle?.bots?.bots?.since)?.bots?.bots?.since ?? null,
          previous,
          previousReason: skip ?? (prevFailed ? "앞 기간 자료를 받지 못함" : null)
        }
      });
    });
    return () => controller.abort();
  }, [enabled, from, to, prevFrom, prevTo, oldSite]);

  const answersNow = range && answers && answers.key === key ? answers : null;
  const daysNow = range && days && days.key === key ? days.value : null;
  return {
    answers: answersNow
      ? { state: answersNow.ok ? "ready" : "none", summary: answersNow.summary }
      : { state: "loading", summary: null },
    aiDays: enabled
      ? (daysNow ?? (mainFailed ? { state: "error", buckets: [] } : { state: "loading", buckets: [] }))
      : { state: "off", buckets: [] }
  };
}

export const V3_SCREEN_PARTS: Partial<Record<V3ScreenId, ComponentType<V3ScreenProps>>> = {
  summary: V3Overview,
  content: V3Content,
  search: V3Search,
  ai: V3Ai,
  behavior: V3Visits
};

function SyncLine({ status }: { status: StatsSyncStatus | null }) {
  if (!status) return null;
  const main = syncMainLine(status.kinds);
  const gaMissing = status.ga_daily_data_missing;
  if (!main && !gaMissing) return null;
  return (
    <span className="v3-sync" role="status">
      {main ? <span className={main.tone ?? undefined}>{main.text}</span> : null}
      {gaMissing ? (
        <span className="warn">
          {main ? " · " : ""}
          {status.ga_daily_latest_date
            ? `GA 최근 데이터 없음 (마지막 ${status.ga_daily_latest_date})`
            : "GA 최근 데이터 없음"}
        </span>
      ) : null}
    </span>
  );
}

export type V3HeaderProps = {
  preset: PeriodPresetId;
  from: string;
  to: string;
  today: string;
  compareText: string;
  showOldSite: boolean;
  syncStatus: StatsSyncStatus | null;
  onPreset: (next: PeriodPresetId) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
};

export function V3Header(props: V3HeaderProps) {
  const { preset, from, to, today } = props;
  return (
    <header className="v3-topbar">
      <div className="v3-toprow">
        <div className="v3-periods" role="group" aria-label="기간 선택">
          {PERIOD_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={preset === item.id ? "active" : undefined}
              aria-pressed={preset === item.id}
              onClick={() => props.onPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <SyncLine status={props.syncStatus} />
        <div className="v3-compare">
          <span>{props.compareText}</span>
          {props.showOldSite ? <span className="v3-badge">앞 기간은 옛 사이트</span> : null}
        </div>
      </div>
      {preset === "custom" ? (
        <div className="v3-custom-range">
          <label>
            시작{" "}
            <input
              type="date"
              value={from}
              max={to}
              aria-label="시작 날짜"
              onChange={(event) => props.onFrom(event.target.value)}
            />
          </label>
          <span>~</span>
          <label>
            끝{" "}
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              aria-label="끝 날짜"
              onChange={(event) => props.onTo(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <V3Live />
    </header>
  );
}

/** 바깥 틀 — 머리 · 화면 · 아래 줄 */
export function V3Frame({ header, label, children }: { header: ReactNode; label?: string; children: ReactNode }) {
  return (
    <div className="v3">
      <div className="v3-inner">
        {header}
        <section className="v3-screen" aria-label={label}>
          {children}
        </section>
        <footer className="v3-footer">
          <span>고른 기간과 바로 앞의 같은 길이 기간을 비교합니다</span>
          <span />
        </footer>
      </div>
    </div>
  );
}

export function V3Shell({ screen }: { screen: V3ScreenId }) {
  const today = useMemo(() => seoulToday(), []);
  const initial = rangeForPreset(V3_DEFAULT_PRESET, today);
  const [preset, setPreset] = useState<PeriodPresetId>(V3_DEFAULT_PRESET);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [bundle, setBundle] = useState<StatsBundle | null>(null);
  const [syncStatus, setSyncStatus] = useState<StatsSyncStatus | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const config = V3_SCREENS.find((item) => item.id === screen);
  const kinds = config?.kinds;
  const catalog = useV3Catalog(V3_NEEDS_CATALOG.includes(screen));
  /** 본 응답이 어느 요청 기간 것인지. 기간을 바꾼 직후 옛 응답의 실제 기간으로 AI 자료를 받지 않게 */
  const [bundleKey, setBundleKey] = useState<string | null>(null);

  useEffect(() => {
    if (!kinds || !from || !to || from > to) return;
    const controller = new AbortController();
    const at = `${from}|${to}`;
    setStatus("loading");
    void getStatsBundle({ from, to, kinds, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setBundle(null);
        setBundleKey(null);
        setSyncStatus(null);
        setStatus("error");
        return;
      }
      setBundle(result.data.bundle);
      setBundleKey(at);
      setSyncStatus(result.data.sync_status);
      setStatus("ready");
    });
    return () => controller.abort();
  }, [from, to, kinds]);

  const apiRange = readActualRange(bundle);
  // AI 날짜별 자료는 본 응답의 실제 기간으로 받는다. 옛 응답이라 실제 기간 칸이 없으면 고른 기간을 쓴다
  const bundleFresh = status === "ready" && bundleKey === `${from}|${to}`;
  const extrasFrom = bundleFresh ? (apiRange?.actualFrom ?? from) : null;
  const extrasTo = bundleFresh ? (apiRange?.actualTo ?? to) : null;
  const extrasPrevFrom = bundleFresh ? (apiRange?.prevFrom ?? "") : "";
  const extrasPrevTo = bundleFresh ? (apiRange?.prevTo ?? "") : "";
  const extrasOldSite = bundleFresh ? previousIsOldSite(bundle) : false;
  const extrasRange = useMemo(
    () =>
      extrasFrom && extrasTo
        ? { from: extrasFrom, to: extrasTo, prevFrom: extrasPrevFrom, prevTo: extrasPrevTo, oldSite: extrasOldSite }
        : null,
    [extrasFrom, extrasTo, extrasPrevFrom, extrasPrevTo, extrasOldSite]
  );
  const extras = useV3Extras(screen === "ai", extrasRange, status === "error");
  const markRange = apiRange
    ? { from: apiRange.actualFrom, to: apiRange.actualTo }
    : from && to && from <= to
      ? { from, to }
      : null;
  const actions = useStatsActionsLoader(today, bundle, markRange);
  const Screen = V3_SCREEN_PARTS[screen];

  function applyPreset(next: PeriodPresetId) {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <V3Frame
      label={config?.label}
      header={
        <V3Header
          preset={preset}
          from={from}
          to={to}
          today={today}
          compareText={compareLine(preset, from, to, today, apiRange)}
          showOldSite={apiRange?.prevIncludesPreLaunch ?? previousStartsBeforeLaunch(from, to)}
          syncStatus={syncStatus}
          onPreset={applyPreset}
          onFrom={setFrom}
          onTo={setTo}
        />
      }
    >
      {Screen ? (
        <Screen bundle={bundle} status={status} from={from} to={to} today={today} catalog={catalog} actions={actions} extras={extras} />
      ) : null}
    </V3Frame>
  );
}
