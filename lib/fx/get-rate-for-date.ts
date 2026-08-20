import type { SupabaseClient } from "@supabase/supabase-js";

export const USD_KRW_FALLBACK = 1380;

export type FxRateHit = {
  date: string;
  usd_krw: number;
};

function toHit(row: { date: unknown; usd_krw: unknown }): FxRateHit | null {
  const usd_krw = Number(row.usd_krw);
  if (!Number.isFinite(usd_krw)) return null;
  const date = typeof row.date === "string" ? row.date.slice(0, 10) : null;
  if (!date) return null;
  return { date, usd_krw };
}

/**
 * `date` 당일 환율이 아니라, 전일부터 거슬러 올라가 가장 최근 확정 usd_krw.
 * 주말·공휴일로 전일 행이 없으면 그 이전 영업일을 쓴다.
 */
export async function findPrevConfirmedRate(
  supabase: SupabaseClient,
  date: string
): Promise<FxRateHit | null> {
  const { data, error } = await supabase
    .from("fx_daily_rates")
    .select("date, usd_krw")
    .lt("date", date)
    .not("usd_krw", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[fx] getRateForDate", date, error);
    return null;
  }
  if (!data) return null;
  return toHit(data);
}

/** 해당 날짜의 전일 이전 가장 최근 usd_krw. 없으면 null. */
export async function getRateForDate(
  supabase: SupabaseClient,
  date: string
): Promise<number | null> {
  const hit = await findPrevConfirmedRate(supabase, date);
  return hit?.usd_krw ?? null;
}

export async function getRateForDateOrFallback(
  supabase: SupabaseClient,
  date: string
): Promise<number> {
  return (await getRateForDate(supabase, date)) ?? USD_KRW_FALLBACK;
}

/** CSV 등 여러 날짜를 한 번에 조회. 키 = 사용일, 값 = 전일 이전 확정 환율. */
export async function getRatesForDates(
  supabase: SupabaseClient,
  dates: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  const map = new Map<string, number>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from("fx_daily_rates")
    .select("date, usd_krw")
    .not("usd_krw", "is", null)
    .order("date", { ascending: true });

  if (error) {
    console.error("[fx] getRatesForDates", error);
    return map;
  }

  const rows: FxRateHit[] = [];
  for (const row of data ?? []) {
    const hit = toHit(row);
    if (hit) rows.push(hit);
  }

  for (const date of unique) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date < date) {
        map.set(date, rows[i].usd_krw);
        break;
      }
    }
  }
  return map;
}
