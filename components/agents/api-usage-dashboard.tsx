"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  aggregateUsageDashboard,
  formatProviderUploadMeta,
  formatUsd,
  resolveUsageDateRange,
  type ApiUsageDbRow,
  type ApiUsageProvider,
  type ModelCostRow,
  type ProviderFilter,
  type ProviderUploadMeta,
  type UsagePeriodPreset
} from "@/lib/arte/api-usage";
import { formatKrw, useUsdKrwForUsage } from "@/lib/arte/usd-krw-rate";
import { ApiUsageUpload } from "@/components/agents/api-usage-upload";
import { supabase } from "@/lib/supabase/client";

const PERIOD_OPTIONS: { value: UsagePeriodPreset; label: string }[] = [
  { value: "last_30days", label: "최근 1달" },
  { value: "this_month", label: "이번 달" },
  { value: "last_month", label: "지난 달" },
  { value: "last_3m", label: "최근 3개월" },
  { value: "custom", label: "직접 선택" }
];

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" }
];

type SortKey =
  | "model"
  | "date"
  | "provider"
  | "api_key_label"
  | "input_cost_usd"
  | "output_cost_usd"
  | "cost_usd"
  | "share_pct"
  | null;
type SortDir = "asc" | "desc";
type ActiveSortKey = Exclude<SortKey, null>;

