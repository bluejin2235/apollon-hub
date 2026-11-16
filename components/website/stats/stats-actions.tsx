"use client";

/**
 * 조치 기록 — 홈페이지에 한 일을 날짜와 함께 적어 둔 것.
 *
 * 통계 화면 맨 바깥(WebsiteStats)이 목록을 한 번 받아 context 로 내려 준다.
 * 그래프(stats-chart)는 화면마다 따로 넘기지 않아도 여기서 읽어 세로선을 긋는다.
 * 그래서 콘텐츠·검색·방문 패턴 화면의 코드는 손대지 않는다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { clip, shortDate } from "@/components/website/stats/stats-data";
import { actionCategoryLabel } from "@/components/website/stats/stats-labels";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import { listStatsActions } from "@/lib/website/api";
import type { StatsAction, StatsBundle } from "@/lib/website/stats";

export type StatsActionsState = {
  status: LoadStatus;
  /** 전부. 날짜 늦은 순 */
  items: StatsAction[];
  /** 그래프에 세로선을 그을 기간. 없으면 긋지 않는다 */
  range: { from: string; to: string } | null;
  reload: () => void;
};

const EMPTY: StatsActionsState = {
  status: "ready",
  items: [],
  range: null,
  reload: () => {}
};

export const StatsActionsContext = createContext<StatsActionsState>(EMPTY);

export function useStatsActions(): StatsActionsState {
  return useContext(StatsActionsContext);
}

/** 늦은 날짜 먼저, 같은 날이면 나중에 적은 것 먼저 */
function newestFirst(a: StatsAction, b: StatsAction): number {
  if (a.action_date !== b.action_date) return a.action_date < b.action_date ? 1 : -1;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/** 통계 응답에 붙어 온 조치. 목록을 못 받았을 때 그래프만이라도 그린다 */
function bundleActions(bundle: StatsBundle | null): StatsAction[] {
  if (!bundle) return [];
  const seen = new Map<string, StatsAction>();
  for (const result of Object.values(bundle)) {
    for (const item of result?.actions ?? []) {
      if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
    }
  }
  return [...seen.values()].sort(newestFirst);
}

/**
 * 조치 기록 전부를 받는다. 몇 해에 수십 건이라 기간으로 나누지 않는다.
 * 고치거나 지운 뒤에는 reload 로 다시 받는다.
 */
export function useStatsActionsLoader(
  today: string,
  bundle: StatsBundle | null,
  range: { from: string; to: string } | null
): StatsActionsState {
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [items, setItems] = useState<StatsAction[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // 고친 뒤 다시 받을 때는 목록을 그대로 두고 뒤에서 바꾼다
    if (tick === 0) setStatus("loading");
    const until = `${Number(today.slice(0, 4)) + 1}-12-31`;
    void listStatsActions({ from: "2020-01-01", to: until, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setItems(null);
          setStatus("error");
          return;
        }
        setItems([...(result.data?.items ?? [])].sort(newestFirst));
        setStatus("ready");
      }
    );
    return () => controller.abort();
  }, [today, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const fallback = useMemo(() => bundleActions(bundle), [bundle]);
  const rangeFrom = range?.from;
  const rangeTo = range?.to;

  return useMemo(
    () => ({
      status,
      items: items ?? fallback,
      range: rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : null,
      reload
    }),
    [status, items, fallback, rangeFrom, rangeTo, reload]
  );
}

/* ─────────────────────── 그래프 세로선 ─────────────────────── */

/** 세로선 하나. 가까운 날의 조치는 한 선으로 묶는다 */
export type ChartMarkGroup = {
  /** data 안의 가로축 값 */
  x: string;
  index: number;
  /** 선 옆에 쓰는 짧은 글 */
  label: string;
  /** 마우스를 올리면 뜨는 목록 */
  lines: string[];
  /** 조치가 하나라도 있으면 true. 오픈 선만 있으면 false */
  hasAction: boolean;
};

type MarkEntry = { index: number; launch: boolean; short: string; line: string };

/** 조치 한 줄 — 11/13 · 검색 최적화 · 워크 JSON-LD 개선. 실제 날짜를 쓴다. */
export function actionLine(item: StatsAction): string {
  const category = actionCategoryLabel(item.category);
  return [shortDate(item.action_date), category, item.title].filter(Boolean).join(" · ");
}

/** 가로축 「M/D」를 기간 안 ISO 날짜로 되돌린다. 연말이 걸치면 from·to 해를 모두 본다. */
function axisIso(label: string, range: { from: string; to: string }): string | null {
  const [month, day] = label.split("/").map(Number);
  if (!month || !day) return null;
  const years = new Set([Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))]);
  let best: string | null = null;
  for (const year of years) {
    if (!Number.isFinite(year)) continue;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso >= range.from && iso <= range.to) return iso;
    if (!best) best = iso;
  }
  return best;
}

