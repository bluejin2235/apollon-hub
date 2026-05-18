import {
  activeProfiles,
  computeLicenseCostBreakdown,
  resolveUiContractType,
  type LicenseFxRates
} from "@/lib/licenses/calc";
import type { ContractType, License, Profile } from "@/lib/licenses/types";

export type CostContractFilter = "전체" | ContractType;

export type CostMetricKey =
  | "subscription"
  | "perpetual"
  | "members"
  | "perMember"
  | "byCategory";

/** 비용 현황 표시·집계 최소 월 (이전 데이터 미표시) */
export const COST_ANALYTICS_MIN_MONTH = "2026-04";

export const COST_METRIC_LABELS: Record<CostMetricKey, string> = {
  subscription: "월 구독 합계",
  perpetual: "월 영구구매 합계",
  members: "월 팀원 수",
  perMember: "1인당 비용",
  byCategory: "카테고리별"
};

export type CategoryBreakdown = Record<string, { subscriptionKrw: number; perpetualKrw: number }>;

export type MonthCostRow = {
  month: string;
  label: string;
  subscriptionKrw: number;
  perpetualKrw: number;
  memberCount: number;
  perMemberKrw: number;
  byCategory: CategoryBreakdown;
  isCurrent: boolean;
};

export type CostFilters = {
  category: string;
  serviceId: string;
  contractType: CostContractFilter;
};

/** @deprecated 스냅샷 테이블 타입 — 페이지 호환용 */
export type MonthlyCostSnapshotRow = {
  id: string;
  snapshot_month: string;
  total_subscription_krw: number;
  total_permanent_krw: number;
  active_member_count: number;
  per_member_cost_krw: number;
  category_breakdown: CategoryBreakdown | null;
  license_breakdown: Record<string, unknown> | null;
};

/** @deprecated 이력 테이블 타입 — 페이지 호환용 */
export type ServiceCostHistoryRow = {
  service_id: string;
  recorded_month: string;
  contract_type: string | null;
  cost: number | null;
  cost_monthly: number | null;
  currency: string | null;
  license_count: number | null;
};

function monthlyKrw(b: ReturnType<typeof computeLicenseCostBreakdown>): number {
  if (b.isPerpetual) return 0;
  if (b.monthlyTotalKrw != null) return b.monthlyTotalKrw;
  if (b.isKrw) return b.monthlyTotalOrig;
  return 0;
}

function perpetualKrw(b: ReturnType<typeof computeLicenseCostBreakdown>): number {
  if (!b.isPerpetual) return 0;
  if (b.perpetualTotalKrw != null) return b.perpetualTotalKrw;
  if (b.isKrw) return b.perpetualTotalOrig;
  return 0;
}

function isPerpetualContract(ui: ContractType): boolean {
  return ui === "영구 라이선스";
}

function passesContractFilter(ui: ContractType, filter: CostContractFilter): boolean {
  if (filter === "전체") return true;
  return ui === filter;
}

function toYearMonth(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7);
}

/** 시작 월: start_date → purchase_date → created_at */
export function licenseStartMonth(s: License): string | null {
  return (
    toYearMonth(s.start_date) ??
    toYearMonth(s.purchase_date) ??
    toYearMonth(s.created_at)
  );
}

/**
 * 비활성 서비스: `updated_at` 월부터 비용 제외.
 * updated_at 없으면 비활성 상태면 어떤 월에도 구독 비용 미포함(구매월 영구만 별도).
 */
function licenseInactiveFromMonth(s: License, currentYm: string): string | null {
  if (s.status !== "비활성") return null;
  return toYearMonth(s.updated_at) ?? currentYm;
}

function mergeCategoryBreakdown(
  target: CategoryBreakdown,
  cat: string,
  sub: number,
  perp: number
): void {
  if (!target[cat]) target[cat] = { subscriptionKrw: 0, perpetualKrw: 0 };
  target[cat].subscriptionKrw += sub;
  target[cat].perpetualKrw += perp;
}

/** UI 필터만 적용 (현재 status 로 제외하지 않음 — 월별 활성 기간으로 판단) */
export function filterServicesForCost(services: License[], filters: CostFilters): License[] {
  return services.filter((s) => {
    if ((s as License & { is_hub_card?: boolean }).is_hub_card) return false;
    const cat = (s.category ?? "").trim() || "카테고리 미분류";
    if (filters.category !== "전체" && cat !== filters.category) return false;
    if (filters.serviceId !== "전체" && s.id !== filters.serviceId) return false;
    if (!passesContractFilter(resolveUiContractType(s), filters.contractType)) return false;
    return true;
  });
}

