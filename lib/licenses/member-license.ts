import {
  computeLicenseCostBreakdown,
  licenseListCostBadgeLabel,
  resolveUiContractType,
  type LicenseFxRates
} from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";

/** 무제한(license_count 0) = 전체 멤버 공유 라이선스 */
export function isCommonSharedLicense(l: Pick<License, "license_count">): boolean {
  return (l.license_count ?? 0) === 0;
}

export function isActiveLicense(l: Pick<License, "status">): boolean {
  return l.status === "활성";
}

export type MemberLicenseCostView = {
  breakdown: ReturnType<typeof computeLicenseCostBreakdown>;
  /** 구독 월 환산 (개당, 직접 할당) */
  directMonthlyKrw: number | null;
  /** 구독 월 환산 (1/N, 공통) */
  commonShareMonthlyKrw: number | null;
  contractLabel: string;
  contractBadgeClass: string;
};

export function buildMemberLicenseCostView(
  license: License,
  rates: LicenseFxRates,
  memberCount: number
): MemberLicenseCostView {
  const b = computeLicenseCostBreakdown(license, rates);
  const ui = resolveUiContractType(license);
  const label = licenseListCostBadgeLabel(ui);

  let contractBadgeClass = "bg-slate-100 text-slate-600";
  let contractLabel = label;
  if (b.isPerpetual) {
    contractBadgeClass = "bg-slate-100 text-slate-600";
    contractLabel = "영구";
  } else if (b.isMonthly) {
    contractLabel = "월간 구독";
  } else if (b.isYearly) {
    contractLabel = "연간 구독";
  }

  const directMonthlyKrw = b.isPerpetual ? null : b.perUnitMonthlyKrw;
  const commonShareMonthlyKrw =
    b.isPerpetual || memberCount <= 0 || b.monthlyTotalKrw == null
      ? null
      : b.monthlyTotalKrw / memberCount;

  return {
    breakdown: b,
    directMonthlyKrw,
    commonShareMonthlyKrw,
    contractLabel,
    contractBadgeClass
  };
}

export function partitionMemberLicenses(
  allServices: License[],
  directServiceIds: Set<string>
): { direct: License[]; common: License[] } {
  const direct: License[] = [];
  const common: License[] = [];

  for (const s of allServices) {
    if (!isActiveLicense(s)) continue;
    if (directServiceIds.has(s.id)) {
      direct.push(s);
      continue;
    }
    if (isCommonSharedLicense(s)) {
      common.push(s);
    }
  }

  const byName = (a: License, b: License) => a.name.localeCompare(b.name, "ko");
  direct.sort(byName);
  common.sort(byName);
  return { direct, common };
}
