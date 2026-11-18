"use client";

/**
 * 조치 기록 화면만. 요약·콘텐츠·검색·AI·방문 패턴은 stats-v3(V3Shell)이 /website/stats/... 에 그린다.
 */

import { useMemo } from "react";

import { ActionsScreen } from "@/components/website/stats/actions-screen";
import {
  StatsActionsContext,
  useStatsActionsLoader
} from "@/components/website/stats/stats-actions";
import { STATS_SCREENS } from "@/lib/website/stats";
import "./stats.css";

function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function WebsiteStatsActions() {
  const today = useMemo(() => seoulToday(), []);
  const actions = useStatsActionsLoader(today, null, null);
  const screen = STATS_SCREENS.find((item) => item.id === "actions");

  return (
    <div className="ws">
      <div className="ws-main">
        <StatsActionsContext.Provider value={actions}>
          <div className="ws-body">
            <section className="ws-screen">
              <h2 className="ws-pt">{screen?.label ?? "조치 기록"}</h2>
              <p className="ws-lede">{screen?.lede}</p>
              <ActionsScreen today={today} />
            </section>
          </div>
        </StatsActionsContext.Provider>
      </div>
    </div>
  );
}
