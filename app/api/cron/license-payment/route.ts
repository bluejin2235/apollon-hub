import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { KST_OFFSET_MS, toKstDateString } from "@/lib/mail/hub-email";
import { resolveUiContractType } from "@/lib/licenses/calc";
import type { License } from "@/lib/licenses/types";

const FX_FALLBACK = { USD: 1525, EUR: 1690 } as const;
const API_BASE = "https://open.er-api.com/v6/latest";

type EndpointResponse = {
  result?: string;
  rates?: Record<string, number>;
};

type KstToday = {
  month: number;
  day: number;
  recordedMonth: string;
  date: string;
};

function getKstToday(): KstToday {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth() + 1;
  const day = kstNow.getUTCDate();
  return {
    month,
    day,
    recordedMonth: `${y}-${String(month).padStart(2, "0")}`,
    date: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

async function fetchKrwForBase(base: "USD" | "EUR"): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/${base}`, { cache: "no-store" });
    if (!res.ok) return FX_FALLBACK[base];
    const body = (await res.json()) as EndpointResponse;
    if (body?.result && body.result !== "success") return FX_FALLBACK[base];
    const krw = body?.rates?.KRW;
    return typeof krw === "number" && Number.isFinite(krw) ? krw : FX_FALLBACK[base];
  } catch (e) {
    console.error(`[license-payment] fx fetch failed (${base})`, e);
    return FX_FALLBACK[base];
  }
}

function isPaymentDueToday(service: License, kst: KstToday): boolean {
  const paymentDay = service.payment_day;
  if (paymentDay == null || paymentDay < 1 || paymentDay > 31) return false;
  if (paymentDay !== kst.day) return false;

  const contractType = resolveUiContractType(service);
  if (contractType === "월 구독") return true;
  if (contractType === "년 구독") {
    const paymentMonth = service.payment_month;
    return paymentMonth != null && paymentMonth >= 1 && paymentMonth <= 12 && paymentMonth === kst.month;
  }
  return false;
}

function computePaymentCostMonthlyKrw(
  service: License,
  usdKrw: number,
  eurKrw: number
): { costMonthlyKrw: number; fxRate: number | null } {
  const licenseCount = service.license_count ?? 0;
  const isYearly = resolveUiContractType(service) === "년 구독";
  const currency = (service.currency ?? "KRW").toUpperCase();

  let total: number;
  let fxRate: number | null = null;

  if (currency === "KRW") {
    total = Number(service.cost_monthly ?? service.cost ?? 0) * licenseCount;
  } else if (currency === "USD") {
    fxRate = usdKrw;
    total = Number(service.cost ?? service.cost_monthly ?? 0) * licenseCount * usdKrw;
  } else if (currency === "EUR") {
    fxRate = eurKrw;
    total = Number(service.cost ?? service.cost_monthly ?? 0) * licenseCount * eurKrw;
  } else {
    total = Number(service.cost_monthly ?? service.cost ?? 0) * licenseCount;
  }

  if (isYearly) total /= 12;

  return { costMonthlyKrw: total, fxRate };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[license-payment] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    console.error("[license-payment] Supabase env vars missing");
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  const kst = getKstToday();
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [servicesRes, profilesRes, usdKrw, eurKrw] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("is_hub_card", false)
      .eq("status", "활성")
      .in("contract_type", ["월 구독", "년 구독"]),
    supabase.from("profiles").select("id").eq("status", "근무"),
    fetchKrwForBase("USD"),
    fetchKrwForBase("EUR")
  ]);

  if (servicesRes.error) {
    console.error("[license-payment] services fetch failed", servicesRes.error);
    return NextResponse.json({ error: servicesRes.error.message }, { status: 500 });
  }

  const activeMemberCount = profilesRes.data?.length ?? 0;
  const services = (servicesRes.data ?? []) as License[];

  let processed = 0;
  let skipped = 0;
  const errors: { serviceId: string; error: string }[] = [];

  for (const service of services) {
    if (!isPaymentDueToday(service, kst)) {
      skipped += 1;
      continue;
    }

    const costNum = Number(service.cost ?? service.cost_monthly ?? 0);
    const costMonthly = Number(service.cost_monthly ?? service.cost ?? 0);
    const category =
      service.category != null && String(service.category).trim().length > 0
        ? String(service.category).trim()
        : null;
    const { costMonthlyKrw, fxRate } = computePaymentCostMonthlyKrw(service, usdKrw, eurKrw);

    const { error } = await supabase.from("service_cost_history").insert({
      service_id: service.id,
      cost: costNum,
      cost_monthly: costMonthly,
      cost_monthly_krw: costMonthlyKrw,
      currency: service.currency ?? "KRW",
      license_count: service.license_count ?? 0,
      contract_type: resolveUiContractType(service),
      category,
      active_member_count: activeMemberCount,
      recorded_month: kst.recordedMonth,
      record_type: "payment",
      fx_rate: fxRate
    });

    if (error) {
      console.error("[license-payment] insert failed", { serviceId: service.id, error });
      errors.push({ serviceId: service.id, error: error.message });
      continue;
    }

    processed += 1;
    console.log("[license-payment] recorded", {
      serviceId: service.id,
      name: service.name,
      costMonthlyKrw,
      fxRate,
      date: kst.date
    });
  }

  console.log("[license-payment] done", {
    date: kst.date,
    dateLabel: toKstDateString(),
    processed,
    skipped,
    errors: errors.length
  });

  return NextResponse.json({
    success: errors.length === 0,
    date: kst.date,
    processed,
    skipped,
    errors
  });
}
