"use client";

import { FormEvent, useMemo, useState } from "react";
import type {
  ContractType,
  License,
  LicenseStatus,
  PaymentMethod,
  Profile,
  ServiceCostType
} from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

const contractOptions: ContractType[] = ["월 구독", "년 구독", "영구 라이선스"];
const statusOptions: LicenseStatus[] = ["활성", "비활성"];
const paymentOptions: PaymentMethod[] = ["법인카드", "계좌이체"];
const currencyOptions = ["KRW", "USD", "EUR"] as const;

type Mode = "create" | "edit";

/**
 * 폼의 `contract_type` 을 `services` 테이블의 `cost_type` 로 매핑한다.
 * - “월 구독” → “월간”
 * - “년 구독” → “연간”
 * - “영구 라이선스” → “영구”
 */
function mapContractToCostType(c: ContractType): ServiceCostType {
  if (c === "년 구독") return "연간";
  if (c === "영구 라이선스") return "영구";
  return "월간";
}

/**
 * 폼의 `purpose` / `memo` / `payment_method` / `start_date` 등 1:1 매핑이 없는
 * 필드는 `description` 한 줄 묶음으로 보존한다.
 * 통화/계약유형/원본금액은 별도 컬럼(currency, contract_type, cost)으로 저장됨.
 */
function buildServiceDescription(input: {
  purpose: string;
  memo: string;
  paymentMethod: PaymentMethod;
  startDate: string;
}): string | null {
  const lines: string[] = [];
  if (input.purpose.trim()) lines.push(`사용목적: ${input.purpose.trim()}`);
  if (input.startDate.trim()) lines.push(`시작일: ${input.startDate.trim()}`);
  if (input.paymentMethod) lines.push(`결제방법: ${input.paymentMethod}`);
  if (input.memo.trim()) lines.push(`메모: ${input.memo.trim()}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

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
  const [paymentDay, setPaymentDay] = useState(
    license?.payment_day != null ? String(license.payment_day) : ""
  );
  const [paymentMonth, setPaymentMonth] = useState(
    license?.payment_month != null ? String(license.payment_month) : ""
  );
  const [purpose, setPurpose] = useState(license?.purpose ?? "");
  const [status, setStatus] = useState<LicenseStatus>(license?.status === "비활성" ? "비활성" : "활성");
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

    // `services` 테이블 스키마에 맞춰 폼 값을 변환.
    // - 원본 입력 금액은 `cost` 에 저장하고, `cost_monthly` 도 호환 위해 동일 값 보관
    //   (FX 환산은 화면에서 처리, 백엔드는 원본 통화 기준 숫자 그대로 보존)
    // - 통화/계약유형도 별도 컬럼(currency, contract_type) 으로 저장
    // - 1:1 매핑이 없는 필드(purpose/memo/payment/start_date)는 description 줄단위로 묶음
    // 결제일 입력 검증 & 정규화.
    //   - 월 구독: payment_day(1~31)만 사용
    //   - 년 구독: payment_day(1~31) + payment_month(1~12)
    //   - 영구 라이선스: 둘 다 null
    let payDayNum: number | null = null;
    let payMonthNum: number | null = null;
    if (contractType === "월 구독" || contractType === "년 구독") {
      if (paymentDay.trim() !== "") {
        const n = Number.parseInt(paymentDay, 10);
        if (Number.isNaN(n) || n < 1 || n > 31) {
          setError("결제일은 1~31 사이의 숫자여야 합니다.");
          return;
        }
        payDayNum = n;
      }
    }
    if (contractType === "년 구독") {
      if (paymentMonth.trim() !== "") {
        const n = Number.parseInt(paymentMonth, 10);
        if (Number.isNaN(n) || n < 1 || n > 12) {
          setError("결제 월은 1~12 사이의 숫자여야 합니다.");
          return;
        }
        payMonthNum = n;
      }
    }

    const servicePayload = {
      name: trimmedName,
      plan: planName.trim() || trimmedName,
      category: category.trim() || "기타",
      status,
      cost: costNum,
      cost_monthly: costNum,
      currency,
      contract_type: contractType,
      cost_type: mapContractToCostType(contractType),
      // next_payment_date 컬럼은 더 이상 쓰지 않음. payment_day/month 로 동적 계산.
      next_payment_date: null,
      payment_day: payDayNum,
      payment_month: payMonthNum,
      license_count: lc ?? 0,
      assignee_id: cardHolderId || null,
      url: websiteUrl.trim() || null,
      description: buildServiceDescription({
        purpose: trimmedPurpose,
        memo,
        paymentMethod,
        startDate
      }),
      is_hub_card: false
    };

    setLoading(true);

    if (mode === "create") {
      const { data, error: insertError } = await supabase
        .from("services")
        .insert(servicePayload)
        .select()
        .single();

      setLoading(false);

      if (insertError || !data) {
        console.error("[license-form-modal] services.insert failed", insertError);
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
      .from("services")
      .update(servicePayload)
      .eq("id", license.id)
      .eq("is_hub_card", false)
      .select()
      .single();

    setLoading(false);

    if (updateError || !data) {
      console.error("[license-form-modal] services.update failed", updateError);
      setError(updateError?.message ?? "저장에 실패했습니다.");
      return;
    }

    onSaved(data as License);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 px-4 py-8 backdrop-blur-[2px]">
      <div className="apollon-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            닫기
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">서비스 이름</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">상세 상품명</label>
              <input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="예: Team Standard"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">카테고리</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 기획/공통"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">통화</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">비용</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">계약 유형</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">서비스 시작일</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            {contractType === "월 구독" ? (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">매월 결제일</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)}
                    placeholder="1 ~ 31"
                    className="w-32 rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                  <span className="text-sm text-slate-600">일</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">매월 해당 일자에 자동 결제됩니다. (예: 18 → 매월 18일)</p>
              </div>
            ) : null}
            {contractType === "년 구독" ? (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">매년 결제일</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={paymentMonth}
                    onChange={(e) => setPaymentMonth(e.target.value)}
                    placeholder="1 ~ 12"
                    className="w-28 rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                  <span className="text-sm text-slate-600">월</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)}
                    placeholder="1 ~ 31"
                    className="w-28 rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                  <span className="text-sm text-slate-600">일</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">매년 해당 월·일에 자동 결제됩니다. (예: 3월 18일)</p>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
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
              <label className="mb-1 block text-sm font-medium text-slate-700">상태</label>
              <div className="flex gap-2">
                {statusOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      status === s
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-800"
                        : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">라이선스 수량</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">결제방법</label>
              <div className="flex gap-2">
                {paymentOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPaymentMethod(p)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      paymentMethod === p
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-800"
                        : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">카드 소지자</label>
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
              <label className="mb-1 block text-sm font-medium text-slate-700">웹사이트 URL</label>
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-800 transition hover:bg-slate-50"
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
