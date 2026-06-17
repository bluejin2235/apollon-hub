import { resolveUiContractType } from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";
import { supabase } from "@/lib/supabase/client";

export type ServiceChangeType = "created" | "updated";

export type ServiceChangedField = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

export type ServiceChangeSnapshot = {
  name: string;
  plan: string;
  cost: number;
  currency: string;
  license_count: number;
  contract_type: string;
  payment_day: number | null;
  payment_month: number | null;
  category: string;
  status: string;
  notes: string | null;
  purpose: string | null;
};

const TRACKED_FIELDS: { field: keyof ServiceChangeSnapshot; label: string }[] = [
  { field: "name", label: "서비스명" },
  { field: "plan", label: "플랜" },
  { field: "cost", label: "비용" },
  { field: "currency", label: "통화" },
  { field: "license_count", label: "수량" },
  { field: "contract_type", label: "계약유형" },
  { field: "payment_day", label: "결제일" },
  { field: "payment_month", label: "결제월" },
  { field: "category", label: "카테고리" },
  { field: "status", label: "상태" },
  { field: "notes", label: "메모" },
  { field: "purpose", label: "사용목적" }
];

function parseDescField(description: string | null | undefined, key: string): string | null {
  if (!description) return null;
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = description.match(re);
  return m ? m[1].trim() : null;
}

function parseDescMemoBlock(description: string | null | undefined): string | null {
  if (!description) return null;
  const lines = description.split("\n");
  const nextFieldRe = /^(사용목적|결제방법|메모|시작일):\s/;
  const start = lines.findIndex((l) => l.startsWith("메모:"));
  if (start < 0) return null;
  const first = lines[start].replace(/^메모:\s*/, "");
  const parts: string[] = [first];
  for (let i = start + 1; i < lines.length; i++) {
    if (nextFieldRe.test(lines[i])) break;
    parts.push(lines[i]);
  }
  const joined = parts.join("\n").trim();
  return joined || null;
}

function formatCostValue(cost: number, currency: string): string {
  const cur = currency.trim() || "KRW";
  if (cur === "USD") {
    return `$${cost.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  if (cur === "EUR") {
    return `€${cost.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return `₩${cost.toLocaleString("ko-KR")}`;
}

function formatLicenseCount(count: number): string {
  return count > 0 ? String(count) : "무제한";
}

function formatFieldDisplayValue(
  field: keyof ServiceChangeSnapshot,
  value: unknown,
  snapshot: ServiceChangeSnapshot
): string {
  if (value == null || value === "") return "—";
  switch (field) {
    case "cost":
      return formatCostValue(Number(value), snapshot.currency);
    case "license_count":
      return formatLicenseCount(Number(value));
    case "payment_day":
      return `${value}일`;
    case "payment_month":
      return `${value}월`;
    default:
      return String(value);
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.009;
  }
  return String(a ?? "").trim() === String(b ?? "").trim();
}

export function buildServiceChangeSnapshot(license: License): ServiceChangeSnapshot {
  const purpose =
    (license.purpose && license.purpose.trim()) ||
    parseDescField(license.description, "사용목적") ||
    null;
  const notes =
    (license.memo && license.memo.trim()) || parseDescMemoBlock(license.description) || null;

  return {
    name: license.name.trim(),
    plan: (license.plan ?? "").trim(),
    cost: Number(license.cost ?? license.cost_monthly ?? 0),
    currency: license.currency ?? "KRW",
    license_count: license.license_count ?? 0,
    contract_type: resolveUiContractType(license),
    payment_day: license.payment_day ?? null,
    payment_month: license.payment_month ?? null,
    category: (license.category ?? "").trim(),
    status: license.status === "비활성" ? "비활성" : "활성",
    notes,
    purpose
  };
}

export function detectChangedFields(
  before: ServiceChangeSnapshot,
  after: ServiceChangeSnapshot
): ServiceChangedField[] {
  const changes: ServiceChangedField[] = [];

  for (const { field, label } of TRACKED_FIELDS) {
    const beforeValue = before[field];
    const afterValue = after[field];
    if (valuesEqual(beforeValue, afterValue)) continue;

    changes.push({
      field,
      label,
      before: formatFieldDisplayValue(field, beforeValue, before),
      after: formatFieldDisplayValue(field, afterValue, after)
    });
  }

  return changes;
}

export async function insertServiceChangeLog(input: {
  serviceId: string;
  changedBy: string;
  changeType: ServiceChangeType;
  changedFields: ServiceChangedField[] | null;
}): Promise<void> {
  const { error } = await supabase.from("service_change_logs").insert({
    service_id: input.serviceId,
    changed_by: input.changedBy,
    change_type: input.changeType,
    changed_fields: input.changedFields
  });

  if (error) {
    console.error("[service_change_logs] insert failed", error);
  }
}
