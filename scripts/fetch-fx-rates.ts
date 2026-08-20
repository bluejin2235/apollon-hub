/**
 * USD/KRW 일별 환율 수집 → fx_daily_rates upsert.
 *
 *   npx tsx scripts/fetch-fx-rates.ts
 *   npx tsx scripts/fetch-fx-rates.ts --from=2026-04-01 --to=2026-08-20
 *   npx tsx scripts/fetch-fx-rates.ts --daily
 *
 * 기본(인자 없음): api_usage 최소일 14일 전부터 오늘(KST)까지 Frankfurter 백필.
 * 주말·공휴일은 API에 없으면 건너뛰고, 조회 시 직전 영업일 환율을 쓴다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import {
  backfillFxRates,
  fetchDailyFxRate,
  resolveUsageBackfillRange
} from "../lib/fx/fetch-rates";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

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

  if (hasFlag("daily")) {
    const result = await fetchDailyFxRate(admin);
    console.log("[fetch-fx-rates] daily", result);
    return;
  }

  const fromArg = argValue("from");
  const toArg = argValue("to");
  let start = fromArg;
  let end = toArg;
  let usageMin: string | null = null;

  if (!start || !end) {
    const range = await resolveUsageBackfillRange(admin);
    start = start ?? range.start;
    end = end ?? range.end;
    usageMin = range.usageMin;
  }

  if (!start || !end || start > end) {
    console.error("날짜 범위가 올바르지 않습니다", { start, end });
    process.exit(1);
  }

  console.log("[fetch-fx-rates] backfill", { start, end, usageMin });
  const result = await backfillFxRates(admin, start, end);
  console.log("[fetch-fx-rates] done", {
    upserted: result.upserted,
    skipped: result.skipped,
    source: result.source,
    start: result.start,
    end: result.end,
    errors: result.errors
  });
  console.log("[fetch-fx-rates] samples");
  for (const row of result.samples) {
    console.log(`  ${row.date}  ${row.usd_krw}  ${row.source}`);
  }

  const { count } = await admin
    .from("fx_daily_rates")
    .select("date", { count: "exact", head: true });
  const { data: bounds } = await admin
    .from("fx_daily_rates")
    .select("date, usd_krw, source")
    .order("date", { ascending: true });
  const first = bounds?.[0];
  const last = bounds?.[bounds.length - 1];
  console.log("[fetch-fx-rates] table", {
    rows: count,
    min: first?.date ?? null,
    max: last?.date ?? null
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