function formatProviderLabel(provider: ApiUsageProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function formatModelUsageDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y.slice(2)}/${m}/${d}`;
}

function SortableTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className = ""
}: {
  label: string;
  column: ActiveSortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: ActiveSortKey) => void;
  className?: string;
}) {
  const alignEnd = className.includes("text-right");
  return (
    <th
      className={`cursor-pointer select-none px-5 py-3 ${className}`}
      onClick={() => onSort(column)}
    >
      <span className={`inline-flex items-center gap-1 ${alignEnd ? "w-full justify-end" : ""}`}>
        {label}
        {sortKey === column ? (
          <span>{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span className="text-slate-300">↕</span>
        )}
      </span>
    </th>
  );
}

type UploadMetaRow = {
  provider: string;
  created_at: string;
  uploaded_by: string;
};

async function fetchUploadMeta(): Promise<ProviderUploadMeta[]> {
  const empty = (provider: ApiUsageProvider): ProviderUploadMeta => ({
    provider,
    created_at: null,
    uploader_name: null,
    data_start: null,
    data_end: null
  });

  const [metaRes, dateRes] = await Promise.all([
    supabase
      .from("api_usage")
      .select("provider, created_at, uploaded_by")
      .not("uploaded_by", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("api_usage").select("provider, date")
  ]);

  const { data: metaData, error: metaError } = metaRes;

  if (metaError) {
    console.error("[api_usage] upload meta", metaError);
    return [empty("openai"), empty("anthropic")];
  }

  const openaiRow = metaData?.find((r) => r.provider === "openai") as UploadMetaRow | undefined;
  const anthropicRow = metaData?.find((r) => r.provider === "anthropic") as UploadMetaRow | undefined;

  const uploaderIds = [openaiRow?.uploaded_by, anthropicRow?.uploaded_by].filter(
    (id): id is string => Boolean(id)
  );

  let nameMap: Record<string, string | null> = {};
  if (uploaderIds.length > 0) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", uploaderIds);

    if (profilesError) {
      console.error("[api_usage] profiles", profilesError);
    } else {
      nameMap = Object.fromEntries(
        (profilesData ?? []).map((p) => [p.id, p.name?.trim() || null])
      );
    }
  }

  const dateRangeByProvider: Record<string, { min: string; max: string }> = {};
  if (!dateRes.error) {
    for (const row of dateRes.data ?? []) {
      const p = row.provider as string;
      const d = row.date as string;
      const prev = dateRangeByProvider[p];
      if (!prev) dateRangeByProvider[p] = { min: d, max: d };
      else {
        if (d < prev.min) prev.min = d;
        if (d > prev.max) prev.max = d;
      }
    }
  }

  const toMeta = (provider: ApiUsageProvider, row?: UploadMetaRow): ProviderUploadMeta => {
    if (!row) return empty(provider);
    const range = dateRangeByProvider[provider];
    return {
      provider,
      created_at: row.created_at,
      uploader_name: nameMap[row.uploaded_by] ?? null,
      data_start: range?.min ?? null,
      data_end: range?.max ?? null
    };
  };

  return [toMeta("openai", openaiRow), toMeta("anthropic", anthropicRow)];
}

export function ApiUsageDashboard() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<UsagePeriodPreset>("last_30days");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [rows, setRows] = useState<ApiUsageDbRow[]>([]);
  const [uploadMeta, setUploadMeta] = useState<ProviderUploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const { usdKrw, monthLabel } = useUsdKrwForUsage();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
        .single();
      if (cancelled) return;
      setIsSuperAdmin(profileData?.role === "슈퍼관리자");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const range = useMemo(
    () => resolveUsageDateRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let q = supabase
      .from("api_usage")
      .select("*")
      .gte("date", range.start)
      .lte("date", range.end)
      .order("date", { ascending: true });

    if (providerFilter !== "all") {
      q = q.eq("provider", providerFilter);
    }

    const [usageRes, meta] = await Promise.all([q, fetchUploadMeta()]);

    setLoading(false);

    if (usageRes.error) {
      console.error("[api_usage]", usageRes.error);
      setError(usageRes.error.message);
      setRows([]);
      return;
    }

    setRows((usageRes.data ?? []) as ApiUsageDbRow[]);
    setUploadMeta(meta);
  }, [range.start, range.end, providerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const agg = useMemo(
    () => aggregateUsageDashboard(rows, range),
    [rows, range.start, range.end]
  );

  const handleSort = (key: ActiveSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedByModel = useMemo(() => {
    if (!sortKey) return agg.byModel;
    return [...agg.byModel].sort((a, b) => {
      let cmp: number;
      if (sortKey === "input_cost_usd" || sortKey === "output_cost_usd" || sortKey === "cost_usd" || sortKey === "share_pct") {
        cmp = a[sortKey] - b[sortKey];
      } else if (sortKey === "provider") {
        cmp = a.provider.localeCompare(b.provider, "ko", { sensitivity: "base" });
      } else if (sortKey === "model") {
        cmp = a.model.localeCompare(b.model, "ko", { sensitivity: "base" });
      } else if (sortKey === "date") {
        cmp = a.date.localeCompare(b.date);
      } else if (sortKey === "api_key_label") {
        cmp = a.api_key_label.localeCompare(b.api_key_label, "ko", { sensitivity: "base" });
      } else {
        cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [agg.byModel, sortKey, sortDir]);

  const handleDelete = async (row: ModelCostRow) => {
    if (!window.confirm("이 항목을 삭제하시겠습니까?")) return;
    const { error } = await supabase
      .from("api_usage")
      .delete()
      .eq("date", row.date)
      .eq("provider", row.provider)
      .eq("model", row.model);
    if (error) {
      console.error(error);
      return;
    }
    void load();
  };

  const periodLabel =
    agg.date_min && agg.date_max
      ? agg.date_min === agg.date_max
        ? agg.date_min
        : `${agg.date_min} ~ ${agg.date_max}`
      : "—";

  const totalKrw = agg.total_cost_usd * usdKrw;
  const openaiMeta = uploadMeta.find((m) => m.provider === "openai");
  const anthropicMeta = uploadMeta.find((m) => m.provider === "anthropic");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">조회 기간</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPeriod(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    period === opt.value
                      ? "bg-violet-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {period === "custom" ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  시작
                  <input
                    type="date"
                    value={customStart}
                    max={customEnd}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  종료
                  <input
                    type="date"
                    value={customEnd}
                    min={customStart}
                    max={todayIso}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                {range.start} ~ {range.end}
              </p>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-slate-500">출처</p>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProviderFilter(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    providerFilter === opt.value
                      ? "bg-slate-800 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
          <span className="mt-1 block text-xs text-rose-600">
            api_usage 테이블·RLS·마이그레이션 SQL 적용 여부를 확인해 주세요.
          </span>
        </p>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">불러오는 중…</p> : null}

      {!loading && !error ? (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">총 비용</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatKrw(totalKrw)}</p>
              <p className="mt-1 text-sm tabular-nums text-slate-400">{formatUsd(agg.total_cost_usd)}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                환율 기준: 1$ = {usdKrw.toLocaleString("ko-KR")}원 ({monthLabel})
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">총 API 호출 횟수</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                {agg.total_requests != null ? agg.total_requests.toLocaleString("ko-KR") + "회" : "—"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                호출당 평균{" "}
                {agg.total_requests && agg.total_requests > 0
                  ? formatKrw(totalKrw / agg.total_requests)
                  : "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">업로드된 데이터 기간</p>
              <p className="mt-2 text-lg font-bold text-slate-900">{periodLabel}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">일별 비용</h2>
            <div className="mt-2 mb-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">적용된 데이터 기간</span>
              {anthropicMeta?.created_at && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                  Anthropic&nbsp;
                  {anthropicMeta.data_start && anthropicMeta.data_end
                    ? `${anthropicMeta.data_start} ~ ${anthropicMeta.data_end}`
                    : periodLabel}
                </span>
              )}
              {openaiMeta?.created_at && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  OpenAI&nbsp;
                  {openaiMeta.data_start && openaiMeta.data_end
                    ? `${openaiMeta.data_start} ~ ${openaiMeta.data_end}`
                    : periodLabel}
                </span>
              )}
            </div>
            <div className="mt-4 h-[320px] w-full">
              {agg.daily.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  해당 기간 데이터가 없습니다. 데이터 업로드 탭에서 CSV를 등록해 주세요.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agg.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) =>
                        typeof v === "number" ? `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}` : String(v)
                      }
                    />
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const dataKey = String(item?.dataKey ?? "");
                        const label =
                          dataKey === "anthropic"
                            ? "Anthropic"
                            : dataKey === "openai"
                              ? "OpenAI"
                              : String(_name);
                        return [
                          formatUsd(typeof value === "number" ? value : Number(value)),
                          label
                        ];
                      }}
                    />
                    <Legend />
                    <Bar dataKey="anthropic" name="Anthropic" stackId="cost" fill="#7c3aed" />
                    <Bar dataKey="openai" name="OpenAI" stackId="cost" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">API별 상세 사용량</h2>
            </div>
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <SortableTh
                    label="모델명"
                    column="model"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="사용일"
                    column="date"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="Provider"
                    column="provider"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="API 키"
                    column="api_key_label"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="Input 비용"
                    column="input_cost_usd"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  <SortableTh
                    label="Output 비용"
                    column="output_cost_usd"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  <SortableTh
                    label="합계"
                    column="cost_usd"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  <SortableTh
                    label="비중"
                    column="share_pct"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  {isSuperAdmin ? <th className="px-5 py-3 text-center">삭제</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedByModel.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 9 : 8} className="px-5 py-10 text-center text-slate-500">
                      모델별 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  sortedByModel.map((row) => (
                    <tr key={`${row.provider}-${row.model}-${row.api_key_label}`}>
                      <td className="max-w-[200px] truncate px-5 py-3 font-medium" title={row.model}>
                        {row.model}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-600" title={row.date}>
                        {formatModelUsageDate(row.date)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{formatProviderLabel(row.provider)}</td>
                      <td className="px-5 py-3 text-slate-600">{row.api_key_label || "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatUsd(row.input_cost_usd)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatUsd(row.output_cost_usd)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-violet-700">
                        {formatUsd(row.cost_usd)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                        {row.share_pct.toFixed(1)}%
                      </td>
                      {isSuperAdmin ? (
                        <td className="px-5 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            className="text-sm text-rose-500 hover:text-rose-700"
                          >
                            삭제
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl bg-slate-100 px-5 py-4 text-sm text-slate-700">
            <p>
              API 사용량 데이터는 실시간 데이터가 아니라 수동(CSV) 업데이트입니다. 가장 최근 업데이트 날짜는
              아래와 같습니다.
            </p>
            <ul className="mt-3 space-y-2 text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">OpenAI:</span>{" "}
                {openaiMeta ? formatProviderUploadMeta(openaiMeta) : "업데이트 기록 없음"}
              </li>
              <li>
                <span className="font-semibold text-slate-800">Anthropic:</span>{" "}
                {anthropicMeta ? formatProviderUploadMeta(anthropicMeta) : "업데이트 기록 없음"}
              </li>
            </ul>
          </section>
        </>
      ) : null}

      {isSuperAdmin ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">CSV 업로드</h2>
          <ApiUsageUpload onSaved={() => void load()} />
        </section>
      ) : null}
    </div>
  );
}
