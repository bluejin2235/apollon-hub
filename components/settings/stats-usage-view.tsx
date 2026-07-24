"use client";

import { useEffect, useMemo, useState } from "react";
import {
  downloadCsv,
  fetchStatsApi,
  SERVICE_STATS_LABELS
} from "@/lib/stats/stats-ui";

type UsageMember = {
  profile_id: string;
  name: string;
  department: string;
  pageviews: Record<string, number>;
  trendChat: number;
  total: number;
};

type UsageResponse = {
  services: string[];
  members: UsageMember[];
};

type Col =
  | { kind: "service"; service: string; label: string }
  | { kind: "trendChat"; label: string };

type Props = {
  start: string;
  end: string;
  registerExport: (fn: (() => void) | null) => void;
};

function buildColumns(services: string[]): Col[] {
  const cols: Col[] = [];
  let hasResearch = false;

  for (const service of services) {
    if (service === "research") {
      hasResearch = true;
      cols.push({
        kind: "service",
        service: "research",
        label: `${SERVICE_STATS_LABELS.research} 조회수`
      });
      cols.push({ kind: "trendChat", label: `${SERVICE_STATS_LABELS.research} 대화수` });
      continue;
    }
    cols.push({
      kind: "service",
      service,
      label: `${SERVICE_STATS_LABELS[service] ?? service} 조회수`
    });
  }

  if (!hasResearch) {
    cols.push({ kind: "trendChat", label: `${SERVICE_STATS_LABELS.research} 대화수` });
  }

  return cols;
}

function cellValue(member: UsageMember, col: Col): number {
  if (col.kind === "trendChat") return member.trendChat;
  return member.pageviews[col.service] ?? 0;
}

export function StatsUsageView({ start, end, registerExport }: Props) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const qs = new URLSearchParams({ start, end });
        const json = await fetchStatsApi<UsageResponse>(`/api/stats/usage?${qs}`);
        if (cancelled) return;
        setData(json);
      } catch (e) {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : "사용 통계를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const services = data?.services ?? [];
  const members = data?.members ?? [];
  const columns = useMemo(() => buildColumns(services), [services]);

  const totals = useMemo(() => {
    const byCol = columns.map((col) => members.reduce((sum, m) => sum + cellValue(m, col), 0));
    const total = members.reduce((sum, m) => sum + m.total, 0);
    return { byCol, total };
  }, [columns, members]);

  useEffect(() => {
    registerExport(() => {
      const header = ["이름", "부서", ...columns.map((c) => c.label), "합계"];
      const body = members.map((m) => [
        m.name,
        m.department,
        ...columns.map((c) => cellValue(m, c)),
        m.total
      ]);
      const footer = ["합계", "", ...totals.byCol, totals.total];
      downloadCsv(`사용통계_${start}_${end}.csv`, [header, ...body, footer]);
    });
    return () => registerExport(null);
  }, [members, columns, totals, start, end, registerExport]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">사용 통계를 불러오는 중…</p>;
  }

  if (error) {
    return (
      <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
        {error}
      </p>
    );
  }

  const colSpan = 3 + columns.length;

  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <th className="px-4 py-3">이름</th>
            <th className="px-4 py-3">부서</th>
            {columns.map((col) => (
              <th
                key={col.kind === "trendChat" ? "trendChat" : col.service}
                className={`px-4 py-3 text-right ${col.kind === "trendChat" ? "text-[#534AB7]" : ""}`}
              >
                {col.label}
              </th>
            ))}
            <th className="px-4 py-3 text-right">합계</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {members.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-500">
                해당 기간 사용 기록이 없습니다.
              </td>
            </tr>
          ) : (
            <>
              {members.map((m) => (
                <tr key={m.profile_id} className="text-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900">{m.name || "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{m.department || "-"}</td>
                  {columns.map((col) => {
                    const value = cellValue(m, col);
                    const key = col.kind === "trendChat" ? "trendChat" : col.service;
                    return (
                      <td
                        key={key}
                        className={`px-4 py-3 text-right tabular-nums ${
                          col.kind === "trendChat" ? "font-medium text-[#534AB7]" : ""
                        }`}
                      >
                        {value.toLocaleString("ko-KR")}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {m.total.toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-4 py-3" colSpan={2}>
                  합계
                </td>
                {columns.map((col, idx) => {
                  const key = col.kind === "trendChat" ? "trendChat" : col.service;
                  return (
                    <td
                      key={key}
                      className={`px-4 py-3 text-right tabular-nums ${
                        col.kind === "trendChat" ? "text-[#534AB7]" : ""
                      }`}
                    >
                      {totals.byCol[idx].toLocaleString("ko-KR")}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right tabular-nums">{totals.total.toLocaleString("ko-KR")}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </section>
  );
}
