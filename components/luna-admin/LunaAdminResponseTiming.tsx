"use client";

import type { ResponseTimingDashboardView } from "@/lib/luna-admin/types";

function formatSec(ms: number): string {
  if (!ms) return "0초";
  const s = ms / 1000;
  if (s >= 10) return `${s.toFixed(1)}초`;
  if (s >= 1) return `${s.toFixed(1)}초`;
  return `${Math.round(ms)}ms`;
}

function sparkBars(data: ResponseTimingDashboardView): string {
  const vals = data.sparkline.map((d) => d.avg_total_ms);
  const max = Math.max(...vals, 1);
  const glyphs = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return vals
    .map((v) => {
      if (v <= 0) return "▁";
      const idx = Math.min(
        glyphs.length - 1,
        Math.max(0, Math.round((v / max) * (glyphs.length - 1)))
      );
      return glyphs[idx]!;
    })
    .join("");
}

type Props = {
  data: ResponseTimingDashboardView;
};

export function LunaAdminResponseTiming({ data }: Props) {
  const warnDot =
    data.warn_level === "bad" ? "🔴" : data.warn_level === "warn" ? "🟡" : "🟢";
  const empty = data.sample_count === 0;

  return (
    <div
      className={`rtim ${data.warn_level === "bad" ? "bad" : data.warn_level === "warn" ? "warn" : ""}`}
    >
      <div className="sh">
        <span className="t">응답 시간</span>
        <span className="n">{warnDot} 7일 평균</span>
        <span className="sp" />
        <span className="n">
          {empty ? "측정 전" : `n=${data.sample_count}`}
        </span>
      </div>
      {empty ? (
        <p className="empty">아직 기록이 없습니다. 답변이 쌓이면 여기에 뜹니다.</p>
      ) : (
        <div className="body">
          <div className="big">{formatSec(data.avg_total_ms)}</div>
          <div className="stages">
            검색 {formatSec(data.avg_search_ms)} · 연결{" "}
            {formatSec(data.avg_link_ms)} · LLM {formatSec(data.avg_llm_ms)}
          </div>
          <div className="spark" title="최근 7일 일평균">
            <span className="bars">{sparkBars(data)}</span>
            <span className="lab">최근 7일</span>
          </div>
        </div>
      )}
    </div>
  );
}
