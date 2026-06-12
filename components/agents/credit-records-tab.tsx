"use client";
import { useCallback, useEffect, useState } from "react";
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

type PeriodPreset = "this_month" | "last_month" | "last_3m" | "custom";

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: "this_month", label: "이번 달" },
  { value: "last_month", label: "지난 달" },
  { value: "last_3m", label: "최근 3개월" },
  { value: "custom", label: "직접 선택" }
];

function resolveDateRange(preset: PeriodPreset, customStart: string, customEnd: string) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (preset === "this_month") {
    return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) };
  }
  if (preset === "last_month") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: fmt(first), end: fmt(last) };
  }
  if (preset === "last_3m") {
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    return { start: fmt(start), end: fmt(today) };
  }
  return { start: customStart, end: customEnd };
}

export function CreditRecordsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<PeriodPreset>("this_month");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(today);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [records, setRecords] = useState<CreditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const range = resolveDateRange(period, customStart, customEnd);

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

  const services = ["all", ...Array.from(new Set(records.map((r) => r.service_name)))];
  const filtered = serviceFilter === "all" ? records : records.filter((r) => r.service_name === serviceFilter);
  const totalKrw = filtered.reduce((s, r) => s + r.amount_krw, 0);

  const byService = Array.from(
    filtered.reduce((map, r) => {
      map.set(r.service_name, (map.get(r.service_name) ?? 0) + r.amount_krw);
      return map;
    }, new Map<string, number>())
  ).sort((a, b) => b[1] - a[1]);

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

      {/* 등록 내역 */}
      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">등록 내역</h2>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            등록된 내역이 없습니다. 충전 등록 버튼으로 추가해 주세요.
          </p>
        ) : (
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3">서비스 · 메모</th>
                <th className="px-5 py-3">유형</th>
                <th className="px-5 py-3">날짜</th>
                <th className="px-5 py-3">등록자</th>
                <th className="px-5 py-3 text-center">영수증</th>
                <th className="px-5 py-3 text-right">금액</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
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
                    <td className="px-5 py-3 text-slate-600">{r.registrar_name ?? "—"}</td>
                    <td className="px-5 py-3 text-center">
                      {r.image_path ? (
                        <a
                          href={supabase.storage.from("credit-images").getPublicUrl(r.image_path).data.publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-600 hover:underline"
                        >
                          보기
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-slate-900">
                      {r.amount_krw.toLocaleString("ko-KR", { style: "currency", currency: "KRW" })}
                    </td>
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
