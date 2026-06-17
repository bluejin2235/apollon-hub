/**
 * service_cost_history payment 백필 (1회성)
 *
 * 실행: node scripts/backfill-cost-history.mjs
 * (.env.local — NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY)
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FX_FALLBACK = { USD: 1380, EUR: 1520 };
const FX_API = "https://api.frankfurter.dev/v1";
const ACTIVE_MEMBER_COUNT = 11;
const INSERT_DELAY_MS = 100;

/** @type {Map<string, number>} */
const fxCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getKstToday() {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth() + 1;
  const day = kstNow.getUTCDate();
  return {
    y,
    month,
    day,
    date: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

/** YYYY-MM-DD (KST 달력 기준, 말일 클램프) */
function buildKstDateString(y, month1, day) {
  const lastDay = new Date(y, month1, 0).getDate();
  const d = Math.min(Math.max(1, day), lastDay);
  return `${y}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toRecordedMonth(dateStr) {
  return dateStr.slice(0, 7);
}

function toRecordedAtIso(dateStr) {
  return `${dateStr}T00:00:00+09:00`;
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @param {"USD"|"EUR"} base
 */
async function fetchFxRate(dateStr, base) {
  const key = `${dateStr}_${base}`;
  const cached = fxCache.get(key);
  if (cached != null) return cached;

  try {
    const res = await fetch(`${FX_API}/${dateStr}?base=${base}&symbols=KRW`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const krw = body?.rates?.KRW;
    if (typeof krw !== "number" || !Number.isFinite(krw)) throw new Error("KRW rate missing");
    fxCache.set(key, krw);
    return krw;
  } catch (e) {
    console.warn(`[backfill] fx fetch failed ${base}@${dateStr}, using fallback`, e?.message ?? e);
    const fallback = FX_FALLBACK[base];
    fxCache.set(key, fallback);
    return fallback;
  }
}

/**
 * @param {Record<string, unknown>} service
 * @param {number} usdKrw
 * @param {number} eurKrw
 */
function computeCostMonthlyKrw(service, usdKrw, eurKrw) {
  const licenseCount = Number(service.license_count ?? 0);
  const isYearly = service.contract_type === "년 구독";
  const cost = Number(service.cost ?? service.cost_monthly ?? 0);
  const currency = String(service.currency ?? "KRW").toUpperCase();

  let total;
  /** @type {number|null} */
  let fxRate = null;

  if (currency === "USD") {
    fxRate = usdKrw;
    total = cost * licenseCount * usdKrw;
  } else if (currency === "EUR") {
    fxRate = eurKrw;
    total = cost * licenseCount * eurKrw;
  } else {
    total = cost * licenseCount;
  }

  if (isYearly) total /= 12;

  return { costMonthlyKrw: total, fxRate };
}

/**
 * @param {Record<string, unknown>} service
 * @param {{ date: string }} todayKst
 * @returns {string[]}
 */
function monthlyPaymentDates(service, todayKst) {
  const paymentDay = service.payment_day;
  if (paymentDay == null || paymentDay < 1 || paymentDay > 31) return [];

  const startIso = typeof service.start_date === "string" ? service.start_date.slice(0, 10) : "";
  if (!startIso) return [];

  const dates = [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const endY = todayKst.y;
  const endM = todayKst.month;

  while (y < endY || (y === endY && m <= endM)) {
    const dateStr = buildKstDateString(y, m, Number(paymentDay));
    if (dateStr >= startIso && dateStr <= todayKst.date) {
      dates.push(dateStr);
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return dates;
}

/**
 * @param {Record<string, unknown>} service
 * @param {{ date: string }} todayKst
 * @returns {string[]}
 */
function yearlyPaymentDates(service, todayKst) {
  const startIso = typeof service.start_date === "string" ? service.start_date.slice(0, 10) : "";
  if (!startIso) return [];

  const startMonth = Number(startIso.slice(5, 7));
  const startDay = Number(startIso.slice(8, 10));
  const month =
    service.payment_month != null && service.payment_month >= 1 && service.payment_month <= 12
      ? Number(service.payment_month)
      : startMonth;
  const day =
    service.payment_day != null && service.payment_day >= 1 && service.payment_day <= 31
      ? Number(service.payment_day)
      : startDay;

  const dates = [];
  if (startIso <= todayKst.date) dates.push(startIso);

  let y = Number(startIso.slice(0, 4)) + 1;
  while (true) {
    const dateStr = buildKstDateString(y, month, day);
    if (dateStr > todayKst.date) break;
    dates.push(dateStr);
    y += 1;
  }

  return dates;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 .env.local 에 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const todayKst = getKstToday();
  console.log("[backfill] KST today:", todayKst.date);

  const [servicesRes, paymentsRes] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, status, contract_type, cost, cost_monthly, currency, license_count, payment_day, payment_month, start_date, is_hub_card, category"
      )
      .eq("status", "활성")
      .in("contract_type", ["월 구독", "년 구독"])
      .or("is_hub_card.eq.false,is_hub_card.is.null"),
    supabase.from("service_cost_history").select("service_id, recorded_month").eq("record_type", "payment")
  ]);

  if (servicesRes.error) {
    console.error("[backfill] services fetch failed", servicesRes.error);
    process.exit(1);
  }
  if (paymentsRes.error) {
    console.error("[backfill] payment history fetch failed", paymentsRes.error);
    process.exit(1);
  }

  /** @type {Set<string>} */
  const existingKeys = new Set(
    (paymentsRes.data ?? []).map((row) => `${row.service_id}_${row.recorded_month}`)
  );

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  /** @type {Map<string, { inserted: number; skipped: number }>} */
  const byService = new Map();

  for (const service of servicesRes.data ?? []) {
    const name = String(service.name ?? service.id);
    if (!byService.has(name)) byService.set(name, { inserted: 0, skipped: 0 });

    const stat = byService.get(name);
    const paymentDates =
      service.contract_type === "년 구독"
        ? yearlyPaymentDates(service, todayKst)
        : monthlyPaymentDates(service, todayKst);

    if (paymentDates.length === 0) {
      console.log(`[backfill] skip (no payment dates): ${name}`);
      continue;
    }

    for (const dateStr of paymentDates) {
      const recordedMonth = toRecordedMonth(dateStr);
      const dedupeKey = `${service.id}_${recordedMonth}`;

      if (existingKeys.has(dedupeKey)) {
        stat.skipped += 1;
        totalSkipped += 1;
        continue;
      }

      const currency = String(service.currency ?? "KRW").toUpperCase();
      const usdKrw = currency === "USD" ? await fetchFxRate(dateStr, "USD") : FX_FALLBACK.USD;
      const eurKrw = currency === "EUR" ? await fetchFxRate(dateStr, "EUR") : FX_FALLBACK.EUR;

      if (currency === "USD" || currency === "EUR") {
        await sleep(INSERT_DELAY_MS);
      }

      const cost = Number(service.cost ?? service.cost_monthly ?? 0);
      const { costMonthlyKrw, fxRate } = computeCostMonthlyKrw(service, usdKrw, eurKrw);
      const category =
        service.category != null && String(service.category).trim().length > 0
          ? String(service.category).trim()
          : null;

      const { error } = await supabase.from("service_cost_history").insert({
        service_id: service.id,
        cost,
        cost_monthly: cost,
        cost_monthly_krw: Math.round(costMonthlyKrw),
        currency: service.currency ?? "KRW",
        license_count: service.license_count ?? 0,
        contract_type: service.contract_type,
        record_type: "payment",
        recorded_month: recordedMonth,
        recorded_at: toRecordedAtIso(dateStr),
        fx_rate: fxRate,
        active_member_count: ACTIVE_MEMBER_COUNT,
        category
      });

      await sleep(INSERT_DELAY_MS);

      if (error) {
        console.error(`[backfill] insert failed ${name} ${dateStr}:`, error.message);
        totalErrors += 1;
        continue;
      }

      existingKeys.add(dedupeKey);
      stat.inserted += 1;
      totalInserted += 1;
      console.log(`[backfill] inserted ${name} ${dateStr} (${recordedMonth}) krw=${Math.round(costMonthlyKrw)}`);
    }
  }

  console.log("\n========== 서비스별 ==========");
  for (const [name, { inserted, skipped }] of byService.entries()) {
    if (inserted === 0 && skipped === 0) continue;
    console.log(`  ${name}: inserted=${inserted}, skipped=${skipped}`);
  }

  console.log("\n========== 합계 ==========");
  console.log(`  INSERT: ${totalInserted}`);
  console.log(`  SKIP:   ${totalSkipped}`);
  console.log(`  ERROR:  ${totalErrors}`);
  console.log(`  FX cache entries: ${fxCache.size}`);
}

main().catch((e) => {
  console.error("[backfill] fatal", e);
  process.exit(1);
});
