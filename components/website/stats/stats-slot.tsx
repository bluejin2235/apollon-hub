"use client";

/**
 * 통계 화면들이 함께 쓰는 자리 — 그래프 한 칸과 소제목 줄.
 * 불러오는 중·못 불러옴·값 없음을 각각 다르게 말한다. 셋 다 그래프를 그리지
 * 않는다. 0 짜리 그래프를 그리면 진짜 0 과 구분되지 않는다.
 */

import type { ReactNode } from "react";

import { StatsEmpty } from "@/components/website/stats/stats-chart";
import type { StatsBundle } from "@/lib/website/stats";

export type LoadStatus = "loading" | "ready" | "error";

/** 한 화면이 받아 온 것 */
export type StatsData = {
  bundle: StatsBundle | null;
  status: LoadStatus;
};

/** 아직 안 걷힌 자리에 붙이는 한 줄 */
export const STATS_EMPTY_HINT = "사이트 공개 후 수집이 시작됩니다.";

export function ChartSlot({
  status,
  empty,
  height,
  hint = STATS_EMPTY_HINT,
  children
}: {
  status: LoadStatus;
  empty: boolean;
  height?: number;
  hint?: string;
  children: ReactNode;
}) {
  if (status === "loading") {
    return <StatsEmpty height={height} title="불러오는 중입니다" />;
  }
  if (status === "error") {
    return (
      <StatsEmpty height={height} title="불러오지 못했습니다" hint="잠시 뒤 다시 열어 주세요." />
    );
  }
  if (empty) {
    return <StatsEmpty height={height} hint={hint} />;
  }
  return <>{children}</>;
}

export function SectionHead({ title, stamp }: { title: string; stamp?: string }) {
  return (
    <div className="ws-sech">
      <h3>{title}</h3>
      {stamp ? <span className="ws-stamp">{stamp}</span> : null}
    </div>
  );
}
