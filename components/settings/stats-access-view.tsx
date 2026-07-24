"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  downloadCsv,
  fetchStatsApi,
  formatShortDate
} from "@/lib/stats/stats-ui";

type AccessMember = {
  profile_id: string;
  name: string;
  department: string;
  pc: number;
  mobile: number;
  total: number;
};

type AccessResponse = {
  daily: Array<{ date: string; count: number }>;
  members: AccessMember[];
};

type Props = {
  start: string;
  end: string;
  registerExport: (fn: (() => void) | null) => void;
};

export function StatsAccessView({ start, end, registerExport }: Props) {
  const [data, setData] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const qs = new URLSearchParams({ start, end });
        const json = await fetchStatsApi<AccessResponse>(`/api/stats/access?${qs}`);
        if (cancelled) return;
        setData(json);
      } catch (e) {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : "접속 통계를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const chartData = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        date: d.date,
        label: formatShortDate(d.date),
        count: d.count
      })),
    [data]
  );

  const members = data?.members ?? [];
  const hasAnyCount = chartData.some((d) => d.count > 0);

  useEffect(() => {
    registerExport(() => {
      const rows: Array<Array<string | number>> = [
        ["이름", "부서", "PC 접속", "모바일 접속", "총 접속수"],
        ...members.map((m) => [m.name, m.department, m.pc, m.mobile, m.total])
      ];
      downloadCsv(`접속통계_${start}_${end}.csv`, rows);
    });
    return () => registerExport(null);
  }, [members, start, end, registerExport]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">접속 통계를 불러오는 중…</p>;
  }

  if (error) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">일별 접속수</h3>
          <p className="text-xs text-slate-500">
            {start} ~ {end}
          </p>
        </div>
        <div className="h-[280px] w-full">
          {!hasAnyCount ? (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">
              해당 기간 접속 기록이 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} width={36} />
                <Tooltip
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as { date?: string } | undefined;
                    return row?.date ?? "";
                  }}
                  formatter={(value) => [Number(value).toLocaleString("ko-KR"), "접속수"]}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#534AB7"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#534AB7", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">부서</th>
              <th className="px-4 py-3 text-right">PC 접속</th>
              <th className="px-4 py-3 text-right">모바일 접속</th>
              <th className="px-4 py-3 text-right">총 접속수</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  해당 기간 접속 멤버가 없습니다.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.profile_id} className="text-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900">{m.name || "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{m.department || "-"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.pc.toLocaleString("ko-KR")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.mobile.toLocaleString("ko-KR")}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {m.total.toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
