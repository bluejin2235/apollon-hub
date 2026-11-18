"use client";

/**
 * 홈페이지 통계 — 목업 hub-stats-v3 의 공통 머리(기간 · 마지막 수집 · 비교 줄 · 지금 방문객)와 아래 줄.
 * 주소는 /website/stats/... (요약·콘텐츠·검색·AI·방문 패턴).
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";

import { useStatsActionsLoader } from "@/components/website/stats/stats-actions";
import { readActualRange, readLaunchDate, SITE_LAUNCH_DATE } from "@/components/website/stats/stats-data";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import { Source } from "@/components/website/stats-v3/v3-parts";
import { V3Ai } from "@/components/website/stats-v3/v3-ai";
import {
  aiDayBucket,
  aiDayRanges,
  prevSlotPlan,
  prevSlotsFrom,
  type AiDayRange,
  type AiPrevSlot,
  type V3AiDays
} from "@/components/website/stats-v3/v3-ai-days";
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
  /** 앞 기간(본 응답의 prev_from ~ prev_to). 모르면 빈 글 → 칸마다 「비교 기간 밖」 */
  prevFrom: string;
  prevTo: string;
  /** 새 홈페이지를 연 날. 이보다 앞에 걸친 앞 기간 칸은 받지 않는다 */
  launch: string | null;
  /**
   * 본 요청과 같은 입력 번호. 같은 날짜로 되돌리거나 실제 기간이 같게 잘려도 번호가 다르면
   * 옛 날짜별 자료 · 옛 실패 · 옛 비교 값 · 옛 답에 씀 기록을 쓰지 않고 새 요청을 기다린다
   */
  seq: number;
};

type DayFetch = { ok: true; bundle: StatsBundle | null } | { ok: false };

/** 하루(또는 묶음) 칸 하나 받기. 거절(예외)도 실패로 바꿔 돌려준다. 페이지가 깨지지 않게 */
function fetchDay(day: { from: string; to: string }, signal: AbortSignal): Promise<DayFetch> {
  return getStatsBundle({ from: day.from, to: day.to, kinds: ["bots", "ai_visits"], signal }).then(
    (result): DayFetch => (result.ok ? { ok: true, bundle: result.data.bundle } : { ok: false }),
    (): DayFetch => ({ ok: false })
  );
}

