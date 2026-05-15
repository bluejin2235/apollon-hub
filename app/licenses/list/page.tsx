"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LicenseFormModal } from "@/components/licenses/license-form-modal";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { computeLicenseNextRenewal, formatCurrency, resolveUiContractType } from "@/lib/licenses/calc";
import type { License, Profile } from "@/lib/licenses/types";
import { useKrwRates } from "@/lib/licenses/use-krw-rates";
import { supabase } from "@/lib/supabase/client";

type CategoryStyle = {
  /** 카드 배경 (연한 톤) */
  cardBg: string;
  /** 카드 테두리 */
  cardBorder: string;
  /** 첫글자 아이콘 원형 배경 */
  iconBg: string;
  /** 첫글자 아이콘 텍스트 */
  iconText: string;
  /** 카테고리/계약유형 pill 배경 */
  pillBg: string;
  /** 카테고리/계약유형 pill 텍스트 */
  pillText: string;
};

const PURPLE_STYLE: CategoryStyle = {
  cardBg: "bg-purple-50",
  cardBorder: "border-purple-200",
  iconBg: "bg-purple-200",
  iconText: "text-purple-800",
  pillBg: "bg-purple-100",
  pillText: "text-purple-800"
};

const BLUE_STYLE: CategoryStyle = {
  cardBg: "bg-blue-50",
  cardBorder: "border-blue-200",
  iconBg: "bg-blue-200",
  iconText: "text-blue-800",
  pillBg: "bg-blue-100",
  pillText: "text-blue-800"
};

const GREEN_STYLE: CategoryStyle = {
  cardBg: "bg-emerald-50",
  cardBorder: "border-emerald-200",
  iconBg: "bg-emerald-200",
  iconText: "text-emerald-800",
  pillBg: "bg-emerald-100",
  pillText: "text-emerald-800"
};

const ORANGE_STYLE: CategoryStyle = {
  cardBg: "bg-orange-50",
  cardBorder: "border-orange-200",
  iconBg: "bg-orange-200",
  iconText: "text-orange-800",
  pillBg: "bg-orange-100",
  pillText: "text-orange-800"
};

/** 기타/전사/공 등 매칭 안 되는 카테고리 폴백 — 연한 분홍 */
const PINK_STYLE: CategoryStyle = {
  cardBg: "bg-rose-50",
  cardBorder: "border-rose-200",
  iconBg: "bg-rose-200",
  iconText: "text-rose-800",
  pillBg: "bg-rose-100",
  pillText: "text-rose-800"
};

const INACTIVE_STYLE: CategoryStyle = {
  cardBg: "bg-slate-50",
  cardBorder: "border-slate-200",
  iconBg: "bg-slate-200",
  iconText: "text-slate-500",
  pillBg: "bg-slate-100",
  pillText: "text-slate-500"
};

/**
 * 카테고리 문자열 → 카드 팔레트.
 * - 디자인 → 보라
 * - 개발 → 파랑
 * - 기획/공통/협업 → 초록
 * - 마케팅 → 주황
 * - 그 외 (전사/공/기타/빈값) → 분홍 폴백
 */
function categoryStyle(category: string | null | undefined): CategoryStyle {
  const c = (category ?? "").trim();
  if (!c) return PINK_STYLE;
  if (c.includes("디자인")) return PURPLE_STYLE;
  if (c.includes("개발")) return BLUE_STYLE;
  if (c.includes("마케팅")) return ORANGE_STYLE;
  if (c.includes("기획") || c.includes("공통") || c.includes("협업")) return GREEN_STYLE;
  return PINK_STYLE;
}

/**
 * 계약 유형 → 가격 뒤 suffix.
 * - "월 구독" / "월간" → "/월"
 * - "년 구독" / "연간" → "/년"
 * - "영구 라이선스" / "영구" → "" (표시 안 함)
 */
