"use client";

import { useEffect, useMemo, useState } from "react";

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
