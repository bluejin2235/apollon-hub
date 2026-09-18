import type { SupabaseClient } from "@supabase/supabase-js";
import { addIsoDays, eachIsoDate, kstIsoDate } from "./dates";

export const FX_SOURCE_FRANKFURTER = "frankfurter";
export const FX_SOURCE_ER_API = "open.er-api.com";

const FRANKFURTER = "https://api.frankfurter.app";
const ER_API_USD = "https://open.er-api.com/v6/latest/USD";
const ER_API_EUR = "https://open.er-api.com/v6/latest/EUR";
const RANGE_CHUNK_DAYS = 180;

export type FxFetchRow = {
  date: string;
  usd_krw: number;
  eur_krw: number | null;
  source: string;
};

export type FxFetchResult = {
  upserted: number;
  skipped: number;
  source: string;
  start: string;
  end: string;
  samples: FxFetchRow[];
  errors: string[];
};

type FrankfurterDay = {
  amount?: number;
  base?: string;
  date?: string;
  start_date?: string;
  end_date?: string;
  rates?: Record<string, number | Record<string, number>>;
};

type ErApiResponse = {
  result?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asKrw(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function krwFromRateValue(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asKrw((value as Record<string, number>).KRW);
  }
  return asKrw(value);
}

async function fetchJson(url: string): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}

function splitIsoRange(start: string, end: string, maxDays = RANGE_CHUNK_DAYS): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cur = start;
  while (cur <= end) {
    const proposed = addIsoDays(cur, maxDays - 1);
    const chunkEnd = proposed < end ? proposed : end;
    chunks.push({ start: cur, end: chunkEnd });
    cur = addIsoDays(chunkEnd, 1);
  }
  return chunks;
}

function parseFrankfurterTimeseries(body: FrankfurterDay): Map<string, number> {
  const map = new Map<string, number>();
  for (const [date, value] of Object.entries(body.rates ?? {})) {
    const krw = krwFromRateValue(value);
    if (!krw) continue;
    map.set(date.slice(0, 10), krw);
  }
  return map;
}

function mergeUsdEurMaps(usd: Map<string, number>, eur: Map<string, number>): FxFetchRow[] {
  return [...usd.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      usd_krw: usd.get(date)!,
      eur_krw: eur.get(date) ?? null,
      source: FX_SOURCE_FRANKFURTER
    }));
}

async function fetchFrankfurterKrwMap(
  start: string,
  end: string,
  base: "USD" | "EUR"
): Promise<Map<string, number>> {
  const result = await fetchJson(`${FRANKFURTER}/${start}..${end}?from=${base}&to=KRW`);
  if (!result.ok) {
    throw new Error(`frankfurter range ${base} ${result.status}`);
  }
  return parseFrankfurterTimeseries(result.body as FrankfurterDay);
}

async function fetchFrankfurterKrwDay(
  date: string,
  base: "USD" | "EUR"
): Promise<{ date: string; krw: number } | null> {
  const result = await fetchJson(`${FRANKFURTER}/${date}?from=${base}&to=KRW`);
  if (!result.ok) return null;
  const body = result.body as FrankfurterDay;
  const krw = asKrw(body.rates?.KRW);
  const returned = typeof body.date === "string" ? body.date.slice(0, 10) : date;
  if (!krw || !returned) return null;
  return { date: returned, krw };
}

/** 단건. 주말·공휴일이면 Frankfurter가 직전 영업일 date를 돌려준다. */
export async function fetchFrankfurterDate(date: string): Promise<FxFetchRow | null> {
  const [usd, eur] = await Promise.all([
    fetchFrankfurterKrwDay(date, "USD"),
    fetchFrankfurterKrwDay(date, "EUR")
  ]);
  if (!usd) return null;
  return {
    date: usd.date,
    usd_krw: usd.krw,
    eur_krw: eur?.krw ?? null,
    source: FX_SOURCE_FRANKFURTER
  };
}

/** 기간 조회. 주말·공휴일 키는 응답에 없음. USD/KRW + EUR/KRW. */
export async function fetchFrankfurterRange(start: string, end: string): Promise<FxFetchRow[]> {
  const [usd, eur] = await Promise.all([
    fetchFrankfurterKrwMap(start, end, "USD"),
    fetchFrankfurterKrwMap(start, end, "EUR").catch(() => new Map<string, number>())
  ]);
  return mergeUsdEurMaps(usd, eur);
}