/**
 * 조치 날짜가 가로축에 없으면 가장 가까운 칸 번호.
 * 호버 문구(actionLine)는 실제 날짜를 그대로 쓴다.
 */
function nearestAxisIndex(
  xs: string[],
  actionDate: string,
  range: { from: string; to: string }
): number {
  const exact = xs.indexOf(shortDate(actionDate));
  if (exact >= 0) return exact;
  if (xs.length === 0) return -1;

  const actionTime = Date.parse(`${actionDate}T00:00:00Z`);
  if (!Number.isFinite(actionTime)) return 0;

  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const iso = axisIso(xs[i], range);
    if (!iso) continue;
    const dist = Math.abs(Date.parse(`${iso}T00:00:00Z`) - actionTime);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * 오픈 선과 기간 안 조치를 가로축 자리로 바꾸고 가까운 것끼리 묶는다.
 * 점이 8개 넘게 있으면 점 수의 1/8 안쪽은 글자가 겹치므로 한 선으로 둔다.
 * 축에 없는 날짜의 조치는 가장 가까운 칸에 붙인다.
 */
export function chartMarkGroups(params: {
  launch: { x: string; label: string } | undefined;
  actions: StatsAction[];
  range: { from: string; to: string } | null;
  xs: string[];
}): ChartMarkGroup[] {
  const { launch, actions, range, xs } = params;
  const entries: MarkEntry[] = [];

  if (launch) {
    const index = xs.indexOf(launch.x);
    if (index >= 0) entries.push({ index, launch: true, short: launch.label, line: launch.label });
  }
  if (range) {
    for (const item of actions) {
      if (item.action_date < range.from || item.action_date > range.to) continue;
      const index = nearestAxisIndex(xs, item.action_date, range);
      if (index < 0) continue;
      entries.push({ index, launch: false, short: item.title, line: actionLine(item) });
    }
  }
  if (entries.length === 0) return [];

  entries.sort((a, b) => a.index - b.index || Number(b.launch) - Number(a.launch));
  const span = Math.floor(xs.length / 8);
  const buckets: MarkEntry[][] = [];
  for (const entry of entries) {
    const last = buckets[buckets.length - 1];
    if (last && entry.index - last[0].index <= span) last.push(entry);
    else buckets.push([entry]);
  }

  return buckets.map((bucket) => {
    const first = bucket[0];
    const launchEntry = bucket.find((entry) => entry.launch);
    const actionCount = bucket.filter((entry) => !entry.launch).length;
    let label: string;
    if (bucket.length === 1) label = first.launch ? first.short : clip(first.short, 14);
    else if (launchEntry) label = `${launchEntry.short} 외 ${actionCount}건`;
    else label = `조치 ${actionCount}건`;
    return {
      x: xs[first.index],
      index: first.index,
      label,
      lines: bucket.map((entry) => entry.line),
      hasAction: actionCount > 0
    };
  });
}
