"use client";

/**
 * 홈페이지 통계 v3 — 목업 hub-stats-v3 의 공통 머리(기간 · 마지막 수집 · 비교 줄 · 지금 방문객)와 아래 줄.
 * 지금 화면(/website/stats)은 건드리지 않고 /website/stats-v3 에 새로 둔다.
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";

import { useStatsActionsLoader } from "@/components/website/stats/stats-actions";
import { readActualRange } from "@/components/website/stats/stats-data";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import { useV3Catalog } from "@/components/website/stats-v3/v3-catalog";
import { V3Live } from "@/components/website/stats-v3/v3-live";
import {
  compareLine,
  previousStartsBeforeLaunch,
  rangeForPreset,
  seoulToday,
  syncMainLine
} from "@/components/website/stats-v3/v3-period";
import {
  V3_NEEDS_CATALOG,
  V3_SCREENS,
  type V3ScreenId,
  type V3ScreenProps
} from "@/components/website/stats-v3/v3-screens";
import "./v3.css";
import { getStatsBundle } from "@/lib/website/api";
import { PERIOD_PRESETS, type PeriodPresetId, type StatsBundle, type StatsSyncStatus } from "@/lib/website/stats";

const SCREENS: Partial<Record<V3ScreenId, ComponentType<V3ScreenProps>>> = {};

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

export function V3Shell({ screen }: { screen: V3ScreenId }) {
  const today = useMemo(() => seoulToday(), []);
  const initial = rangeForPreset("yesterday", today);
  const [preset, setPreset] = useState<PeriodPresetId>("yesterday");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [bundle, setBundle] = useState<StatsBundle | null>(null);
  const [syncStatus, setSyncStatus] = useState<StatsSyncStatus | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const config = V3_SCREENS.find((item) => item.id === screen);
  const kinds = config?.kinds;
  const catalog = useV3Catalog(V3_NEEDS_CATALOG.includes(screen));

  useEffect(() => {
    if (!kinds || !from || !to || from > to) return;
    const controller = new AbortController();
    setStatus("loading");
    void getStatsBundle({ from, to, kinds, signal: controller.signal }).then((result) => {
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
    });
    return () => controller.abort();
  }, [from, to, kinds]);

  const apiRange = readActualRange(bundle);
  const markRange = apiRange
    ? { from: apiRange.actualFrom, to: apiRange.actualTo }
    : from && to && from <= to
      ? { from, to }
      : null;
  const actions = useStatsActionsLoader(today, bundle, markRange);
  const compareText = compareLine(preset, from, to, today, apiRange);
  const showOldSite = apiRange?.prevIncludesPreLaunch ?? previousStartsBeforeLaunch(from, to);
  const Screen = SCREENS[screen];

  function applyPreset(next: PeriodPresetId) {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <div className="v3">
      <div className="v3-inner">
        <header className="v3-topbar">
          <div className="v3-toprow">
            <div className="v3-periods" role="group" aria-label="기간 선택">
              {PERIOD_PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={preset === item.id ? "active" : undefined}
                  aria-pressed={preset === item.id}
                  onClick={() => applyPreset(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <SyncLine status={syncStatus} />
            <div className="v3-compare">
              <span>{compareText}</span>
              {showOldSite ? <span className="v3-badge">앞 기간은 옛 사이트</span> : null}
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
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <span>—</span>
              <label>
                끝{" "}
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  aria-label="끝 날짜"
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <V3Live />
        </header>

        <section className="v3-screen" aria-label={config?.label}>
          {Screen ? (
            <Screen
              bundle={bundle}
              status={status}
              from={from}
              to={to}
              today={today}
              catalog={catalog}
              actions={actions}
            />
          ) : null}
        </section>

        <footer className="v3-footer">
          <span>고른 기간과 바로 앞의 같은 길이 기간을 비교합니다</span>
          <span />
        </footer>
      </div>
    </div>
  );
}
