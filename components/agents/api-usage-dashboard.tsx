"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
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
import { formatKrw } from "@/lib/arte/usd-krw-rate";
import { supabase } from "@/lib/supabase/client";

const PERIOD_OPTIONS: { value: UsagePeriodPreset; label: string }[] = [
  { value: "last_30days", label: "최근 1달" },
  { value: "last_3m", label: "최근 3개월" },
  { value: "last_6m", label: "최근 6개월" },
  { value: "last_1y", label: "최근 1년" },
  { value: "custom", label: "직접 선택" }
];

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" }
];

const DONUT_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#4a3aa7",
  "#008300",
  "#e34948"
];

type SortKey =
  | "model"
  | "date"
  | "provider"
  | "api_key_label"
  | "num_requests"
  | "cost_usd"
  | "cost_krw"
  | null;
type SortDir = "asc" | "desc";
type ActiveSortKey = Exclude<SortKey, null>;

type ShareSlice = { name: string; value: number; pct: number };

function formatRequestCount(row: Pick<ModelCostRow, "provider" | "num_requests">): string {
  if (row.provider === "anthropic") return "-";
  if (row.provider === "openai" && row.num_requests != null && row.num_requests > 0) {
    return row.num_requests.toLocaleString("ko-KR");
  }
  return "-";
}

function formatProviderLabel(provider: ApiUsageProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

function formatModelUsageDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

function formatYAxisKrw(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v) >= 1_000_000) return `₩${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `₩${Math.round(v / 1_000)}k`;
  return `₩${Math.round(v)}`;
}

function buildShareSlices(
  entries: { name: string; value: number }[],
  maxItems = 6
): ShareSlice[] {
  const sorted = [...entries]
    .filter((e) => e.value > 0 && e.name.trim())
    .sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return [];

  const capped =
    sorted.length <= maxItems
      ? sorted
      : [
          ...sorted.slice(0, maxItems),
          {
            name: "기타",
            value: sorted.slice(maxItems).reduce((s, e) => s + e.value, 0)
          }
        ];

  const total = capped.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return [];

  return capped.map((e) => ({
    name: e.name,
    value: e.value,
    pct: Math.round((e.value / total) * 100)
  }));
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

export function ApiUsageDashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState<UsagePeriodPreset>("last_6m");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(todayIso);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [rows, setRows] = useState<ApiUsageDbRow[]>([]);
  const [uploadMeta, setUploadMeta] = useState<ProviderUploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

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
  }, [load, refreshKey]);

  const agg = useMemo(
    () => aggregateUsageDashboard(rows, range),
    [rows, range.start, range.end]
  );

  const handleSort = (key: ActiveSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" || key === "cost_usd" || key === "cost_krw" ? "desc" : "asc");
    }
  };

  const sortedByModel = useMemo(() => {
    if (!sortKey) return agg.byModel;
    return [...agg.byModel].sort((a, b) => {
      let cmp: number;
      if (sortKey === "num_requests") {
        cmp = (a.num_requests ?? -1) - (b.num_requests ?? -1);
      } else if (sortKey === "cost_usd") {
        cmp = a.cost_usd - b.cost_usd;
      } else if (sortKey === "cost_krw") {
        cmp = a.cost_krw - b.cost_krw;
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
      .eq("model", row.model)
      .eq("api_key_label", row.api_key_label);
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

  const openaiMeta = uploadMeta.find((m) => m.provider === "openai");
  const anthropicMeta = uploadMeta.find((m) => m.provider === "anthropic");

  const dailyKrwChart = useMemo(
    () =>
      agg.daily.map((d) => ({
        date: d.date,
        label: d.label,
        anthropic: d.anthropic,
        openai: d.openai,
        total: d.total
      })),
    [agg.daily]
  );

  const modelShare = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of agg.byModel) {
      map.set(row.model, (map.get(row.model) ?? 0) + row.cost_krw);
    }
    return buildShareSlices(
      [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value) }))
    );
  }, [agg.byModel]);

  const apiKeyShare = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of agg.byModel) {
      const key = row.api_key_label?.trim() || "—";
      map.set(key, (map.get(key) ?? 0) + row.cost_krw);
    }
    return buildShareSlices(
      [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value) }))
    );
  }, [agg.byModel]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
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
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">일별 비용 (원)</h2>
            <div className="mt-4 h-[320px] w-full">
              {dailyKrwChart.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  해당 기간 데이터가 없습니다. CSV를 등록해 주세요.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyKrwChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatYAxisKrw(Number(v))} />
                    <Tooltip
                      labelFormatter={(label) => String(label)}
                      formatter={(value, _name, item) => {
                        const dataKey = String(item?.dataKey ?? "");
                        const label =
                          dataKey === "anthropic"
                            ? "Anthropic"
                            : dataKey === "openai"
                              ? "OpenAI"
                              : String(_name);
                        return [formatKrw(typeof value === "number" ? value : Number(value)), label];
                      }}
                    />
                    <Legend />
                    <Bar dataKey="anthropic" name="Anthropic" stackId="cost" fill="#534AB7" />
                    <Bar dataKey="openai" name="OpenAI" stackId="cost" fill="#1D9E75" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CostShareDonut title="모델별 비용 비중" slices={modelShare} />
            <CostShareDonut title="API키별 비용 비중" slices={apiKeyShare} />
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">API별 상세 사용량</h2>
            </div>
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
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
                    label="모델"
                    column="model"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="API키"
                    column="api_key_label"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTh
                    label="호출수"
                    column="num_requests"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  <SortableTh
                    label="비용(USD)"
                    column="cost_usd"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  />
                  <SortableTh
                    label="비용(KRW)"
                    column="cost_krw"
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
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-5 py-10 text-center text-slate-500">
                      모델별 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  sortedByModel.map((row) => {
                    return (
                      <tr key={`${row.provider}-${row.model}-${row.api_key_label}-${row.date}`}>
                        <td className="whitespace-nowrap px-5 py-3 tabular-nums text-slate-600" title={row.date}>
                          {formatModelUsageDate(row.date)}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{formatProviderLabel(row.provider)}</td>
                        <td className="max-w-[200px] truncate px-5 py-3 font-medium" title={row.model}>
                          {row.model}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{row.api_key_label || "—"}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {formatRequestCount(row)}
                        </td>
                        <td
                          className="px-5 py-3 text-right tabular-nums text-slate-700"
                          title="실제 청구 금액 (할인/크레딧 적용 후)"
                        >
                          {formatUsd(row.cost_usd)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums font-medium text-violet-700">
                          {formatKrw(row.cost_krw)}
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
                    );
                  })
                )}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              비용(USD): 실제 청구 금액 (할인/크레딧 적용 후)
            </p>
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
            {periodLabel !== "—" ? (
              <p className="mt-2 text-xs text-slate-500">업로드된 데이터 기간: {periodLabel}</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CostShareDonut({ title, slices }: { title: string; slices: ShareSlice[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {slices.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">표시할 데이터가 없습니다.</p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="h-[200px] w-full max-w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {slices.map((slice, idx) => (
                    <Cell key={slice.name} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    formatKrw(typeof value === "number" ? value : Number(value)),
                    String(name)
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-2 text-sm">
            {slices.map((slice, idx) => (
              <li key={slice.name} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-slate-700">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: DONUT_COLORS[idx % DONUT_COLORS.length] }}
                  />
                  <span className="truncate" title={slice.name}>
                    {slice.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">{slice.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