function useV3Extras(enabled: boolean, range: ExtrasRange | null, mainFailed = false): V3Extras {
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  const prevFrom = range?.prevFrom ?? "";
  const prevTo = range?.prevTo ?? "";
  const launch = range?.launch ?? null;
  const seq = range?.seq ?? -1;
  const key = `${seq}|${from}|${to}`;
  const prevKey = `${seq}|${from}|${to}|${prevFrom}|${prevTo}|${launch ?? ""}`;
  const [answers, setAnswers] = useState<{ key: string; summary: AiAnswerSummary | null; ok: boolean } | null>(null);
  const [days, setDays] = useState<{ key: string; value: V3AiDays } | null>(null);
  const [prevSlots, setPrevSlots] = useState<{ key: string; slots: AiPrevSlot[] } | null>(null);

  // ① 이번 기간: 앞 기간을 기다리지 않고 먼저 그린다
  useEffect(() => {
    if (!enabled || !from || !to || from > to) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const at = `${seq}|${from}|${to}`;
    void getAiAnswerSummary({ from, to, signal }).then(
      (result) => {
        if (signal.aborted) return;
        // 표가 아직 없거나 읽기 실패면 「기록 없음」으로 둔다
        setAnswers({ key: at, summary: result.ok ? result.data : null, ok: result.ok });
      },
      () => {
        if (!signal.aborted) setAnswers({ key: at, summary: null, ok: false });
      }
    );
    const ranges = aiDayRanges(from, to);
    void Promise.allSettled(ranges.map((day) => fetchDay(day, signal))).then((settled) => {
      if (signal.aborted) return;
      const results = settled.map((item) => (item.status === "fulfilled" ? item.value : ({ ok: false } as DayFetch)));
      // 이번 기간은 한 칸이라도 빠지면 선이 거짓이 되므로 「불러오지 못함」으로 둔다
      if (results.some((result) => !result.ok)) {
        setDays({ key: at, value: { state: "error", buckets: [] } });
        return;
      }
      const bundles = results.map((result) => (result.ok ? result.bundle : null));
      setDays({
        key: at,
        value: {
          state: "ready",
          buckets: ranges.map((day, i) => aiDayBucket(day, bundles[i])),
          since: bundles.find((bundle) => bundle?.bots?.bots?.since)?.bots?.bots?.since ?? null
        }
      });
    });
    return () => controller.abort();
  }, [enabled, from, to, seq]);

  // ② 앞 기간: 따로 받는다. 받은 칸만 붙이고, 실패 · 거절된 칸은 그 칸만 「앞 기간 자료를 받지 못함」
  useEffect(() => {
    if (!enabled || !from || !to || from > to) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const at = `${seq}|${from}|${to}|${prevFrom}|${prevTo}|${launch ?? ""}`;
    const plan = prevSlotPlan(aiDayRanges(from, to), from, prevFrom, prevTo, launch);
    const wanted = plan.filter((slot) => !slot.reason && slot.range).map((slot) => slot.range as AiDayRange);
    void Promise.allSettled(wanted.map((day) => fetchDay(day, signal))).then((settled) => {
      if (signal.aborted) return;
      setPrevSlots({ key: at, slots: prevSlotsFrom(plan, settled) });
    });
    return () => controller.abort();
  }, [enabled, from, to, prevFrom, prevTo, launch, seq]);

  const answersNow = range && answers && answers.key === key ? answers : null;
  const daysNow = range && days && days.key === key ? days.value : null;
  const prevNow = range && prevSlots && prevSlots.key === prevKey ? prevSlots.slots : null;
  return {
    answers: answersNow
      ? { state: answersNow.ok ? "ready" : "none", summary: answersNow.summary }
      : mainFailed
        ? // 본 응답이 실패하면 기간을 몰라 답에 씀 기록을 받지 않는다. 「불러오는 중」에 머물지 않고 실패로 보인다
          { state: "error", summary: null }
        : { state: "loading", summary: null },
    aiDays: enabled
      ? daysNow
        ? { ...daysNow, previous: prevNow }
        : mainFailed
          ? { state: "error", buckets: [] }
          : { state: "loading", buckets: [] }
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
  const { catalog, state: catalogState } = useV3Catalog(V3_NEEDS_CATALOG.includes(screen));
  /**
   * 날짜를 고칠 때마다 1씩 오르는 번호. 요청은 보낸 때의 번호를 달고, 응답(bundleSeq)이 지금 번호와 같을 때만 「지금 기간의 응답」이다.
   * 날짜를 지웠다가 같은 날짜로 되돌려도 번호가 달라서 옛 응답을 다시 쓰지 않는다(새 요청의 응답을 기다린다)
   */
  const [inputSeq, setInputSeq] = useState(0);
  /** 본 응답이 몇 번째 입력 때 보낸 요청의 것인지 */
  const [bundleSeq, setBundleSeq] = useState<number | null>(null);

  useEffect(() => {
    if (!kinds || !from || !to || from > to) return;
    const controller = new AbortController();
    const at = inputSeq;
    setStatus("loading");
    void getStatsBundle({ from, to, kinds, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setBundle(null);
        // 실패도 몇 번째 입력의 실패인지 남긴다. 옛 입력의 실패를 새 입력에 보이지 않게
        setBundleSeq(at);
        setSyncStatus(null);
        setStatus("error");
        return;
      }
      setBundle(result.data.bundle);
      setBundleSeq(at);
      setSyncStatus(result.data.sync_status);
      setStatus("ready");
    });
    return () => controller.abort();
  }, [from, to, kinds, inputSeq]);

  const apiRange = readActualRange(bundle);
  // AI 날짜별 자료는 본 응답의 실제 기간으로 받는다. 옛 응답이라 실제 기간 칸이 없으면 고른 기간을 쓴다
  /** 지금 상태(준비 · 실패)가 지금 입력 때 보낸 요청의 것인가 */
  const statusCurrent = bundleSeq === inputSeq;
  const bundleFresh = status === "ready" && statusCurrent;
  const mainFailed = status === "error" && statusCurrent;
  const extrasFrom = bundleFresh ? (apiRange?.actualFrom ?? from) : null;
  const extrasTo = bundleFresh ? (apiRange?.actualTo ?? to) : null;
  const extrasPrevFrom = bundleFresh ? (apiRange?.prevFrom ?? "") : "";
  const extrasPrevTo = bundleFresh ? (apiRange?.prevTo ?? "") : "";
  const extrasLaunch = bundleFresh ? (readLaunchDate(bundle) ?? SITE_LAUNCH_DATE ?? null) : null;
  const extrasRange = useMemo(
    () =>
      extrasFrom && extrasTo
        ? {
            from: extrasFrom,
            to: extrasTo,
            prevFrom: extrasPrevFrom,
            prevTo: extrasPrevTo,
            launch: extrasLaunch,
            seq: inputSeq
          }
        : null,
    [extrasFrom, extrasTo, extrasPrevFrom, extrasPrevTo, extrasLaunch, inputSeq]
  );
  const extras = useV3Extras(screen === "ai", extrasRange, mainFailed);
  // 조치 기록도 옛 기간 응답의 실제 기간으로 받지 않는다. 새 응답 전에는 고른 날짜를 쓴다
  const markApi = bundleFresh ? apiRange : null;
  const markRange = markApi
    ? { from: markApi.actualFrom, to: markApi.actualTo }
    : from && to && from <= to
      ? { from, to }
      : null;
  const actions = useStatsActionsLoader(today, bundleFresh ? bundle : null, markRange);
  const Screen = V3_SCREEN_PARTS[screen];

  // 날짜가 실제로 바뀔 때만 입력 번호를 올린다
  function changeFrom(value: string) {
    if (value === from) return;
    setFrom(value);
    setInputSeq((n) => n + 1);
  }
  function changeTo(value: string) {
    if (value === to) return;
    setTo(value);
    setInputSeq((n) => n + 1);
  }

  function applyPreset(next: PeriodPresetId) {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    if (range.from === from && range.to === to) return;
    setFrom(range.from);
    setTo(range.to);
    setInputSeq((n) => n + 1);
  }

  // 맨 위 비교 줄 · 옛 사이트 알림: 지금 고른 기간의 응답이 왔을 때만 응답의 실제 기간을 쓴다.
  // 기간을 바꾼 직후(옛 응답)에는 고른 날짜로 계산해 옛 기간 글이 남지 않게 한다
  const headRange = bundleFresh ? apiRange : null;
  // 화면 본문(요약 · 콘텐츠 · 검색 · AI · 방문 패턴)은 지금 고른 기간의 응답이 왔을 때만 응답을 받는다.
  // 그 전에는 응답 없이(null) 「불러오는 중」으로 그려, 옛 기간 응답에서 나온 글이 한 줄도 남지 않게 한다.
  // 머리(기간 고르기 · 비교 줄)만 늘 보인다. 실패면 「불러오지 못함」 그대로
  const screenBundle = bundleFresh ? bundle : null;
  // 직접 고른 날짜가 비었거나 시작이 끝보다 늦으면 요청을 보내지 않으므로, 본문 대신 날짜를 고르라는 글을 쓴다
  const rangeProblem =
    !from || !to
      ? "날짜를 골라 주세요. 시작 날짜와 끝 날짜가 모두 있어야 숫자를 불러와요."
      : from > to
        ? "시작 날짜가 끝 날짜보다 늦어요. 날짜를 다시 골라 주세요."
        : null;
  const screenStatus: LoadStatus = bundleFresh ? status : mainFailed ? "error" : "loading";

  return (
    <V3Frame
      label={config?.label}
      header={
        <V3Header
          preset={preset}
          from={from}
          to={to}
          today={today}
          compareText={compareLine(preset, from, to, today, headRange)}
          showOldSite={headRange?.prevIncludesPreLaunch ?? previousStartsBeforeLaunch(from, to)}
          // GA 수집 안내도 지금 고른 기간의 응답이 왔을 때만. 그 전에는 옛 응답을 읽지 않는다
          syncStatus={bundleFresh ? syncStatus : null}
          onPreset={applyPreset}
          onFrom={changeFrom}
          onTo={changeTo}
        />
      }
    >
      {rangeProblem ? (
        // 날짜를 지웠거나 거꾸로 골랐으면 요청을 보내지 않는다. 「불러오는 중」에 머물지 않고 고칠 일을 알린다
        <div className="v3-card">
          <p className="v3-tiny" role="status">
            {rangeProblem}
          </p>
        </div>
      ) : Screen ? (
        <Source state={screenStatus}>
          <Screen
            bundle={screenBundle}
            status={screenStatus}
            fresh={bundleFresh}
            from={from}
            to={to}
            today={today}
            catalog={catalog}
            catalogState={catalogState}
            actions={actions}
            extras={extras}
          />
        </Source>
      ) : null}
    </V3Frame>
  );
}
