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

export function nextRenewalDate(licenses: License[]): string | null {
  const dates = licenses.map((l) => l.next_renewal).filter(Boolean) as string[];
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
