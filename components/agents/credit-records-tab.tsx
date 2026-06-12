"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { resolveUsageDateRange, type UsagePeriodPreset } from "@/lib/arte/api-usage";
import { supabase } from "@/lib/supabase/client";
import { CreditRegisterModal } from "@/components/agents/credit-register-modal";

type CreditRecord = {
  id: string;
  service_name: string;
  payment_type: string;
  amount_krw: number;
  paid_at: string;
  memo: string | null;
  image_path: string | null;
  registered_by: string | null;
  created_at: string;
  registrar_name?: string | null;
};

type PeriodPreset = UsagePeriodPreset;

type CreditSortKey = "service_name" | "payment_type" | "paid_at" | "registrar_name" | "amount_krw" | null;
type CreditSortDir = "asc" | "desc";
type ActiveCreditSortKey = Exclude<CreditSortKey, null>;

function getMonthKeysInRange(start: string, end: string): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    keys.push({ key, label: `${m}월` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
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
  column: ActiveCreditSortKey;
  sortKey: CreditSortKey;
  sortDir: CreditSortDir;
  onSort: (key: ActiveCreditSortKey) => void;
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

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "last_30days", label: "최근 1달" },
  { value: "last_3m", label: "최근 3개월" },
  { value: "last_6m", label: "최근 6개월" },
  { value: "last_1y", label: "최근 1년" },
  { value: "custom", label: "직접 선택" }
];

