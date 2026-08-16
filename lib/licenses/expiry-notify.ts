import {
  buildHubEmailShell,
  buildInfoTable,
  EMAIL_HEADER_LICENSE,
  escapeHtml,
  KST_OFFSET_MS
} from "@/lib/mail/hub-email";
import {
  computeLicenseCostBreakdown,
  formatCurrency,
  resolveUiContractType
} from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";

export const LICENSE_EXPIRY_FX_RATES = {
  USD: 1525,
  EUR: 1690
} as const;

export const HUB_LICENSES_URL = "https://hub.apollonworks.com/licenses";

export type ExpiryMilestone = "d7" | "d0" | "overdue";

export type ExpiryItem = {
  service: License;
  milestone: ExpiryMilestone;
  daysUntil: number;
  managerNames: string[];
};

export function kstTodayYmd(nowMs = Date.now()): string {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addCalendarDays(ymd: string, days: number): string {
  const dt = new Date(ymdToUtcMs(ymd) + days * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function calendarDaysUntil(endYmd: string, todayYmd: string): number {
  return Math.round((ymdToUtcMs(endYmd) - ymdToUtcMs(todayYmd)) / 86_400_000);
}

export function milestoneForDaysUntil(daysUntil: number): ExpiryMilestone | null {
  if (daysUntil === 7) return "d7";
  if (daysUntil === 0) return "d0";
  if (daysUntil <= -1 && daysUntil >= -7) return "overdue";
  return null;
}

export function formatKoreanMonthDay(ymd: string): string {
  const parts = ymd.slice(0, 10).split("-").map(Number);
  const m = parts[1];
  const d = parts[2];
  return `${m}월 ${d}일`;
}

export function ddayLabel(daysUntil: number): string {
  if (daysUntil > 0) return `D-${daysUntil}`;
  if (daysUntil === 0) return "D-Day";
  return `D+${-daysUntil}`;
}

export function milestonePhrase(milestone: ExpiryMilestone, daysUntil: number): string {
  if (milestone === "d7") return "만료 7일 전";
  if (milestone === "d0") return "오늘 만료";
  return `만료 ${-daysUntil}일 경과`;
}

export function formatLicenseCostLine(service: License): string {
  const breakdown = computeLicenseCostBreakdown(service, LICENSE_EXPIRY_FX_RATES);
  const orig = breakdown.annualTotalOrig;
  const krw = breakdown.annualTotalKrw;
  const currency = breakdown.currency.toUpperCase();

  if (breakdown.isKrw) {
    return formatCurrency(orig);
  }

  const origLabel =
    currency === "USD"
      ? `$${orig.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : currency === "EUR"
        ? `€${orig.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
        : `${orig.toLocaleString("en-US")} ${currency}`;

  if (krw != null) {
    return `${origLabel} (약 ${formatCurrency(krw)})`;
  }
  return origLabel;
}

export function buildExpiryEmailSubject(items: ExpiryItem[]): string {
  if (items.length === 1) {
    const item = items[0];
    const endYmd = item.service.end_date?.slice(0, 10) ?? "";
    return `[아폴론 허브] ${item.service.name} ${milestonePhrase(item.milestone, item.daysUntil)} (${formatKoreanMonthDay(endYmd)})`;
  }
  return `[아폴론 허브] 라이선스 만료 알림 — ${items[0].service.name} 외 ${items.length - 1}건`;
}

export function buildExpiryEmailHtml(items: ExpiryItem[]): string {
  const first = items[0];
  const title =
    items.length === 1
      ? `${first.service.name} ${milestonePhrase(first.milestone, first.daysUntil)}`
      : `라이선스 만료 알림 ${items.length}건`;
  const subtitle =
    items.length === 1
      ? `${formatKoreanMonthDay(first.service.end_date?.slice(0, 10) ?? "")} · ${ddayLabel(first.daysUntil)}`
      : "오늘 알림 대상 라이선스를 확인하세요.";

  const bodyHtml = items
    .map((item) => {
      const endYmd = item.service.end_date?.slice(0, 10) ?? "";
      const contractType = resolveUiContractType(item.service);
      const table = buildInfoTable([
        { label: "서비스명", value: item.service.name },
        { label: "계약 유형", value: contractType },
        { label: "만료일", value: `${formatKoreanMonthDay(endYmd)} (${endYmd})` },
        { label: "D-day", value: ddayLabel(item.daysUntil) },
        { label: "비용", value: formatLicenseCostLine(item.service) },
        {
          label: "담당자",
          value: item.managerNames.length > 0 ? item.managerNames.join(", ") : "—"
        }
      ]);
      const heading =
        items.length > 1
          ? `<p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #0C447C;">${escapeHtml(milestonePhrase(item.milestone, item.daysUntil))}</p>`
          : "";
      return `<div style="margin-bottom: 20px;">${heading}${table}</div>`;
    })
    .join("\n");

  return buildHubEmailShell({
    headerBg: EMAIL_HEADER_LICENSE,
    headerLabel: "LICENSE MANAGER · 만료 알림",
    title,
    subtitle,
    bodyHtml,
    cta: { href: HUB_LICENSES_URL, label: "라이선스 매니저에서 보기" }
  });
}

export function buildExpiryInAppCopy(items: ExpiryItem[]): { title: string; body: string } {
  if (items.length === 1) {
    const item = items[0];
    const endYmd = item.service.end_date?.slice(0, 10) ?? "";
    return {
      title: `${item.service.name} ${milestonePhrase(item.milestone, item.daysUntil)}`,
      body: `만료일 ${formatKoreanMonthDay(endYmd)} · ${ddayLabel(item.daysUntil)} · ${formatLicenseCostLine(item.service)}`
    };
  }
  const names = items.map((i) => i.service.name).join(", ");
  return {
    title: `라이선스 만료 알림 ${items.length}건`,
    body: names
  };
}
