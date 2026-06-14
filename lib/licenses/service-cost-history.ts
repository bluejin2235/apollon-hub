import type { ContractType, License } from "@/lib/licenses/types";
import { resolveUiContractType } from "@/lib/licenses/calc";
import type { SupabaseClient } from "@supabase/supabase-js";

export function currentRecordedMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shouldRecordCostHistory(
  prev: License | null,
  next: {
    cost: number;
    license_count: number;
    contract_type: ContractType;
  }
): boolean {
  if (!prev) return true;
  const prevCost = Number(prev.cost ?? prev.cost_monthly ?? 0);
  const prevLc = prev.license_count ?? 0;
  const prevContract = resolveUiContractType(prev);
  return (
    Math.abs(prevCost - next.cost) > 0.009 ||
    prevLc !== next.license_count ||
    prevContract !== next.contract_type
  );
}

function computeCostMonthlyKrw(
  service: Pick<
    License,
    "cost" | "cost_monthly" | "currency" | "license_count" | "contract_type" | "cost_type"
  >,
  usdKrw?: number,
  eurKrw?: number
): number | null {
  const costMonthly = Number(service.cost_monthly ?? service.cost ?? 0);
  const licenseCount = service.license_count ?? 0;
  let total = costMonthly * licenseCount;
  if (resolveUiContractType(service) === "년 구독") {
    total /= 12;
  }

  const currency = (service.currency ?? "KRW").toUpperCase();
  if (currency === "KRW") return total;
  if (currency === "USD") {
    if (usdKrw == null || !Number.isFinite(usdKrw)) return null;
    return total * usdKrw;
  }
  if (currency === "EUR") {
    if (eurKrw == null || !Number.isFinite(eurKrw)) return null;
    return total * eurKrw;
  }
  return total;
}

export async function insertServiceCostHistory(
  client: SupabaseClient,
  service: Pick<
    License,
    | "id"
    | "cost"
    | "cost_monthly"
    | "currency"
    | "license_count"
    | "contract_type"
    | "cost_type"
    | "category"
  >,
  activeMemberCount: number,
  usdKrw?: number,
  eurKrw?: number
): Promise<void> {
  const costNum = Number(service.cost ?? service.cost_monthly ?? 0);
  const costMonthly = Number(service.cost_monthly ?? service.cost ?? 0);
  const category =
    service.category != null && String(service.category).trim().length > 0
      ? String(service.category).trim()
      : null;
  const costMonthlyKrw = computeCostMonthlyKrw(service, usdKrw, eurKrw);

  const { error } = await client.from("service_cost_history").insert({
    service_id: service.id,
    cost: costNum,
    cost_monthly: costMonthly,
    cost_monthly_krw: costMonthlyKrw,
    currency: service.currency ?? "KRW",
    license_count: service.license_count ?? 0,
    contract_type: resolveUiContractType(service),
    category,
    active_member_count: activeMemberCount,
    recorded_month: currentRecordedMonth()
  });
  if (error) {
    console.error("[service_cost_history] insert failed", error);
  }
}
