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
import { activeProfiles, resolveUiContractType } from "@/lib/licenses/calc";
import {
  insertServiceCostHistory,
  shouldRecordCostHistory
} from "@/lib/licenses/service-cost-history";
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
}): string | null {
  const lines: string[] = [];
  if (input.purpose.trim()) lines.push(`사용목적: ${input.purpose.trim()}`);
  if (input.paymentMethod) lines.push(`결제방법: ${input.paymentMethod}`);
  if (input.memo.trim()) lines.push(`메모: ${input.memo.trim()}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** `YYYY-MM-DD` + 1년 (로컬 달력 기준) */
function addOneYearToIsoDate(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7)) - 1;
  const da = Number(iso.slice(8, 10));
  const dt = new Date(y + 1, mo, da, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function initialYearlyEndDate(license: License | null): string {
  if (!license) return "";
  if (license.end_date) return license.end_date.slice(0, 10);
  if (resolveUiContractType(license) === "년 구독" && license.start_date) {
    return addOneYearToIsoDate(license.start_date.slice(0, 10));
  }
  return "";
}

/** description 한 줄 묶음에서 KEY 라인 값을 추출. (예: "사용목적: ABC") */
function parseDescField(
  description: string | null | undefined,
  key: string
): string | null {
  if (!description) return null;
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = description.match(re);
  return m ? m[1].trim() : null;
}

function isPaymentMethod(v: unknown): v is PaymentMethod {
  return v === "법인카드" || v === "계좌이체";
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
  // ─── edit 모드 프리필 ────────────────────────────────────────
  // `services` 테이블에는 purpose/start_date/memo/payment_method/card_holder_id/plan_name/website_url
  // 컬럼이 실제로 존재하지 않고 description / assignee_id / plan / url 등에 저장된다.
  // 폼이 빈값으로 열리면 저장 시 description 이 재생성되며 기존 데이터가 사라지므로,
  // 모든 입력 필드는 다음 우선순위로 폴백 체인 적용:
  //   ① 가상 필드(license.purpose 등) — 신규 데이터 / 외부 채움 호환
  //   ② description 의 동일 키 라인 — buildServiceDescription 으로 저장된 케이스
  //   ③ 실제 services 컬럼(plan / url / assignee_id) — 신규 컬럼 직접 사용 케이스
  const parsedPurpose = parseDescField(license?.description, "사용목적");
  const parsedStartDate = parseDescField(license?.description, "시작일");
  const parsedPaymentMethod = parseDescField(license?.description, "결제방법");
  const parsedMemo = parseDescField(license?.description, "메모");

  const initialPaymentMethod: PaymentMethod = isPaymentMethod(license?.payment_method)
    ? license!.payment_method!
    : isPaymentMethod(parsedPaymentMethod)
      ? parsedPaymentMethod
      : "법인카드";

  const [name, setName] = useState(license?.name ?? "");
  const [planName, setPlanName] = useState(
    (license?.plan_name && license.plan_name.trim()) ||
      (license?.plan && license.plan.trim()) ||
      ""
  );
  const [category, setCategory] = useState(license?.category ?? "");
  const [currency, setCurrency] = useState(license?.currency ?? "KRW");
  const [cost, setCost] = useState(
    license?.cost != null && license.cost > 0
      ? String(license.cost)
      : license?.cost_monthly != null && Number(license.cost_monthly) > 0
        ? String(license.cost_monthly)
        : ""
  );
  const [contractType, setContractType] = useState<ContractType>(
    license ? resolveUiContractType(license) : "월 구독"
  );
  const [purchaseDate, setPurchaseDate] = useState(
    license?.purchase_date ? license.purchase_date.slice(0, 10) : ""
  );
  const [endDate, setEndDate] = useState(initialYearlyEndDate(license));
  const [startDate, setStartDate] = useState(
    license?.start_date
      ? license.start_date.slice(0, 10)
      : parsedStartDate
        ? parsedStartDate.slice(0, 10)
        : ""
  );
  const [paymentDay, setPaymentDay] = useState(
    license?.payment_day != null ? String(license.payment_day) : ""
  );
  const [purpose, setPurpose] = useState(
    (license?.purpose && license.purpose.trim()) || parsedPurpose || ""
  );
  const [status, setStatus] = useState<LicenseStatus>(license?.status === "비활성" ? "비활성" : "활성");
  const [licenseCount, setLicenseCount] = useState(
    license?.license_count != null ? String(license.license_count) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialPaymentMethod);
  const [cardHolderId, setCardHolderId] = useState(
    license?.card_holder_id ?? license?.assignee_id ?? ""
  );
  const [websiteUrl, setWebsiteUrl] = useState(
    (license?.website_url && license.website_url.trim()) || license?.url || ""
  );
  const [memo, setMemo] = useState(
    (license?.memo && license.memo.trim()) || parsedMemo || ""
  );
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

    // 결제일 / 계약일
    //   - 월 구독: payment_day + start_date 컬럼
    //   - 년 구독: purchase_date, start_date, end_date (갱신일). payment_month/day 미사용 → null
    //   - 영구: purchase_date 만
    let payDayNum: number | null = null;
    let payMonthNum: number | null = null;
    let purchaseDateVal: string | null = null;
    let startDateVal: string | null = null;
    let endDateVal: string | null = null;

    if (contractType === "월 구독") {
      if (paymentDay.trim() !== "") {
        const n = Number.parseInt(paymentDay, 10);
        if (Number.isNaN(n) || n < 1 || n > 31) {
          setError("결제일은 1~31 사이의 숫자여야 합니다.");
          return;
        }
        payDayNum = n;
      }
      startDateVal = startDate.trim() || null;
      purchaseDateVal = null;
      endDateVal = null;
      payMonthNum = null;
    } else if (contractType === "년 구독") {
      purchaseDateVal = purchaseDate.trim() || null;
      startDateVal = startDate.trim() || null;
      endDateVal = endDate.trim() || null;
      payDayNum = null;
      payMonthNum = null;
    } else {
      purchaseDateVal = purchaseDate.trim() || null;
      startDateVal = null;
      endDateVal = null;
      payDayNum = null;
      payMonthNum = null;
    }

    const servicePayload = {
      // services 직접 컬럼 (purpose / payment_method / memo / card_holder_id 컬럼 없음)
      name: trimmedName,
      plan: planName.trim() || trimmedName,
      category: category.trim() || "기타",
      status,
      cost: costNum,
      cost_monthly: costNum,
      currency,
      contract_type: contractType,
      cost_type: mapContractToCostType(contractType),
      next_payment_date: null,
      purchase_date: purchaseDateVal,
      start_date: startDateVal,
      end_date: endDateVal,
      payment_day: payDayNum,
      payment_month: payMonthNum,
      license_count: lc ?? 0,
      assignee_id: cardHolderId || null,
      url: websiteUrl.trim() || null,
      description: buildServiceDescription({
        purpose: trimmedPurpose,
        memo,
        paymentMethod
      }),
      is_hub_card: false,
      // 트리거가 없으므로 update 시 명시적으로 갱신 (insert 시는 default now() 가 적용).
      updated_at: new Date().toISOString()
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

      const saved = data as License;
      await insertServiceCostHistory(
        supabase,
        saved,
        activeProfiles(profiles).length
      );
      onSaved(saved);
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

    const saved = data as License;
    if (
      shouldRecordCostHistory(license, {
        cost: costNum,
        license_count: lc ?? 0,
        contract_type: contractType
      })
    ) {
      await insertServiceCostHistory(supabase, saved, activeProfiles(profiles).length);
    }
    onSaved(saved);
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
            {contractType === "월 구독" ? (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">서비스 시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                  />
                </div>
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
              </>
            ) : null}
            {contractType === "년 구독" ? (
              <div className="sm:col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <h3 className="text-sm font-semibold text-sky-900">년 계약 정보</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">구매일</label>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">라이선스 시작일</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStartDate(v);
                        if (v) setEndDate(addOneYearToIsoDate(v));
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      라이선스 종료일 (갱신일)
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                    />
                    <p className="mt-1 text-xs text-sky-800/90">
                      라이선스 종료일이 갱신일로 자동 적용됩니다. 시작일을 입력하면 종료일이 1년 후로 채워지며, 필요 시 직접 수정할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            {contractType === "영구 라이선스" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">구매일</label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
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
