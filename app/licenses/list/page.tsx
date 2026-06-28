"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LicenseFormModal } from "@/components/licenses/license-form-modal";
import { useCanCreateLicense } from "@/lib/services/use-service-permissions";
import {
  computeLicenseCostBreakdown,
  computeLicenseNextRenewal,
  formatCurrency,
  licenseCostSortValue,
  licenseCostSuffix,
  licenseListCardCostSublineParts,
  licenseListCardPrimaryKrwAmount,
  licenseListCardPrimaryOrigAmount,
  licenseListCostBadgeLabel
} from "@/lib/licenses/calc";
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

/** 비활성 카드 — 카테고리 색 무시, 슬레이트 톤만 사용 */
const INACTIVE_STYLE: CategoryStyle = {
  cardBg: "bg-slate-50",
  cardBorder: "border-slate-200",
  iconBg: "bg-slate-200",
  iconText: "text-slate-400",
  pillBg: "bg-slate-100",
  pillText: "text-slate-400"
};

/** 명시 카테고리 (exact match, 현재 데이터 기준) */
const EXPLICIT_CATEGORY_STYLES: Record<string, CategoryStyle> = {
  "전사/공통": {
    cardBg: "bg-blue-50",
    cardBorder: "border-blue-200",
    iconBg: "bg-blue-200",
    iconText: "text-blue-700",
    pillBg: "bg-blue-100",
    pillText: "text-blue-700"
  },
  "기획/공통": {
    cardBg: "bg-emerald-50",
    cardBorder: "border-emerald-200",
    iconBg: "bg-emerald-200",
    iconText: "text-emerald-700",
    pillBg: "bg-emerald-100",
    pillText: "text-emerald-700"
  },
  "디자인/공통": {
    cardBg: "bg-purple-50",
    cardBorder: "border-purple-200",
    iconBg: "bg-purple-200",
    iconText: "text-purple-700",
    pillBg: "bg-purple-100",
    pillText: "text-purple-700"
  },
  "디자인/공간": {
    cardBg: "bg-indigo-50",
    cardBorder: "border-indigo-200",
    iconBg: "bg-indigo-200",
    iconText: "text-indigo-700",
    pillBg: "bg-indigo-100",
    pillText: "text-indigo-700"
  },
  "디자인/비주얼": {
    cardBg: "bg-violet-50",
    cardBorder: "border-violet-200",
    iconBg: "bg-violet-200",
    iconText: "text-violet-700",
    pillBg: "bg-violet-100",
    pillText: "text-violet-700"
  },
  "디자인/비주얼,공간": {
    cardBg: "bg-fuchsia-50",
    cardBorder: "border-fuchsia-200",
    iconBg: "bg-fuchsia-200",
    iconText: "text-fuchsia-700",
    pillBg: "bg-fuchsia-100",
    pillText: "text-fuchsia-700"
  },
  "개발/공통": {
    cardBg: "bg-cyan-50",
    cardBorder: "border-cyan-200",
    iconBg: "bg-cyan-200",
    iconText: "text-cyan-700",
    pillBg: "bg-cyan-100",
    pillText: "text-cyan-700"
  },
  "마케팅/공통": {
    cardBg: "bg-orange-50",
    cardBorder: "border-orange-200",
    iconBg: "bg-orange-200",
    iconText: "text-orange-700",
    pillBg: "bg-orange-100",
    pillText: "text-orange-700"
  },
  "콘텐츠/공통": {
    cardBg: "bg-amber-50",
    cardBorder: "border-amber-200",
    iconBg: "bg-amber-200",
    iconText: "text-amber-700",
    pillBg: "bg-amber-100",
    pillText: "text-amber-700"
  },
  "공간/공통": {
    cardBg: "bg-teal-50",
    cardBorder: "border-teal-200",
    iconBg: "bg-teal-200",
    iconText: "text-teal-700",
    pillBg: "bg-teal-100",
    pillText: "text-teal-700"
  },
  "전사/공": {
    cardBg: "bg-sky-50",
    cardBorder: "border-sky-200",
    iconBg: "bg-sky-200",
    iconText: "text-sky-700",
    pillBg: "bg-sky-100",
    pillText: "text-sky-700"
  }
};

