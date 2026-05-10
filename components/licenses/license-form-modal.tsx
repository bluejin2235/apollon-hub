"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ContractType, License, LicenseStatus, PaymentMethod, Profile } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

const contractOptions: ContractType[] = ["월 구독", "년 구독", "영구 라이선스"];
const statusOptions: LicenseStatus[] = ["활성", "비활성"];
const paymentOptions: PaymentMethod[] = ["법인카드", "계좌이체"];
const currencyOptions = ["KRW", "USD", "EUR"] as const;

type Mode = "create" | "edit";

export function LicenseFormModal({
  mode,
  license,
  profiles,
  onClose,
  onSaved
}: {
  mode: Mode;
  license: License | null;
  profiles: Profile[];
  onClose: () => void;
  onSaved: (license: License) => void;
}) {
  const [name, setName] = useState(license?.name ?? "");
  const [planName, setPlanName] = useState(license?.plan_name ?? "");
  const [category, setCategory] = useState(license?.category ?? "");
  const [currency, setCurrency] = useState(license?.currency ?? "KRW");
  const [cost, setCost] = useState(license?.cost != null ? String(license.cost) : "");
  const [contractType, setContractType] = useState<ContractType>(license?.contract_type ?? "월 구독");
  const [startDate, setStartDate] = useState(
    license?.start_date ? license.start_date.slice(0, 10) : ""
  );
  const [purpose, setPurpose] = useState(license?.purpose ?? "");
  const [status, setStatus] = useState<LicenseStatus>(license?.status ?? "활성");
  const [licenseCount, setLicenseCount] = useState(
    license?.license_count != null ? String(license.license_count) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(license?.payment_method ?? "법인카드");
  const [cardHolderId, setCardHolderId] = useState(license?.card_holder_id ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(license?.website_url ?? "");
  const [memo, setMemo] = useState(license?.memo ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const title = mode === "create" ? "새 서비스 추가" : "서비스 수정";

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [profiles]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const trimmedName = name.trim();
    const trimmedPurpose = purpose.trim();

    if (!trimmedName) {
      setError("서비스 이름을 입력해주세요.");
      return;
    }
    if (!trimmedPurpose) {
      setError("서비스 사용목적을 입력해주세요.");
      return;
    }

    const costNum = cost.trim() === "" ? 0 : Number(cost);
    if (Number.isNaN(costNum) || costNum < 0) {
      setError("비용을 올바르게 입력해주세요.");
      return;
    }

    const lc =
      licenseCount.trim() === "" ? null : Number.parseInt(licenseCount, 10);
    if (licenseCount.trim() !== "" && (Number.isNaN(lc) || lc! < 1)) {
      setError("라이선스 수량은 비우거나 1 이상이어야 합니다.");
      return;
    }

    const payload = {
      name: trimmedName,
      plan_name: planName.trim() || null,
      category: category.trim() || null,
      currency,
      cost: costNum,
      contract_type: contractType,
      start_date: startDate.trim() || null,
      purpose: trimmedPurpose,
      status,
      license_count: lc,
      payment_method: paymentMethod,
      card_holder_id: cardHolderId || null,
      website_url: websiteUrl.trim() || null,
      memo: memo.trim() || null
    };

    setLoading(true);

    if (mode === "create") {
      const { data, error: insertError } = await supabase
        .from("licenses")
        .insert(payload)
        .select()
        .single();

      setLoading(false);

      if (insertError || !data) {
        setError(insertError?.message ?? "추가에 실패했습니다.");
        return;
      }

      onSaved(data as License);
      onClose();
      return;
    }

    if (!license) {
      setLoading(false);
      return;
    }

    const { data, error: updateError } = await supabase
      .from("licenses")
      .update(payload)
      .eq("id", license.id)
      .select()
      .single();

    setLoading(false);

    if (updateError || !data) {
      setError(updateError?.message ?? "저장에 실패했습니다.");
      return;
    }

    onSaved(data as License);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-8">
      <div className="apollon-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            닫기
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">서비스 이름</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">상세 상품명</label>
              <input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="예: Team Standard"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">카테고리</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 기획/공통"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">통화</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">비용</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">계약 유형</label>
              <select
                value={contractType}
                onChange={(e) => setContractType(e.target.value as ContractType)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              >
                {contractOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">서비스 시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">
                서비스 사용목적 <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                required
                placeholder="이 서비스를 왜 사용하는지 입력해주세요"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">상태</label>
              <div className="flex gap-2">
                {statusOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      status === s
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">라이선스 수량</label>
              <input
                type="number"
                min={1}
                value={licenseCount}
                onChange={(e) => setLicenseCount(e.target.value)}
                placeholder="비워두면 무제한"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
              <p className="mt-1 text-xs text-slate-500">비워두면 라이선스 수량 제한 없음</p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">결제방법</label>
              <div className="flex gap-2">
                {paymentOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPaymentMethod(p)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      paymentMethod === p
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">카드 소지자</label>
              <select
                value={cardHolderId}
                onChange={(e) => setCardHolderId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              >
                <option value="">선택 안함</option>
                {sortedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.department})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">웹사이트 URL</label>
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-300">메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-600 bg-slate-900 py-3 font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-apollon-500 py-3 font-semibold text-white transition hover:bg-apollon-400 disabled:opacity-60"
            >
              {loading ? "처리 중..." : mode === "create" ? "추가하기" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
