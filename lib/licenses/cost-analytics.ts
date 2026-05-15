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

export const COST_METRIC_LABELS: Record<CostMetricKey, string> = {
  subscription: "월 구독 합계",
  perpetual: "월 영구구매 합계",
  members: "월 팀원 수",
  perMember: "1인당 비용",
  byCategory: "카테고리별"
};

export type CategoryBreakdown = Record<string, { subscriptionKrw: number; perpetualKrw: number }>;

export type LicenseBreakdownEntry = {
  name: string;
  category: string;
  contractType: string;
  subscriptionKrw: number;
  perpetualKrw: number;
};

export type LicenseBreakdown = Record<string, LicenseBreakdownEntry>;

export type MonthlyCostSnapshotRow = {
  id: string;
  snapshot_month: string;
  total_subscription_krw: number;
  total_permanent_krw: number;
  active_member_count: number;
  per_member_cost_krw: number;
  category_breakdown: CategoryBreakdown | null;
  license_breakdown: LicenseBreakdown | null;
};

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

function passesContractFilter(ui: ContractType, filter: CostContractFilter): boolean {
  if (filter === "전체") return true;
  return ui === filter;
}

export function filterActiveServices(
  services: License[],
  filters: CostFilters
): License[] {
  return services.filter((s) => {
    if (s.status !== "활성") return false;
    if ((s as License & { is_hub_card?: boolean }).is_hub_card) return false;
    const cat = (s.category ?? "").trim() || "카테고리 미분류";
    if (filters.category !== "전체" && cat !== filters.category) return false;
    if (filters.serviceId !== "전체" && s.id !== filters.serviceId) return false;
    if (!passesContractFilter(resolveUiContractType(s), filters.contractType)) return false;
    return true;
  });
}

export function computeMonthAggregate(
  services: License[],
  profiles: Profile[],
  rates: LicenseFxRates,
  filters: CostFilters
): Omit<MonthCostRow, "month" | "label" | "isCurrent"> {
  const filtered = filterActiveServices(services, filters);
  const memberCount = activeProfiles(profiles).length;
  let subscriptionKrw = 0;
  let perpetualTotal = 0;
  const byCategory: CategoryBreakdown = {};

  for (const s of filtered) {
    const b = computeLicenseCostBreakdown(s, rates);
    const sub = monthlyKrw(b);
    const perp = perpetualKrw(b);
    subscriptionKrw += sub;
    perpetualTotal += perp;
    const cat = (s.category ?? "").trim() || "카테고리 미분류";
    if (!byCategory[cat]) byCategory[cat] = { subscriptionKrw: 0, perpetualKrw: 0 };
    byCategory[cat].subscriptionKrw += sub;
    byCategory[cat].perpetualKrw += perp;
  }

  const perMemberKrw = memberCount > 0 ? subscriptionKrw / memberCount : 0;
  return { subscriptionKrw, perpetualKrw: perpetualTotal, memberCount, perMemberKrw, byCategory };
}

export function buildLicenseBreakdown(
  services: License[],
  rates: LicenseFxRates,
  filters: CostFilters
): LicenseBreakdown {
  const out: LicenseBreakdown = {};
  for (const s of filterActiveServices(services, filters)) {
    const b = computeLicenseCostBreakdown(s, rates);
    out[s.id] = {
      name: s.name,
      category: (s.category ?? "").trim() || "카테고리 미분류",
      contractType: resolveUiContractType(s),
      subscriptionKrw: monthlyKrw(b),
      perpetualKrw: perpetualKrw(b)
    };
  }
  return out;
}

function applyFiltersToSnapshot(
  snap: MonthlyCostSnapshotRow,
  filters: CostFilters
): Omit<MonthCostRow, "month" | "label" | "isCurrent"> {
  if (filters.category === "전체" && filters.serviceId === "전체" && filters.contractType === "전체") {
    return {
      subscriptionKrw: Number(snap.total_subscription_krw),
      perpetualKrw: Number(snap.total_permanent_krw),
      memberCount: snap.active_member_count,
      perMemberKrw: Number(snap.per_member_cost_krw),
      byCategory: snap.category_breakdown ?? {}
    };
  }

  const licenseBd = snap.license_breakdown ?? {};
  let subscriptionKrw = 0;
  let perpetualTotal = 0;
  const byCategory: CategoryBreakdown = {};

  for (const [id, entry] of Object.entries(licenseBd)) {
    if (filters.serviceId !== "전체" && id !== filters.serviceId) continue;
    if (filters.category !== "전체" && entry.category !== filters.category) continue;
    if (
      filters.contractType !== "전체" &&
      entry.contractType !== filters.contractType
    ) {
      continue;
    }
    subscriptionKrw += entry.subscriptionKrw;
    perpetualTotal += entry.perpetualKrw;
    if (!byCategory[entry.category]) {
      byCategory[entry.category] = { subscriptionKrw: 0, perpetualKrw: 0 };
    }
    byCategory[entry.category].subscriptionKrw += entry.subscriptionKrw;
    byCategory[entry.category].perpetualKrw += entry.perpetualKrw;
  }

  const memberCount = snap.active_member_count;
  return {
    subscriptionKrw,
    perpetualKrw: perpetualTotal,
    memberCount,
    perMemberKrw: memberCount > 0 ? subscriptionKrw / memberCount : 0,
    byCategory
  };
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
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

export function buildMonthRows(params: {
  months: string[];
  currentYm: string;
  services: License[];
  profiles: Profile[];
  rates: LicenseFxRates;
  filters: CostFilters;
  snapshotsByMonth: Map<string, MonthlyCostSnapshotRow>;
}): MonthCostRow[] {
  const { months, currentYm, services, profiles, rates, filters, snapshotsByMonth } = params;
  return months.map((month) => {
    const isCurrent = month === currentYm;
    let agg: Omit<MonthCostRow, "month" | "label" | "isCurrent">;
    if (isCurrent) {
      agg = computeMonthAggregate(services, profiles, rates, filters);
    } else {
      const snap = snapshotsByMonth.get(month);
      if (snap) {
        agg = applyFiltersToSnapshot(snap, filters);
      } else {
        agg = computeMonthAggregate(services, profiles, rates, filters);
      }
    }
    return {
      month,
      label: monthLabel(month),
      isCurrent,
      ...agg
    };
  });
}

export function pctChange(current: number, previous: number | null): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