export async function fetchErApiLatest(): Promise<FxFetchRow | null> {
  const [usdRes, eurRes] = await Promise.all([fetchJson(ER_API_USD), fetchJson(ER_API_EUR)]);
  if (!usdRes.ok) return null;
  const usdBody = usdRes.body as ErApiResponse;
  if (usdBody.result && usdBody.result !== "success") return null;
  const usd_krw = asKrw(usdBody.rates?.KRW);
  if (!usd_krw) return null;

  let eur_krw: number | null = null;
  if (eurRes.ok) {
    const eurBody = eurRes.body as ErApiResponse;
    if (!eurBody.result || eurBody.result === "success") {
      eur_krw = asKrw(eurBody.rates?.KRW);
    }
  }

  const unix = usdBody.time_last_update_unix;
  const date =
    typeof unix === "number" && Number.isFinite(unix)
      ? new Date(unix * 1000).toISOString().slice(0, 10)
      : kstIsoDate();
  return { date, usd_krw, eur_krw, source: FX_SOURCE_ER_API };
}

export async function upsertFxRates(
  supabase: SupabaseClient,
  rows: FxFetchRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    date: r.date,
    usd_krw: r.usd_krw,
    eur_krw: r.eur_krw,
    source: r.source,
    created_at: now
  }));
  const { error } = await supabase.from("fx_daily_rates").upsert(payload, { onConflict: "date" });
  if (error) throw new Error(`fx_daily_rates upsert: ${error.message}`);
  return payload.length;
}

async function fetchRangeWithFallback(start: string, end: string): Promise<{
  rows: FxFetchRow[];
  skipped: number;
  errors: string[];
}> {
  try {
    const byDate = new Map<string, FxFetchRow>();
    for (const chunk of splitIsoRange(start, end)) {
      const chunkRows = await fetchFrankfurterRange(chunk.start, chunk.end);
      for (const row of chunkRows) byDate.set(row.date, row);
      await sleep(150);
    }
    const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const calendar = eachIsoDate(start, end).length;
    return { rows, skipped: Math.max(0, calendar - rows.length), errors: [] };
  } catch (e) {
    const errors = [e instanceof Error ? e.message : String(e)];
    const rows: FxFetchRow[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    for (const date of eachIsoDate(start, end)) {
      try {
        const row = await fetchFrankfurterDate(date);
        if (!row) {
          skipped += 1;
        } else if (!seen.has(row.date)) {
          seen.add(row.date);
          rows.push(row);
        }
      } catch (dayErr) {
        skipped += 1;
        errors.push(`${date}: ${dayErr instanceof Error ? dayErr.message : String(dayErr)}`);
      }
      await sleep(120);
    }
    return { rows, skipped, errors };
  }
}

export async function backfillFxRates(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<FxFetchResult> {
  const { rows, skipped, errors } = await fetchRangeWithFallback(start, end);
  const upserted = await upsertFxRates(supabase, rows);
  const samples = [
    ...rows.slice(0, 3),
    ...(rows.length > 6 ? rows.slice(-3) : rows.slice(3))
  ];
  return {
    upserted,
    skipped,
    source: FX_SOURCE_FRANKFURTER,
    start,
    end,
    samples,
    errors
  };
}

/** 어제(KST) 1건. 주말이면 Frankfurter가 직전 영업일로 치환. 실패 시 er-api. */
export async function fetchDailyFxRate(supabase: SupabaseClient): Promise<FxFetchResult> {
  const yesterday = addIsoDays(kstIsoDate(), -1);
  const errors: string[] = [];
  let row: FxFetchRow | null = null;
  try {
    row = await fetchFrankfurterDate(yesterday);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  if (!row) {
    try {
      row = await fetchErApiLatest();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (!row) {
    return {
      upserted: 0,
      skipped: 1,
      source: FX_SOURCE_FRANKFURTER,
      start: yesterday,
      end: yesterday,
      samples: [],
      errors: errors.length > 0 ? errors : [`no rate for ${yesterday}`]
    };
  }

  const upserted = await upsertFxRates(supabase, [row]);
  return {
    upserted,
    skipped: 0,
    source: row.source,
    start: row.date,
    end: row.date,
    samples: [row],
    errors
  };
}

export async function resolveUsageBackfillRange(
  supabase: SupabaseClient,
  lookbackDays = 14
): Promise<{ start: string; end: string; usageMin: string | null }> {
  const { data, error } = await supabase
    .from("api_usage")
    .select("date")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`api_usage min date: ${error.message}`);
  const usageMin =
    typeof data?.date === "string" ? data.date.slice(0, 10) : null;
  const end = kstIsoDate();
  const start = usageMin ? addIsoDays(usageMin, -lookbackDays) : addIsoDays(end, -lookbackDays);
  return { start, end, usageMin };
}
