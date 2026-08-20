/**
 * api_usage 전체 cost_krw 재계산.
 * usd_krw_rate = getRateForDate(date)  (전일 이전 가장 최근 확정 환율)
 * cost_krw = round(cost_usd * usd_krw_rate)
 *
 * 확인 후에만 실행:
 *   npx tsx scripts/rebuild-api-usage-cost-krw.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { getRatesForDates, USD_KRW_FALLBACK } from "../lib/fx/get-rate-for-date";

const PAGE = 1000;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 필요");
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const rows: {
    id: string;
    provider: string;
    date: string;
    cost_usd: number;
    usd_krw_rate: number | null;
    cost_krw: number | null;
  }[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("api_usage")
      .select("id, provider, date, cost_usd, usd_krw_rate, cost_krw")
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) {
      rows.push({
        id: String(r.id),
        provider: String(r.provider ?? ""),
        date: String(r.date).slice(0, 10),
        cost_usd: Number(r.cost_usd) || 0,
        usd_krw_rate: r.usd_krw_rate == null ? null : Number(r.usd_krw_rate),
        cost_krw: r.cost_krw == null ? null : Number(r.cost_krw)
      });
    }
    if (data.length < PAGE) break;
  }

  const dates = rows.map((r) => r.date).sort();
  const sumByProvider = (pick: (r: (typeof rows)[number]) => number) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.provider, (map.get(r.provider) ?? 0) + pick(r));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, cost_krw]) => ({ provider, cost_krw: Math.round(cost_krw) }));
  };

  const beforeUsd = rows.reduce((s, r) => s + r.cost_usd, 0);
  const beforeKrw = rows.reduce((s, r) => s + (r.cost_krw ?? 0), 0);
  const beforeByProvider = sumByProvider((r) => r.cost_krw ?? 0);
  console.log("[rebuild-cost-krw] before", {
    rows: rows.length,
    date_min: dates[0] ?? null,
    date_max: dates[dates.length - 1] ?? null,
    cost_usd: beforeUsd,
    cost_krw: Math.round(beforeKrw),
    by_provider: beforeByProvider
  });

  const rateMap = await getRatesForDates(
    admin,
    rows.map((r) => r.date)
  );

  let updated = 0;
  let missingRate = 0;
  const afterById = new Map<string, number>();

  for (const row of rows) {
    const rate = rateMap.get(row.date);
    const usd_krw_rate = rate ?? USD_KRW_FALLBACK;
    if (rate == null) missingRate += 1;
    const cost_krw = Math.round(row.cost_usd * usd_krw_rate);
    afterById.set(row.id, cost_krw);
    const { error } = await admin
      .from("api_usage")
      .update({ usd_krw_rate, cost_krw })
      .eq("id", row.id);
    if (error) throw new Error(`${row.id}: ${error.message}`);
    updated += 1;
  }

  const afterKrw = rows.reduce((s, r) => s + (afterById.get(r.id) ?? 0), 0);
  const afterByProvider = sumByProvider((r) => afterById.get(r.id) ?? 0);
  console.log("[rebuild-cost-krw] after", {
    updated,
    missingRate,
    fallback: USD_KRW_FALLBACK,
    cost_usd: beforeUsd,
    cost_krw: afterKrw,
    delta_krw: afterKrw - Math.round(beforeKrw),
    by_provider: afterByProvider
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
