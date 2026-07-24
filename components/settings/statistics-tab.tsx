"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { StatsAccessView } from "@/components/settings/stats-access-view";
import { StatsUsageView } from "@/components/settings/stats-usage-view";
import {
  resolveStatsPeriod,
  toKstDateString,
  type StatsPeriodPreset
} from "@/lib/stats/stats-ui";

type SubTab = "access" | "usage";

const PERIOD_OPTIONS: Array<{ value: StatsPeriodPreset; label: string }> = [
  { value: "last_7", label: "최근 7일" },
  { value: "last_30", label: "최근 30일" },
  { value: "custom", label: "직접 선택" }
];

export function StatisticsTab({ canManage }: { canManage: boolean }) {
  const today = useMemo(() => toKstDateString(), []);
  const [subTab, setSubTab] = useState<SubTab>("access");
  const [period, setPeriod] = useState<StatsPeriodPreset>("last_30");
  const [customStart, setCustomStart] = useState(() => {
    const end = toKstDateString();
    const [y, m, d] = end.split("-").map(Number);
    const utc = Date.UTC(y, m - 1, d) - 29 * 24 * 60 * 60 * 1000;
    const dt = new Date(utc);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  });
  const [customEnd, setCustomEnd] = useState(today);

  const exportFnRef = useRef<(() => void) | null>(null);
  const registerExport = useCallback((fn: (() => void) | null) => {
    exportFnRef.current = fn;
  }, []);

  const range = useMemo(
    () => resolveStatsPeriod(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  if (!canManage) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        통계는 슈퍼관리자만 접근할 수 있습니다.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <nav className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {(
            [
              { key: "access" as const, label: "접속 통계" },
              { key: "usage" as const, label: "사용 통계" }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubTab(tab.key)}
              className={`rounded-lg px-4 py-2 text-sm transition ${
                subTab === tab.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPeriod(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  period === opt.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => exportFnRef.current?.()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:border-apollon-400 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            엑셀 다운로드
          </button>
        </div>
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            시작
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
          <span className="text-slate-400">~</span>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            종료
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={today}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
            />
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          조회 기간: {range.start} ~ {range.end}
        </p>
      )}

      {subTab === "access" ? (
        <StatsAccessView start={range.start} end={range.end} registerExport={registerExport} />
      ) : (
        <StatsUsageView start={range.start} end={range.end} registerExport={registerExport} />
      )}
    </div>
  );
}
