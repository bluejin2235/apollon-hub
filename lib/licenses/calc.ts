import type { License, Profile } from "@/lib/licenses/types";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(
    value
  );
}

export function formatDateKorean(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR");
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T12:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const ms = target - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isSubscription(costType: License["cost_type"]): boolean {
  return costType === "월간" || costType === "연간";
}

export function activeProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.status === "근무");
}

export function aggregateByCategory(licenses: License[]): Record<string, number> {
  const m: Record<string, number> = {};
  licenses.forEach((l) => {
    m[l.category] = (m[l.category] ?? 0) + l.license_count;
  });
  return m;
}

export const categoryChartColors: Record<string, string> = {
  기본: "#4f76ff",
  SaaS: "#7c9dff",
  인프라: "#3558db",
  기타: "#a9c3ff"
};

/**
 * payment_day / payment_month 를 기반으로 오늘 이후 가장 가까운 결제일을 계산.
 * - 월 구독: payment_day 만 사용. 이번 달 해당일이 오늘 이후면 그날, 아니면 다음 달.
 * - 년 구독: payment_month + payment_day. 올해 해당일이 오늘 이후면 올해, 아니면 내년.
 * - 영구 라이선스 / 데이터 부족 시 null.
 * 월 마지막 날 보정(예: 2월 30일 → 2월 말일)도 수행한다.
 */
export function computeNextPayment(
  contractType: string | null | undefined,
  paymentDay: number | null | undefined,
  paymentMonth: number | null | undefined,
  reference: Date = new Date()
): Date | null {
  if (paymentDay == null || paymentDay < 1 || paymentDay > 31) return null;

  const today = new Date(reference);
  today.setHours(12, 0, 0, 0);

  const buildDate = (year: number, month0: number, day: number): Date => {
    // Date 생성자는 day overflow 시 다음 달로 넘어가므로 같은 달 보장을 위해 보정
    const candidate = new Date(year, month0, day, 12, 0, 0, 0);
    if (candidate.getMonth() !== ((month0 % 12) + 12) % 12) {
      // overflow → 의도한 달의 말일로 클램프
      return new Date(year, month0 + 1, 0, 12, 0, 0, 0);
    }
    return candidate;
  };

  if (contractType === "월 구독") {
    const thisMonth = buildDate(today.getFullYear(), today.getMonth(), paymentDay);
    if (thisMonth.getTime() >= today.getTime()) return thisMonth;
    return buildDate(today.getFullYear(), today.getMonth() + 1, paymentDay);
  }

  if (contractType === "년 구독") {
    if (paymentMonth == null || paymentMonth < 1 || paymentMonth > 12) return null;
    const thisYear = buildDate(today.getFullYear(), paymentMonth - 1, paymentDay);
    if (thisYear.getTime() >= today.getTime()) return thisYear;
    return buildDate(today.getFullYear() + 1, paymentMonth - 1, paymentDay);
  }

  return null;
}

/** Date → 'YYYY-MM-DD' (로컬 기준). 다른 ISO 변환과 안전하게 비교하기 위함. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextRenewalDate(licenses: License[]): string | null {
  // payment_day / payment_month 기반 계산이 1순위. 둘 다 없으면 레거시 컬럼 폴백.
  const dates: string[] = [];
  for (const l of licenses) {
    const computed = computeNextPayment(l.contract_type, l.payment_day, l.payment_month);
    if (computed) {
      dates.push(toIsoDate(computed));
      continue;
    }
    if (l.next_renewal) dates.push(l.next_renewal);
  }
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

export function totalActiveSubscriptionMonthly(licenses: License[]): number {
  return licenses.filter((l) => isSubscription(l.cost_type)).reduce((s, l) => s + Number(l.cost_monthly || 0), 0);
}

export function totalPerpetualPurchase(licenses: License[]): number {
  return licenses
    .filter((l) => l.cost_type === "영구")
    .reduce((s, l) => s + Number(l.cost_monthly || 0), 0);
}
