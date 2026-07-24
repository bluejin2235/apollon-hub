"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export const USD_KRW_FALLBACK = 1380;

const API_URL = "https://open.er-api.com/v6/latest/USD";

type EndpointResponse = {
  result?: string;
  rates?: Record<string, number>;
};

/** 전달(이전 달) 라벨 — 예: "26년 4월 평균" */
export function previousMonthRateLabel(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}년 ${d.getMonth() + 1}월 평균`;
}

export function formatKrw(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
}

async function fetchUsdKrwRate(): Promise<number> {
  const res = await fetch(API_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`환율 API ${res.status}`);
  const body = (await res.json()) as EndpointResponse;
  if (body.result && body.result !== "success") throw new Error("환율 API 실패");
  const krw = body.rates?.KRW;
  if (typeof krw !== "number" || !Number.isFinite(krw)) throw new Error("KRW 환율 없음");
  return krw;
}

/** 결제일 기준 USD→KRW 환율 (usd_krw_rates 테이블 → API → credit_records → fallback) */
export async function fetchUsdKrwRateForDate(dateIso: string): Promise<number> {
  const month = dateIso.slice(0, 7);
  const { data } = await supabase
    .from("usd_krw_rates")
    .select("rate")
    .lte("month", month)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.rate != null && Number.isFinite(Number(data.rate))) {
    return Number(data.rate);
  }

  try {
    return await fetchUsdKrwRate();
  } catch (e) {
    console.error("[arte] fetchUsdKrwRateForDate API failed", e);
  }

  const creditRate = await fetchLatestCreditUsdKrwRate();
  if (creditRate != null) return creditRate;

  return USD_KRW_FALLBACK;
}

/** credit_records 의 가장 최근 usd_krw_rate */
export async function fetchLatestCreditUsdKrwRate(): Promise<number | null> {
  const { data, error } = await supabase
    .from("credit_records")
    .select("usd_krw_rate")
    .not("usd_krw_rate", "is", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[arte] credit_records usd_krw_rate", error);
    return null;
  }
  if (data?.usd_krw_rate != null && Number.isFinite(Number(data.usd_krw_rate))) {
    return Number(data.usd_krw_rate);
  }
  return null;
}

/** 전달 평균 환율(USD→KRW, open.er-api.com, 실패 시 1380) */
export function useUsdKrwForUsage() {
  const [usdKrw, setUsdKrw] = useState(USD_KRW_FALLBACK);
  const [loading, setLoading] = useState(true);
  const monthLabel = useMemo(() => previousMonthRateLabel(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rate = await fetchUsdKrwRate();
        if (!cancelled) setUsdKrw(rate);
      } catch (e) {
        console.error("[arte] USD/KRW rate fetch failed, using fallback", e);
        if (!cancelled) setUsdKrw(USD_KRW_FALLBACK);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { usdKrw, monthLabel, loading };
}