/** 신규 카테고리 — 동일 문자열은 항상 동일 색 (해시 % 길이) */
const AUTO_CATEGORY_PALETTES: CategoryStyle[] = [
  {
    cardBg: "bg-rose-50",
    cardBorder: "border-rose-200",
    iconBg: "bg-rose-200",
    iconText: "text-rose-700",
    pillBg: "bg-rose-100",
    pillText: "text-rose-700"
  },
  {
    cardBg: "bg-pink-50",
    cardBorder: "border-pink-200",
    iconBg: "bg-pink-200",
    iconText: "text-pink-700",
    pillBg: "bg-pink-100",
    pillText: "text-pink-700"
  },
  {
    cardBg: "bg-lime-50",
    cardBorder: "border-lime-200",
    iconBg: "bg-lime-200",
    iconText: "text-lime-700",
    pillBg: "bg-lime-100",
    pillText: "text-lime-700"
  },
  {
    cardBg: "bg-emerald-50",
    cardBorder: "border-emerald-200",
    iconBg: "bg-emerald-200",
    iconText: "text-emerald-700",
    pillBg: "bg-emerald-100",
    pillText: "text-emerald-700"
  },
  {
    cardBg: "bg-cyan-50",
    cardBorder: "border-cyan-200",
    iconBg: "bg-cyan-200",
    iconText: "text-cyan-700",
    pillBg: "bg-cyan-100",
    pillText: "text-cyan-700"
  },
  {
    cardBg: "bg-sky-50",
    cardBorder: "border-sky-200",
    iconBg: "bg-sky-200",
    iconText: "text-sky-700",
    pillBg: "bg-sky-100",
    pillText: "text-sky-700"
  },
  {
    cardBg: "bg-violet-50",
    cardBorder: "border-violet-200",
    iconBg: "bg-violet-200",
    iconText: "text-violet-700",
    pillBg: "bg-violet-100",
    pillText: "text-violet-700"
  },
  {
    cardBg: "bg-fuchsia-50",
    cardBorder: "border-fuchsia-200",
    iconBg: "bg-fuchsia-200",
    iconText: "text-fuchsia-700",
    pillBg: "bg-fuchsia-100",
    pillText: "text-fuchsia-700"
  },
  {
    cardBg: "bg-amber-50",
    cardBorder: "border-amber-200",
    iconBg: "bg-amber-200",
    iconText: "text-amber-700",
    pillBg: "bg-amber-100",
    pillText: "text-amber-700"
  },
  {
    cardBg: "bg-orange-50",
    cardBorder: "border-orange-200",
    iconBg: "bg-orange-200",
    iconText: "text-orange-700",
    pillBg: "bg-orange-100",
    pillText: "text-orange-700"
  }
];

function hashCategoryKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 활성 카드: 카테고리 exact match → 명시 팔레트, 없으면 해시 자동 배색.
 */