function costSuffix(
  contractType: string | null | undefined,
  costType: License["cost_type"] | null | undefined
): string {
  const c = (contractType ?? "").trim();
  if (c === "월 구독") return "/월";
  if (c === "년 구독") return "/년";
  if (c === "영구 라이선스") return "";
  if (costType === "월간") return "/월";
  if (costType === "연간") return "/년";
  return "";
}

/** USD/EUR 등 원본 통화 포맷팅 (소수점 없는 정수 단위) */
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

function firstInitial(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t) return "?";
  // 영문/숫자/한글 첫 문자 그대로 사용 (이모지 등 surrogate 케어)
  const arr = Array.from(t);
  return (arr[0] ?? "?").toUpperCase();
}

type StatusFilter = "전체" | "활성" | "비활성";
type SortKey = "recent" | "name" | "cost";

export default function LicensesListPage() {
  const { profile } = useRequirePortalSession();
  const rates = useKrwRates();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("전체");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  useEffect(() => {
    const run = async () => {
      const [l, p] = await Promise.all([
        supabase
          .from("services")
          .select("*")
          .eq("is_hub_card", false)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, name, email, department, role, status")
      ]);
      setLicenses((l.data ?? []) as License[]);
      setProfiles((p.data ?? []) as Profile[]);
      setLoading(false);
    };
    void run();
  }, []);

  const assigneeMap = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((x) => m.set(x.id, x));
    return m;
  }, [profiles]);

  const role = profile?.role ?? "";
  const canCreate = role === "슈퍼관리자" || role === "중간관리자";

  /** 데이터에 실제 존재하는 카테고리만 옵션으로 노출 */
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of licenses) {
      const c = (row.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [licenses]);

  /** 검색 + 상태 + 카테고리 필터 적용 */
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return licenses.filter((row) => {
      if (statusFilter !== "전체" && row.status !== statusFilter) return false;
      if (categoryFilter !== "전체" && (row.category ?? "").trim() !== categoryFilter) return false;
      if (q) {
        const blob = [row.name, row.plan, row.plan_name, row.category]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [licenses, searchQuery, statusFilter, categoryFilter]);

  /** 정렬 적용 */
  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    } else if (sortBy === "cost") {
      list.sort((a, b) => Number(b.cost_monthly ?? 0) - Number(a.cost_monthly ?? 0));
    } else {
      list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    return list;
  }, [filtered, sortBy]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">전체 라이선스</h1>
          <p className="mt-1 text-sm text-slate-600">등록된 모든 서비스 라이선스입니다.</p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            + 서비스 추가
          </button>
        ) : null}
      </header>

      {/* 필터바 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-[18rem]">
            <span
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
                />
              </svg>
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="서비스 이름, 플랜, 카테고리 검색"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-2.5 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="상태 필터"
          >
            <option value="전체">전체 상태</option>
            <option value="활성">활성</option>
            <option value="비활성">비활성</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="카테고리 필터"
          >
            <option value="전체">전체 카테고리</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="정렬"
          >
            <option value="recent">최근 업데이트순</option>
            <option value="name">이름순</option>
            <option value="cost">비용 높은순</option>
          </select>
        </div>
      </section>

      {/* 카드 그리드 */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 shadow-sm">
          조건에 맞는 라이선스가 없습니다.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sorted.map((row) => {
            const inactive = row.status === "비활성";
            const style = inactive ? INACTIVE_STYLE : categoryStyle(row.category);
            const assignee = row.assignee_id ? assigneeMap.get(row.assignee_id) ?? null : null;
            // payment_day / payment_month 기반으로 오늘 이후 가장 가까운 결제일 계산.
            const nextPaymentDate = computeLicenseNextRenewal(row);
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
            const planSecondary =
              (row.plan_name && row.plan_name.trim()) || (row.plan && row.plan.trim()) || "";
            const currency = ((row.currency ?? "KRW") as string).toUpperCase();
            const isKrw = currency === "KRW";
            // 비용 source 우선순위 (스펙):
            //   - KRW: cost_monthly 우선, 비어있으면 cost
            //   - USD/EUR: cost(원본 금액) 우선, 비어있으면 cost_monthly 폴백
            const costMonthlyNum = Number(row.cost_monthly ?? 0);
            const costNum = Number(row.cost ?? 0);
            const rawCost = isKrw
              ? costMonthlyNum > 0
                ? costMonthlyNum
                : costNum
              : costNum > 0
                ? costNum
                : costMonthlyNum;
            const fxRate =
              currency === "USD"
                ? rates?.USD ?? null
                : currency === "EUR"
                  ? rates?.EUR ?? null
                  : null;
            const krwAmount = isKrw ? rawCost : fxRate != null ? rawCost * fxRate : null;
            const suffix = costSuffix(resolveUiContractType(row), row.cost_type);
            const hasForeign = !isKrw && (currency === "USD" || currency === "EUR");

            return (
              <li key={row.id}>
                <Link
                  href={`/licenses/${row.id}`}
                  className={`group flex h-full flex-col rounded-2xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                    style.cardBg
                  } ${style.cardBorder} ${inactive ? "opacity-60" : ""}`}
                >
                  {/* 상단: 아이콘 + 이름/플랜 */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-bold ${style.iconBg} ${style.iconText}`}
                      aria-hidden
                    >
                      {firstInitial(row.name)}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="truncate text-base font-bold text-slate-900 group-hover:text-blue-700">
                        {row.name}
                      </p>
                      {planSecondary ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{planSecondary}</p>
                      ) : null}
                    </div>
                  </div>

                  {/* 카테고리 + 상태 */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-slate-600">
                      {(row.category && row.category.trim()) || "카테고리 미분류"}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        inactive ? "text-slate-500" : "text-emerald-700"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>

                  {/* 비용 + 계약유형 pill */}
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      {krwAmount != null ? (
                        <p className="text-2xl font-bold tabular-nums text-slate-900">
                          {formatCurrency(krwAmount)}
                          {suffix ? (
                            <span className="ml-0.5 text-base font-semibold text-slate-500">
                              {suffix}
                            </span>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-2xl font-bold tabular-nums text-slate-900">
                          {formatOriginalCurrency(rawCost, currency)}
                          {suffix ? (
                            <span className="ml-0.5 text-base font-semibold text-slate-500">
                              {suffix}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {hasForeign && krwAmount != null ? (
                        <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                          {formatOriginalCurrency(rawCost, currency)}
                          {suffix}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.pillBg} ${style.pillText}`}
                    >
                      {resolveUiContractType(row)}
                    </span>
                  </div>

                  {/* 메타 */}
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 tabular-nums">
                        {row.license_count > 0 ? `${row.license_count}개 라이선스` : "무제한"}
                      </span>
                      <span className="truncate font-medium text-slate-700">
                        {assignee?.name ?? "—"}
                      </span>
                    </div>
                    {nextPaymentLabel ? (
                      <div className="mt-2 flex items-center justify-between border-t border-slate-200/60 pt-2 text-xs">
                        <span className="text-slate-500">다음 결제일</span>
                        <span
                          className={`font-medium tabular-nums ${
                            nextPaymentDiff != null && nextPaymentDiff <= 7
                              ? "text-amber-600"
                              : "text-slate-700"
                          }`}
                        >
                          {nextPaymentLabel}
                          {nextPaymentDiff != null ? (
                            <span className="ml-1.5 text-[11px] font-medium opacity-80">
                              ({nextPaymentDiff === 0 ? "오늘" : `${nextPaymentDiff}일 후`})
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {createOpen && canCreate ? (
        <LicenseFormModal
          mode="create"
          license={null}
          profiles={profiles}
          onClose={() => setCreateOpen(false)}
          onSaved={(row) => {
            setLicenses((prev) => [row, ...prev.filter((p) => p.id !== row.id)]);
          }}
        />
      ) : null}
    </div>
  );
}
