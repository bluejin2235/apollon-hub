import type { LoanStatus, SupplyStatus } from "@/lib/supplies/types";

export type ComponentRow = { name: string; qty: number };

export function emptyComponentRow(): ComponentRow {
  return { name: "", qty: 1 };
}

/** "충전기:1,케이블:2" 형식으로 직렬화 */
export function serializeComponents(rows: ComponentRow[]): string | null {
  const parts = rows
    .map((r) => ({ name: r.name.trim(), qty: Math.max(1, Number(r.qty) || 1) }))
    .filter((r) => r.name.length > 0)
    .map((r) => `${r.name}:${r.qty}`);
  return parts.length > 0 ? parts.join(",") : null;
}

/** 저장 문자열 → 행 목록 (상세/수정 폼용) */
export function parseComponents(value: string | null | undefined): ComponentRow[] {
  if (!value?.trim()) return [emptyComponentRow()];
  const rows = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.lastIndexOf(":");
      if (colon <= 0) return { name: part, qty: 1 };
      const name = part.slice(0, colon).trim();
      const qty = parseInt(part.slice(colon + 1), 10);
      return { name, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
    });
  return rows.length > 0 ? rows : [emptyComponentRow()];
}

const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function formatKoreanDate(d: Date): string {
  const parts = dateFmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}. ${m}. ${day}.`;
}

function formatKoreanDateTime(d: Date): string {
  const parts = dateTimeFmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const min = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${y}. ${m}. ${day}. ${h}:${min}`;
}

export function formatSupplyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.includes("T") ? iso : `${iso.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return formatKoreanDate(d);
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatSupplyDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return formatKoreanDateTime(d);
  } catch {
    return iso;
  }
}

export function supplyStatusBadge(status: SupplyStatus): { label: string; className: string } {
  switch (status) {
    case "available":
      return { label: "대출가능", className: "bg-emerald-100 text-emerald-800" };
    case "borrowed":
      return { label: "대출중", className: "bg-amber-100 text-amber-800" };
    case "partially_borrowed":
      return { label: "부분대출가능", className: "bg-blue-100 text-blue-800" };
    case "unavailable":
      return { label: "사용불가", className: "bg-rose-100 text-rose-800" };
    default:
      return { label: status, className: "bg-slate-100 text-slate-700" };
  }
}

export function loanStatusLabel(status: LoanStatus): string {
  return status === "returned" ? "반납완료" : "대출중";
}

export function supplyDetailPath(id: string): string {
  return `/supplies/${id}`;
}

export function supplyLoanPath(id: string): string {
  return `/supplies/${id}/loan`;
}

export function supplyReturnPath(id: string): string {
  return `/supplies/${id}/return`;
}

export function imagePublicUrls(paths: string[]): string[] {
  if (!paths?.length) return [];
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return paths;
  return paths.map((p) =>
    p.startsWith("http") ? p : `${base}/storage/v1/object/public/supply-images/${p}`
  );
}