function categoryStyleActive(category: string | null | undefined): CategoryStyle {
  const c = (category ?? "").trim();
  if (EXPLICIT_CATEGORY_STYLES[c]) {
    return EXPLICIT_CATEGORY_STYLES[c];
  }
  const key = c || "__empty__";
  const idx = hashCategoryKey(key) % AUTO_CATEGORY_PALETTES.length;
  return AUTO_CATEGORY_PALETTES[idx];
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

function licenseRecentSortMs(row: License): number {
  return new Date(row.updated_at ?? row.created_at).getTime();
}

export default function LicensesListPage() {
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
          .order("updated_at", { ascending: false }),
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

  const canCreateResult = useCanCreateLicense();
  const canCreate = canCreateResult ?? false;

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
      list.sort((a, b) => licenseCostSortValue(b, rates) - licenseCostSortValue(a, rates));
    } else {
      list.sort((a, b) => licenseRecentSortMs(b) - licenseRecentSortMs(a));
    }
    return list;
  }, [filtered, sortBy, rates]);

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">라이선스별</h1>
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((row) => {
            const inactive = row.status === "비활성";
            const style = inactive ? INACTIVE_STYLE : categoryStyleActive(row.category);
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
            const bc = computeLicenseCostBreakdown(row, rates);
            const primaryKrw = licenseListCardPrimaryKrwAmount(bc);
            const primaryOrig = licenseListCardPrimaryOrigAmount(bc);
            const suffix = licenseCostSuffix(bc.uiContract);
            const badgeLabel = licenseListCostBadgeLabel(bc.uiContract);
            const sub = licenseListCardCostSublineParts(bc);
            const hasForeign = !bc.isKrw && (currency === "USD" || currency === "EUR");
            const sublineText =
              sub.show && sub.krwPerPart != null && bc.isKrw
                ? `${formatCurrency(sub.krwPerPart)}${sub.suffix ?? ""} × ${sub.krwCount}개`
                : sub.show && sub.origPerPart != null && sub.origCount != null
                  ? `${formatOriginalCurrency(sub.origPerPart, currency)}${sub.suffix ?? ""} × ${sub.origCount}개`
                  : null;

            return (
              <li key={row.id}>
                <Link
                  href={`/licenses/${row.id}`}
                  className={`group flex h-full flex-col rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
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
                      <p
                        className={`truncate text-sm font-semibold ${
                          inactive ? "text-slate-400" : "text-slate-900 group-hover:text-blue-700"
                        }`}
                      >
                        {row.name}
                      </p>
                      {planSecondary ? (
                        <p
                          className={`mt-0.5 truncate text-xs ${
                            inactive ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {planSecondary}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* 카테고리 + 상태 */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-[11px] font-medium ${
                        inactive ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      {(row.category && row.category.trim()) || "카테고리 미분류"}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-semibold ${
                        inactive ? "text-slate-400" : "text-emerald-700"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>

                  {/* 비용 + 계약유형 pill */}
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      {primaryKrw != null ? (
                        <p
                          className={`text-xl font-bold tabular-nums ${
                            inactive ? "text-slate-400" : "text-slate-900"
                          }`}
                        >
                          {formatCurrency(primaryKrw)}
                          {suffix ? (
                            <span
                              className={`ml-0.5 text-sm font-semibold ${
                                inactive ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              {suffix}
                            </span>
                          ) : null}
                        </p>
                      ) : (
                        <p
                          className={`text-xl font-bold tabular-nums ${
                            inactive ? "text-slate-400" : "text-slate-900"
                          }`}
                        >
                          {formatOriginalCurrency(primaryOrig, currency)}
                          {suffix ? (
                            <span
                              className={`ml-0.5 text-sm font-semibold ${
                                inactive ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              {suffix}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {sublineText ? (
                        <p
                          className={`mt-0.5 text-[11px] tabular-nums ${
                            inactive ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {sublineText}
                        </p>
                      ) : null}
                      {hasForeign && primaryKrw != null ? (
                        <p
                          className={`mt-0.5 text-[11px] tabular-nums ${
                            inactive ? "text-slate-400" : "text-slate-500"
                          }`}
                        >
                          {formatOriginalCurrency(bc.rawCost, currency)}
                          {suffix}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.pillBg} ${style.pillText}`}
                    >
                      {badgeLabel}
                    </span>
                  </div>

                  {/* 메타 */}
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-medium tabular-nums ${
                          inactive ? "text-slate-400" : "text-slate-700"
                        }`}
                      >
                        {row.license_count > 0 ? `${row.license_count}개 라이선스` : "무제한"}
                      </span>
                      <span
                        className={`truncate text-xs font-medium ${
                          inactive ? "text-slate-400" : "text-slate-700"
                        }`}
                      >
                        {assignee?.name ?? "—"}
                      </span>
                    </div>
                    {nextPaymentLabel ? (
                      <div className="mt-2 flex items-center justify-between border-t border-slate-200/60 pt-2 text-[11px]">
                        <span className={inactive ? "text-slate-400" : "text-slate-500"}>다음 결제일</span>
                        <span
                          className={`text-[11px] font-medium tabular-nums ${
                            inactive
                              ? "text-slate-400"
                              : nextPaymentDiff != null && nextPaymentDiff <= 7
                                ? "text-amber-600"
                                : "text-slate-700"
                          }`}
                        >
                          {nextPaymentLabel}
                          {nextPaymentDiff != null ? (
                            <span
                              className={`ml-1.5 text-[11px] font-medium ${
                                inactive ? "text-slate-400 opacity-80" : "opacity-80"
                              }`}
                            >
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