export function CreditRecordsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<PeriodPreset>("last_6m");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(today);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CreditSortKey>(null);
  const [sortDir, setSortDir] = useState<CreditSortDir>("asc");
  const [records, setRecords] = useState<CreditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const range = resolveUsageDateRange(period, customStart, customEnd);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, role")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setCurrentUserName(profile?.name?.trim() || null);
      setIsSuperAdmin(profile?.role === "슈퍼관리자");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("credit_records")
      .select("*, registrar:profiles!registered_by(name)")
      .gte("paid_at", range.start)
      .lte("paid_at", range.end)
      .order("paid_at", { ascending: false });
    setLoading(false);
    if (error) { console.error(error); return; }
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as CreditRecord),
      registrar_name: (r.registrar as { name?: string } | null)?.name ?? null
    }));
    setRecords(rows);
  }, [range.start, range.end]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("이 내역을 삭제하시겠습니까?")) return;
    const { error } = await supabase.from("credit_records").delete().eq("id", id);
    if (error) {
      console.error(error);
      return;
    }
    void load();
  };

  const services = ["all", ...Array.from(new Set(records.map((r) => r.service_name)))];
  const filtered = serviceFilter === "all" ? records : records.filter((r) => r.service_name === serviceFilter);
  const totalKrw = filtered.reduce((s, r) => s + r.amount_krw, 0);

  const byService = Array.from(
    filtered.reduce((map, r) => {
      map.set(r.service_name, (map.get(r.service_name) ?? 0) + r.amount_krw);
      return map;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

  const monthlyChartData = useMemo(() => {
    const months = getMonthKeysInRange(range.start, range.end);
    const byMonth = new Map(months.map((m) => [m.key, 0]));
    for (const r of filtered) {
      const key = r.paid_at.slice(0, 7);
      if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + r.amount_krw);
    }
    return months.map(({ key, label }) => ({
      label,
      amount: byMonth.get(key) ?? 0
    }));
  }, [filtered, range.start, range.end]);

  const handleSort = (key: ActiveCreditSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedRecords = useMemo(() => {
    const base = [...filtered];
    if (!sortKey) {
      return base.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
    }
    return base.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "amount_krw") {
        cmp = a.amount_krw - b.amount_krw;
      } else if (sortKey === "paid_at") {
        cmp = a.paid_at.localeCompare(b.paid_at);
      } else if (sortKey === "service_name") {
        cmp = a.service_name.localeCompare(b.service_name, "ko", { sensitivity: "base" });
      } else if (sortKey === "payment_type") {
        cmp = a.payment_type.localeCompare(b.payment_type, "ko", { sensitivity: "base" });
      } else {
        const an = a.registrar_name ?? currentUserName ?? "";
        const bn = b.registrar_name ?? currentUserName ?? "";
        cmp = an.localeCompare(bn, "ko", { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, currentUserName]);

  const paymentTypeLabel = (t: string) => {
    if (t === "크레딧") return { text: "크레딧", bg: "bg-emerald-50", color: "text-emerald-700" };
    if (t === "초과결제") return { text: "초과", bg: "bg-amber-50", color: "text-amber-700" };
    return { text: t, bg: "bg-slate-100", color: "text-slate-600" };
  };

  return (
    <div className="space-y-6">
      {/* 기간 필터 */}
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
            {period === "custom" && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  시작
                  <input type="date" value={customStart} max={customEnd}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  종료
                  <input type="date" value={customEnd} min={customStart} max={today}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
              </div>
            )}
            {period !== "custom" && (
              <p className="mt-2 text-xs text-slate-500">{range.start} ~ {range.end}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            + 충전 등록
          </button>
        </div>
      </section>

      {/* KPI 카드 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">기간 내 총 충전 비용</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {totalKrw.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
          </p>
          <p className="mt-1 text-xs text-slate-500">{filtered.length}건 등록</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">크레딧 구매</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {filtered.filter(r => r.payment_type === "크레딧")
              .reduce((s, r) => s + r.amount_krw, 0)
              .toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">구독 초과 결제</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {filtered.filter(r => r.payment_type === "초과결제")
              .reduce((s, r) => s + r.amount_krw, 0)
              .toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
          </p>
        </div>
      </section>

      {/* 월별 충전 비용 */}
      {!loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">월별 충전 비용</h2>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    typeof v === "number"
                      ? `₩${v >= 10000 ? `${Math.round(v / 10000)}만` : v.toLocaleString("ko-KR")}`
                      : String(v)
                  }
                />
                <Tooltip
                  formatter={(value, _name, item) => {
                    const label = String((item?.payload as { label?: string })?.label ?? "");
                    const amount = Number(value);
                    return [
                      `${label}: ${amount.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}`
                    ];
                  }}
                  labelFormatter={() => ""}
                />
                <Bar dataKey="amount" fill="#EF9F27" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {/* 서비스별 집계 */}
      {byService.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">서비스별 집계</h2>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              {services.map((s) => (
                <option key={s} value={s}>{s === "all" ? "전체 서비스" : s}</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-slate-100">
            {byService.map(([name, amount]) => (
              <div key={name} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-slate-800">{name}</span>
                <span className="font-medium tabular-nums">
                  {amount.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 결제 내역 */}
      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">결제 내역</h2>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">불러오는 중…</p>
        ) : sortedRecords.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            등록된 내역이 없습니다. 충전 등록 버튼으로 추가해 주세요.
          </p>
        ) : (
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <SortableTh
                  label="서비스 · 메모"
                  column="service_name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="유형"
                  column="payment_type"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="날짜"
                  column="paid_at"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="등록자"
                  column="registrar_name"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <th className="px-5 py-3 text-center">영수증</th>
                <SortableTh
                  label="금액"
                  column="amount_krw"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                />
                {isSuperAdmin ? <th className="px-5 py-3 text-center">관리</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRecords.map((r) => {
                const tag = paymentTypeLabel(r.payment_type);
                return (
                  <tr key={r.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{r.service_name}</p>
                      {r.memo && <p className="text-xs text-slate-500">{r.memo}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag.bg} ${tag.color}`}>
                        {tag.text}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{r.paid_at}</td>
                    <td className="px-5 py-3 text-slate-600">{r.registrar_name ?? currentUserName ?? "—"}</td>
                    <td className="px-5 py-3 text-center">
                      {r.image_path ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const { data } = await supabase.storage
                              .from("credit-images")
                              .createSignedUrl(r.image_path!, 60);
                            if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                          }}
                          className="text-violet-600 hover:underline"
                        >
                          보기
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-slate-900">
                      {r.amount_krw.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
                    </td>
                    {isSuperAdmin ? (
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => void handleDelete(r.id)}
                          className="text-sm text-rose-600 hover:underline"
                        >
                          삭제
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showModal && (
        <CreditRegisterModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); void load(); }}
        />
      )}
    </div>
  );
}
