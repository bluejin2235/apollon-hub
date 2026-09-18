"use client";

import type { ReactNode } from "react";
import type { PeriodKey } from "@/lib/luna-admin/period";

const PRESETS: Array<{ id: PeriodKey; label: string }> = [
  { id: "today", label: "오늘" },
  { id: "yesterday", label: "어제" },
  { id: "7", label: "7일" },
  { id: "30", label: "30일" },
  { id: "all", label: "전체" }
];

type Props = {
  period: PeriodKey;
  from: string;
  to: string;
  total?: number;
  extra?: ReactNode;
  onPeriod: (key: PeriodKey) => void;
  onRange: (from: string, to: string) => void;
};

export function PeriodBar({ period, from, to, total, extra, onPeriod, onRange }: Props) {
  return (
    <div className="period">
      <span className="l">언제 색인된 것</span>
      <div className="chips">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={period === p.id ? "on" : ""}
            onClick={() => onPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        className="date"
        value={from}
        onChange={(e) => onRange(e.target.value, to || e.target.value)}
      />
      <span className="mut">~</span>
      <input
        type="date"
        className="date"
        value={to}
        onChange={(e) => onRange(from || e.target.value, e.target.value)}
      />
      <span className="sp" />
      {total != null ? (
        <span className="cnt">
          그 기간에 <b>{total.toLocaleString("ko-KR")}</b>건
        </span>
      ) : null}
      {extra}
    </div>
  );
}
