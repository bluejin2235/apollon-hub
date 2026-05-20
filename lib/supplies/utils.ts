import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import type { LoanStatus, Supply, SupplyStatus, StatusFilterLabel, ZoneFilter } from "@/lib/supplies/types";

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "슈퍼관리자";
}

/** 반납예정일 등 날짜만 — 예: 2026. 05. 20. */
export function formatSupplyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso.includes("T") ? iso : `${iso.slice(0, 10)}T12:00:00`);
    return format(d, "yyyy. MM. dd.", { locale: ko });
  } catch {
    return iso.slice(0, 10);
  }
}

/** 대출·반납 시각 — 예: 2026. 05. 20. 14:32 */
export function formatSupplyDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "yyyy. MM. dd. HH:mm", { locale: ko });
  } catch {
    return iso;
  }
}

export function loanStatusBadge(status: LoanStatus): { label: string; className: string } {
  switch (status) {
    case "active":
      return { label: "대출중", className: "bg-amber-100 text-amber-800" };
    case "overdue":
      return { label: "연체", className: "bg-rose-100 text-rose-800" };
    case "returned":
      return { label: "반납완료", className: "bg-emerald-100 text-emerald-800" };
    default:
      return { label: status, className: "bg-slate-100 text-slate-700" };
  }
}

export function loanDday(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  try {
    return differenceInCalendarDays(parseISO(dueDate.slice(0, 10)), today);
  } catch {
    return 0;
  }
}

export function loanDdayLabel(dueDate: string): { text: string; overdue: boolean } {
  const d = loanDday(dueDate);
  if (d < 0) return { text: "연체", overdue: true };
  if (d === 0) return { text: "D-day", overdue: true };
  return { text: `D-${d}`, overdue: false };
}

export function effectiveLoanStatus(loan: {
  status: LoanStatus;
  due_date: string;
  returned_at: string | null;
}): LoanStatus {
  if (loan.returned_at) return "returned";
  if (loan.status === "returned") return "returned";
  const { overdue } = loanDdayLabel(loan.due_date);
  if (overdue && loan.status === "active") return "overdue";
  return loan.status;
}

export function statusFilterToSupplyStatus(label: StatusFilterLabel): SupplyStatus | null {
  if (label === "대출가능") return "available";
  if (label === "대출중") return "borrowed";
  if (label === "점검중") return "maintenance";
  return null;
}

export function matchesZoneFilter(category: string, zone: ZoneFilter): boolean {
  if (zone === "전체") return true;
  return category.trim().toUpperCase() === zone;
}

export function supplyStatusBadge(status: SupplyStatus): { label: string; className: string } {
  switch (status) {
    case "available":
      return { label: "대출가능", className: "bg-emerald-100 text-emerald-800" };
    case "borrowed":
      return { label: "대출중", className: "bg-amber-100 text-amber-800" };
    case "maintenance":
      return { label: "점검중", className: "bg-slate-200 text-slate-700" };
    default:
      return { label: status, className: "bg-slate-100 text-slate-700" };
  }
}

export function itemStatusLabel(status: string): string {
  if (status === "lost") return "분실";
  if (status === "damaged") return "파손";
  return "정상";
}

export function categoryPlaceholder(category: string): string {
  const c = category.trim().toUpperCase() || "?";
  const colors: Record<string, string> = {
    A: "bg-violet-100 text-violet-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-cyan-100 text-cyan-700",
    D: "bg-emerald-100 text-emerald-700",
    E: "bg-amber-100 text-amber-800",
    F: "bg-rose-100 text-rose-700"
  };
  return colors[c] ?? "bg-slate-100 text-slate-600";
}

export function deriveSupplyStatus(availableQty: number, quantity: number, current: SupplyStatus): SupplyStatus {
  if (current === "maintenance") return "maintenance";
  if (availableQty <= 0) return "borrowed";
  if (availableQty >= quantity) return "available";
  return "borrowed";
}

export function supplyDetailUrl(code: string): string {
  return `/supplies/${encodeURIComponent(code)}`;
}

export function supplyPublicUrl(code: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}${supplyDetailUrl(code)}`;
  }
  return supplyDetailUrl(code);
}