/**
 * 해당 월(YYYY-MM)에 라이선스가 비용 집계 대상인지.
 * - 구독: 활성 기간 내 월
 * - 영구: 구매월(시작월)만
 */
export function isLicenseActiveInMonth(
  s: License,
  monthYm: string,
  currentYm: string
): boolean {
  const startYm = licenseStartMonth(s);
  if (!startYm || monthYm < startYm) return false;

  const inactiveFrom = licenseInactiveFromMonth(s, currentYm);
  if (inactiveFrom && monthYm >= inactiveFrom) return false;

  const ui = resolveUiContractType(s);

  if (isPerpetualContract(ui)) {
    return monthYm === startYm;
  }

  if (ui === "년 구독") {
    const endYm = toYearMonth(s.end_date);
    if (endYm && monthYm > endYm) return false;
    return true;
  }

  // 월 구독: end_date 무시, 시작월 이후 ~ 비활성 전까지
  return true;
}

function computeSingleMonth(
  services: License[],
  monthYm: string,
  profiles: Profile[],
  rates: LicenseFxRates,
  filters: CostFilters,
  currentYm: string
): Omit<MonthCostRow, "month" | "label" | "isCurrent"> {
  let subscriptionKrw = 0;
  let perpetualTotal = 0;
  const byCategory: CategoryBreakdown = {};

  for (const s of filterServicesForCost(services, filters)) {
    if (!isLicenseActiveInMonth(s, monthYm, currentYm)) continue;

    const ui = resolveUiContractType(s);
    const b = computeLicenseCostBreakdown(s, rates);
    const cat = (s.category ?? "").trim() || "카테고리 미분류";

    if (isPerpetualContract(ui)) {
      const perp = perpetualKrw(b);
      perpetualTotal += perp;
      mergeCategoryBreakdown(byCategory, cat, 0, perp);
    } else {
      const sub = monthlyKrw(b);
      subscriptionKrw += sub;
      mergeCategoryBreakdown(byCategory, cat, sub, 0);
    }
  }

  const memberCount = activeProfiles(profiles).length;
  const perMemberKrw = memberCount > 0 ? subscriptionKrw / memberCount : 0;

  return {
    subscriptionKrw,
    perpetualKrw: perpetualTotal,
    memberCount,
    perMemberKrw,
    byCategory
  };
}

/**
 * 월별 비용 행 생성 (라이선스 활성 기간 기준).
 * 각 월에 그 달에 활성이었던 구독만 합산, 영구는 구매월만 합산.
 */
export function buildMonthlyRows(
  services: License[],
  months: string[],
  profiles: Profile[],
  rates: LicenseFxRates,
  filters: CostFilters,
  currentYm: string
): MonthCostRow[] {
  return months.map((month) => {
    const agg = computeSingleMonth(services, month, profiles, rates, filters, currentYm);
    return {
      month,
      label: monthLabel(month),
      isCurrent: month === currentYm,
      ...agg
    };
  });
}

/** @deprecated buildMonthlyRows 사용 권장 */
export function buildMonthRows(params: {
  months: string[];
  currentYm: string;
  services: License[];
  profiles: Profile[];
  rates: LicenseFxRates;
  filters: CostFilters;
  snapshotsByMonth?: Map<string, MonthlyCostSnapshotRow>;
  costHistory?: ServiceCostHistoryRow[];
}): MonthCostRow[] {
  const { months, currentYm, services, profiles, rates, filters } = params;
  return buildMonthlyRows(services, months, profiles, rates, filters, currentYm);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

/** 조회 시작월을 최소 월(2026-04) 이상으로 보정 */
export function clampCostRangeStart(startYm: string): string {
  return startYm < COST_ANALYTICS_MIN_MONTH ? COST_ANALYTICS_MIN_MONTH : startYm;
}

export function listMonthsInRange(startYm: string, endYm: string): string[] {
  const [sy, sm] = startYm.split("-").map(Number);
  const [ey, em] = endYm.split("-").map(Number);
  const months: string[] = [];
  let y = sy;
  let mo = sm;
  while (y < ey || (y === ey && mo <= em)) {
    months.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return months;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function pctChange(current: number, previous: number | null): number | null {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** 전월 대비: 구독 비용 기준, 첫 달만 제외 */
export function canCompareMonthOverMonth(monthIndex: number): boolean {
  return monthIndex > 0;
}
