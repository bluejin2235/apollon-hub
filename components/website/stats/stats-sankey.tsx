"use client";

/**
 * 유입 경로 → 처음 본 페이지. recharts Sankey.
 * 목업의 SVG 산키와 달리 두 칸만 — 그다음 페이지는 GA4 가 주지 않는다.
 */

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";

import { STATS_LINE, STATS_TEXT } from "@/components/website/stats/stats-chart";

export type SankeyModel = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

const DEFAULT_HEIGHT = 340;

export function StatsSankey({
  data,
  height = DEFAULT_HEIGHT,
  className
}: {
  data: SankeyModel;
  height?: number;
  className?: string;
}) {
  return (
    <div className={className ? `ws-chart ${className}` : "ws-chart"} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <Sankey
          data={data}
          nodePadding={24}
          nodeWidth={10}
          linkCurvature={0.45}
          margin={{ top: 28, right: 16, bottom: 8, left: 16 }}
          node={{
            stroke: "#fff",
            strokeWidth: 1,
            fill: "#2a3340"
          }}
          link={{
            stroke: "#8fb6e0",
            strokeOpacity: 0.42
          }}
        >
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: `1px solid ${STATS_LINE}`,
              padding: "6px 10px"
            }}
            labelStyle={{ fontSize: 11, color: STATS_TEXT }}
            formatter={(value) =>
              typeof value === "number" ? `${Math.round(value).toLocaleString("ko-KR")} 세션` : String(value)
            }
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
