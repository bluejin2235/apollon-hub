"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LicenseFormModal } from "@/components/licenses/license-form-modal";
import {
  ServiceCredentialsCard,
  ServiceManagersCard,
  ServiceUsersCard
} from "@/components/licenses/license-detail-cards";
import { useCanManageLicense } from "@/lib/services/use-service-permissions";
import { computeLicenseNextRenewal, formatCurrency, computeLicenseCostBreakdown } from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { useKrwRates } from "@/lib/licenses/use-krw-rates";
import { supabase } from "@/lib/supabase/client";

/* ──────────────── 카테고리 → 컬러 팔레트 (목록 카드와 동일 매핑) ──────────────── */

type CategoryPalette = {
  iconBg: string;
  iconText: string;
  pill: string;
};

const PALETTE_PURPLE: CategoryPalette = {
  iconBg: "bg-violet-100",
  iconText: "text-violet-700",
  pill: "bg-violet-100 text-violet-700"
};
const PALETTE_BLUE: CategoryPalette = {
  iconBg: "bg-blue-100",
  iconText: "text-blue-700",
  pill: "bg-blue-100 text-blue-700"
};
const PALETTE_GREEN: CategoryPalette = {
  iconBg: "bg-emerald-100",
  iconText: "text-emerald-700",
  pill: "bg-emerald-100 text-emerald-700"
};
const PALETTE_ORANGE: CategoryPalette = {
  iconBg: "bg-orange-100",
  iconText: "text-orange-700",
  pill: "bg-orange-100 text-orange-700"
};
const PALETTE_ROSE: CategoryPalette = {
  iconBg: "bg-rose-100",
  iconText: "text-rose-700",
  pill: "bg-rose-100 text-rose-700"
};
const PALETTE_SLATE: CategoryPalette = {
  iconBg: "bg-slate-200",
  iconText: "text-slate-600",
  pill: "bg-slate-100 text-slate-600"
};

function categoryPalette(category: string | null | undefined): CategoryPalette {
  const c = (category ?? "").trim();
  if (!c) return PALETTE_ROSE;
  if (c.includes("디자인")) return PALETTE_PURPLE;
  if (c.includes("개발")) return PALETTE_BLUE;
  if (c.includes("마케팅")) return PALETTE_ORANGE;
  if (c.includes("기획") || c.includes("공통") || c.includes("협업")) return PALETTE_GREEN;
  return PALETTE_ROSE;
}

/* ──────────────── 헬퍼 ──────────────── */

function firstInitial(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t) return "?";
  const arr = Array.from(t);
  return (arr[0] ?? "?").toUpperCase();
}

function formatOriginalCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

/** description 컬럼에 'KEY: value' 줄로 묶여있는 메타를 한 줄씩 파싱. */
function parseDescField(description: string | null | undefined, key: string): string | null {
  if (!description) return null;
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = description.match(re);
  return m ? m[1].trim() : null;
}

/** `메모:` 줄부터 다음 `키:` 형태 메타 줄 전까지(여러 줄) 추출 */
function parseDescMemoBlock(description: string | null | undefined): string | null {
  if (!description) return null;
  const lines = description.split("\n");
  const nextFieldRe = /^(사용목적|결제방법|메모|시작일):\s/;
  const start = lines.findIndex((l) => l.startsWith("메모:"));
  if (start < 0) return null;
  const first = lines[start].replace(/^메모:\s*/, "");
  const parts: string[] = [first];
  for (let i = start + 1; i < lines.length; i++) {
    if (nextFieldRe.test(lines[i])) break;
    parts.push(lines[i]);
  }
  const joined = parts.join("\n").trim();
  return joined || null;
}

function hrefForWebsiteUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "#";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function formatDateKorean(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR");
}

function formatDateTimeKorean(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ──────────────── 페이지 ──────────────── */

export default function LicenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const rates = useKrwRates();
  const [license, setLicense] = useState<License | null>(null);
  const [assignee, setAssignee] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [userCount, setUserCount] = useState(0);

  // 카드 소지자 = `card_holder_id` 우선, 없으면 `assignee_id` (LicenseFormModal 이 현재 assignee_id 에 저장 중).
  const reloadCardHolder = useCallback(async (lic: License | null) => {
    const holderId = lic?.card_holder_id ?? lic?.assignee_id ?? null;
    if (!holderId) {
      setAssignee(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", holderId)
      .maybeSingle();
    setAssignee((data ?? null) as Profile | null);
  }, []);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      // `select("*")` — services 전 컬럼(계약·결제·날짜·url·description 등). RLS로 허용된 열만 내려옴.
      const { data: row } = await supabase
        .from("services")
        .select("*")
        .eq("id", id)
        .eq("is_hub_card", false)
        .maybeSingle();
      const lic = (row ?? null) as License | null;
      setLicense(lic);
      await reloadCardHolder(lic);
      setLoading(false);
    };
    void run();
  }, [id, reloadCardHolder]);

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.from("profiles").select("*");
      setProfiles(((data ?? []) as Profile[]).filter((p) => p.status !== "퇴직"));
    };
    void run();
  }, []);

  const canEditResult = useCanManageLicense(license?.id);
  const canEdit = canEditResult ?? false;

  const handleDelete = async () => {
    if (!license) return;
    setDeleteBusy(true);
    setDeleteErr("");
    const { error } = await supabase.from("services").delete().eq("id", license.id);
    setDeleteBusy(false);
    if (error) {
      console.error("[services][delete]", error);
      setDeleteErr(error.message ?? "삭제에 실패했습니다.");
      return;
    }
    router.push("/licenses/list");
  };

  // 비용 계산 (lib/licenses/calc.ts 와 목록 카드 동일)
  const cost = useMemo(() => {
    if (!license) return null;
    return computeLicenseCostBreakdown(license, rates);
  }, [license, rates]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  if (!license || !cost) {
    return (
      <p className="text-slate-600">
        라이선스를 찾을 수 없습니다.{" "}
        <Link href="/licenses/list" className="text-apollon-600 hover:underline">
          목록
        </Link>
      </p>
    );
  }

  const palette = categoryPalette(license.category);

  // 상태 뱃지
  const statusActive = license.status !== "비활성";
  const statusBadge = statusActive
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-600";

  // 다음 결제일 — 영구는 없음. 년 구독은 end_date, 월 구독은 payment_day.
  const nextPaymentDate = cost.isPerpetual ? null : computeLicenseNextRenewal(license);
  let nextPaymentLabel: string | null = null;
  let nextPaymentDiff: number | null = null;
  if (nextPaymentDate) {
    const todayNoon = new Date();
    todayNoon.setHours(12, 0, 0, 0);
    nextPaymentDiff = Math.round(
      (nextPaymentDate.getTime() - todayNoon.getTime()) / 86_400_000
    );
    nextPaymentLabel = nextPaymentDate.toLocaleDateString("ko-KR");
  }
  const nextPaymentColor =
    nextPaymentDiff != null && nextPaymentDiff <= 7 ? "text-amber-600" : "text-slate-900";

  // description / 시작일 / 결제방법 / 사용목적 (시작일은 DB 컬럼 우선)
  const startDateText = license.start_date ?? parseDescField(license.description, "시작일") ?? null;
  const startDateLabel = formatDateKorean(startDateText);
  const endDateText = license.end_date ?? null;
  const endDateLabel = formatDateKorean(endDateText);
  const purchaseDateText = license.purchase_date ?? null;
  const purchaseDateLabel = formatDateKorean(purchaseDateText);
  const paymentMethodText =
    parseDescField(license.description, "결제방법") ?? license.payment_method ?? null;
  const websiteUrlRaw =
    (license.url && license.url.trim()) || (license.website_url && license.website_url.trim()) || "";
  const memoText =
    (license.memo && license.memo.trim()) || parseDescMemoBlock(license.description) || "";
  const purposeText =
    (license.purpose && license.purpose.trim()) ||
    parseDescField(license.description, "사용목적") ||
    "";

  const capacity = license.license_count > 0 ? license.license_count : 0;
  const overflow = capacity > 0 && userCount > capacity;
  const overflowCount = overflow ? userCount - capacity : 0;

  const usedRatio =
    capacity > 0 ? Math.min(100, (userCount / capacity) * 100) : userCount > 0 ? 100 : 0;
  const overflowRatio =
    capacity > 0 && userCount > capacity
      ? Math.min(100, ((userCount - capacity) / capacity) * 100)
      : 0;

  const hasPaymentRow = Boolean(nextPaymentLabel || paymentMethodText);
  const hasUrlOrMemoFooter = Boolean(websiteUrlRaw || memoText);

  return (
    <div className="space-y-4">
      <Link href="/licenses/list" className="text-sm text-apollon-600 hover:underline">
        ← 서비스 목록으로
      </Link>

      {/* 헤더 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${palette.iconBg} ${palette.iconText}`}
            aria-hidden
          >
            {firstInitial(license.name)}
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{license.name}</h1>
              {license.plan ? (
                <span className="text-sm font-medium text-slate-600">{license.plan}</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{license.category}</p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7m-1.4-9.4a2 2 0 1 1 2.8 2.8L11.7 19.5a4 4 0 0 1-1.7 1l-3.3.9.9-3.3a4 4 0 0 1 1-1.7L18.6 3.6Z" />
              </svg>
              수정
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteErr("");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z" />
              </svg>
              삭제
            </button>
          </div>
        ) : null}
      </header>

      {/* 본문 그리드 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 좌측 영역 */}
        <main className="space-y-4 lg:col-span-2">
          {/* ① 서비스 정보 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">서비스 정보</h2>
            <div className="mt-4 min-w-0">
              {/* 상단: 고정 2열 × 최대 3행 (긴 텍스트와 분리) */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-6">
                {/* 행 1: 비용 | 계약 유형 */}
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">
                    {cost.isPerpetual ? "구매 비용" : "월간비용"}
                  </p>
                  {cost.isPerpetual ? (
                    <>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                        {cost.perpetualTotalKrw != null
                          ? formatCurrency(cost.perpetualTotalKrw)
                          : formatOriginalCurrency(cost.perpetualTotalOrig, cost.currency)}
                      </p>
                      {cost.seatCount > 0 ? (
                        <p className="mt-1 text-xs tabular-nums text-slate-500">
                          {cost.isKrw
                            ? `${formatCurrency(cost.perpetualPerUnitOrig)} × ${cost.seatCount}개`
                            : `${formatOriginalCurrency(cost.perpetualPerUnitOrig, cost.currency)} × ${cost.seatCount}개`}
                        </p>
                      ) : null}
                      {!cost.isKrw && cost.fxRateFormatted && cost.perpetualPerUnitKrw != null && cost.seatCount > 0 ? (
                        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          (적용환율 {cost.fxRateFormatted}원기준 개당{" "}
                          {Math.round(cost.perpetualPerUnitKrw).toLocaleString("ko-KR")}원 × {cost.seatCount}개)
                        </p>
                      ) : null}
                    </>
                  ) : cost.isYearly ? (
                    <>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                        {cost.monthlyTotalKrw != null
                          ? formatCurrency(cost.monthlyTotalKrw)
                          : formatOriginalCurrency(cost.monthlyTotalOrig, cost.currency)}
                      </p>
                      {!cost.isKrw ? (
                        <>
                          <p className="mt-1 text-xs tabular-nums text-slate-500">
                            {formatOriginalCurrency(cost.perUnitMonthlyOrig, cost.currency)}/월 × {cost.licenseCount}개
                          </p>
                          {cost.fxRateFormatted && cost.perUnitMonthlyKrw != null ? (
                            <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                              (적용환율 {cost.fxRateFormatted}원기준 개당 월{" "}
                              {Math.round(cost.perUnitMonthlyKrw).toLocaleString("ko-KR")}원)
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                        {cost.monthlyTotalKrw != null
                          ? formatCurrency(cost.monthlyTotalKrw)
                          : formatOriginalCurrency(cost.monthlyTotalOrig, cost.currency)}
                      </p>
                      <p className="mt-1 text-xs tabular-nums text-slate-500">
                        {cost.isKrw
                          ? `${formatCurrency(cost.perUnitMonthlyOrig)}/월 × ${cost.licenseCount}개`
                          : `${formatOriginalCurrency(cost.perUnitMonthlyOrig, cost.currency)}/월 × ${cost.licenseCount}개`}
                      </p>
                      {!cost.isKrw && cost.fxRateFormatted && cost.perUnitMonthlyKrw != null ? (
                        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          (적용환율 {cost.fxRateFormatted}원기준 개당 월{" "}
                          {Math.round(cost.perUnitMonthlyKrw).toLocaleString("ko-KR")}원)
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="text-xs text-slate-500">계약 유형</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {cost.uiContract}
                  </p>
                </div>

                {/* 행 2: 구매일·시작일·종료일(갱신) 묶음 | 상태 */}
                <div className="min-w-0 space-y-4">
                  {cost.isPerpetual && purchaseDateLabel ? (
                    <div>
                      <p className="text-xs text-slate-500">구매일</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-900">
                        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {purchaseDateLabel}
                      </p>
                    </div>
                  ) : null}

                  {!cost.isPerpetual && cost.isYearly && startDateLabel ? (
                    <div>
                      <p className="text-xs text-slate-500">서비스 시작일</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-900">
                        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {startDateLabel}
                      </p>
                    </div>
                  ) : null}

                  {!cost.isPerpetual && cost.isYearly && endDateLabel ? (
                    <div>
                      <p className="text-xs text-slate-500">라이선스 종료일 (갱신일)</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-900">
                        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {endDateLabel}
                      </p>
                    </div>
                  ) : null}

                  {!cost.isPerpetual && !cost.isYearly && startDateLabel ? (
                    <div>
                      <p className="text-xs text-slate-500">서비스 시작일</p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-900">
                        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {startDateLabel}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <p className="text-xs text-slate-500">상태</p>
                  <span
                    className={`mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}
                  >
                    {license.status}
                  </span>
                </div>

                {/* 행 3: 다음 결제일 | 결제방법 (둘 다 없으면 행 생략) */}
                {hasPaymentRow ? (
                  <>
                    <div className="min-w-0">
                      {nextPaymentLabel ? (
                        <>
                          <p className="text-xs text-slate-500">다음 결제일</p>
                          <p className={`mt-1 flex flex-wrap items-center gap-1.5 text-sm font-medium tabular-nums ${nextPaymentColor}`}>
                            <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            {nextPaymentLabel}
                            {nextPaymentDiff != null ? (
                              <span className="text-xs opacity-80">
                                ({nextPaymentDiff === 0 ? "오늘" : `${nextPaymentDiff}일 후`})
                              </span>
                            ) : null}
                          </p>
                        </>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      {paymentMethodText ? (
                        <>
                          <p className="text-xs text-slate-500">결제방법</p>
                          <p className="mt-1 text-sm">
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              {paymentMethodText === "법인카드" && assignee?.name
                                ? `${paymentMethodText} (${assignee.name})`
                                : paymentMethodText}
                            </span>
                          </p>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>

              {/* 하단: URL·메모 전체 너비 (상단 2열 그리드와 격리, 구분선은 항상) */}
              <div
                className={`mt-6 border-t border-slate-100 ${hasUrlOrMemoFooter ? "space-y-6 pt-6" : ""}`}
              >
                {websiteUrlRaw ? (
                  <div className="w-full min-w-0">
                    <p className="text-xs text-slate-500">웹사이트 URL</p>
                    <p className="mt-1 text-sm">
                      <a
                        href={hrefForWebsiteUrl(websiteUrlRaw)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-start gap-1.5 break-all font-medium text-apollon-600 underline decoration-apollon-600/30 underline-offset-2 hover:text-apollon-700 hover:decoration-apollon-700/40"
                      >
                        <span aria-hidden className="shrink-0">
                          🌐
                        </span>
                        <span className="min-w-0 break-all">{websiteUrlRaw}</span>
                      </a>
                    </p>
                  </div>
                ) : null}

                {memoText ? (
                  <div className="w-full min-w-0">
                    <p className="text-xs text-slate-500">메모</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{memoText}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* ② 서비스 담당자 */}
          <ServiceManagersCard serviceId={license.id} profiles={profiles} canEdit={canEdit} />

          {/* ③ 서비스 사용목적 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">서비스 사용목적</h2>
            <div className="mt-4">
              {purposeText ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{purposeText}</p>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                  사용목적이 입력되지 않았습니다
                </p>
              )}
            </div>
          </section>

          {/* ④ 라이선스 사용자 */}
          <ServiceUsersCard
            serviceId={license.id}
            profiles={profiles}
            capacity={capacity}
            canEdit={canEdit}
            onCountChange={setUserCount}
          />

          {/* ⑤ 인증 정보 */}
          <ServiceCredentialsCard serviceId={license.id} canEdit={canEdit} />
        </main>

        {/* 우측 영역 */}
        <aside className="space-y-4">
          {/* 연간 비용 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">
              {cost.isPerpetual ? "총 구매 비용" : "연간 비용"}
            </h2>
            <div className="mt-3">
              <p className="text-3xl font-bold tabular-nums text-slate-900">
                {cost.isPerpetual
                  ? cost.perpetualTotalKrw != null
                    ? formatCurrency(cost.perpetualTotalKrw)
                    : formatOriginalCurrency(cost.perpetualTotalOrig, cost.currency)
                  : cost.annualTotalKrw != null
                    ? formatCurrency(cost.annualTotalKrw)
                    : formatOriginalCurrency(cost.annualTotalOrig, cost.currency)}
              </p>
              {cost.isPerpetual ? (
                <>
                  {cost.seatCount > 0 ? (
                    <p className="mt-2 text-xs tabular-nums text-slate-500">
                      {cost.isKrw
                        ? `${formatCurrency(cost.perpetualPerUnitOrig)} × ${cost.seatCount}개`
                        : `${formatOriginalCurrency(cost.perpetualPerUnitOrig, cost.currency)} × ${cost.seatCount}개`}
                    </p>
                  ) : null}
                  {!cost.isKrw && cost.fxRateFormatted && cost.perpetualPerUnitKrw != null && cost.seatCount > 0 ? (
                    <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                      (적용환율 {cost.fxRateFormatted}원기준)
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-500">영구 라이선스 · 1회 결제</p>
                </>
              ) : (
                <>
                  {!cost.isPerpetual && cost.perUnitMonthlyKrw != null ? (
                    <p className="mt-2 text-xs tabular-nums text-slate-500">
                      {formatCurrency(cost.perUnitMonthlyKrw)} × {cost.licenseCount}개 × 12개월
                      {cost.annualTotalKrw != null ? (
                        <span className="text-slate-600">
                          {" "}
                          = {formatCurrency(cost.annualTotalKrw)}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {!cost.isKrw ? (
                    <p className="mt-1 text-xs tabular-nums text-slate-400">
                      {formatOriginalCurrency(cost.perUnitMonthlyOrig, cost.currency)}/월 × {cost.licenseCount}개
                    </p>
                  ) : null}
                  {!cost.isKrw && cost.fxRateFormatted ? (
                    <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      (적용환율 {cost.fxRateFormatted}원기준)
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {/* 라이선스 현황 */}
          {capacity > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900">라이선스 현황</h2>
              <div className="mt-3 flex items-baseline justify-center gap-1">
                <span
                  className={`text-5xl font-bold tabular-nums ${overflow ? "text-rose-500" : "text-violet-600"}`}
                >
                  {userCount}
                </span>
                <span className="text-xl font-semibold text-slate-400">/{capacity}</span>
              </div>
              <p className="mt-1 text-center text-xs text-slate-500">사용 중</p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                {overflow ? (
                  <div className="h-full w-full bg-rose-500" style={{ width: `${100}%` }} />
                ) : (
                  <div
                    className="h-full bg-violet-500"
                    style={{ width: `${usedRatio}%` }}
                  />
                )}
              </div>
              {overflow ? (
                <p className="mt-2 text-center text-xs font-medium text-rose-500">
                  {overflowCount}명 초과 · 공동사용 중 (비용 {userCount}명 분배)
                </p>
              ) : null}
              {/* overflowRatio 변수 미사용 경고 방지를 위한 데이터 attribute (CSS 미사용) */}
              <span className="hidden" data-overflow-ratio={overflowRatio} />
            </section>
          ) : null}

          {/* 추가 정보 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">추가 정보</h2>
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-slate-500">최초 등록일</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {formatDateTimeKorean(license.created_at) ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">최종 수정일</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {formatDateTimeKorean(license.updated_at) ?? "-"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] leading-snug text-slate-400">
              해당 라이선스 서비스관리는 서비스 담당자 및 사이트 관리자에게 문의
            </p>
          </section>
        </aside>
      </div>

      {/* 편집 모달 */}
      {editOpen && canEdit ? (
        <LicenseFormModal
          mode="edit"
          license={license}
          profiles={profiles}
          onClose={() => setEditOpen(false)}
          onSaved={(row) => {
            setLicense(row);
            void reloadCardHolder(row);
            setEditOpen(false);
          }}
        />
      ) : null}

      {/* 삭제 확인 모달 */}
      {deleteOpen && canEdit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">서비스 삭제</h3>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{license.name}</span>{" "}
              서비스를 삭제하시겠습니까? <br />
              <span className="text-rose-500">담당자/사용자/인증 정보도 함께 삭제되며 이 작업은 되돌릴 수 없습니다.</span>
            </p>
            {deleteErr ? <p className="mt-2 text-xs text-rose-600">{deleteErr}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteBusy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteBusy ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
