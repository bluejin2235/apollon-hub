"use client";

import { useEffect, useState } from "react";

/** open.er-api.com 응답의 통화 → KRW 비율 */
export type KrwRates = {
  /** 1 USD 가 몇 KRW 인지 */
  USD: number;
  /** 1 EUR 가 몇 KRW 인지 */
  EUR: number;
  /** ISO date (YYYY-MM-DD) — 일자 캐싱 키 */
  date: string;
};

const STORAGE_KEY = "apollon.fx.krw";
const API_BASE = "https://open.er-api.com/v6/latest";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): KrwRates | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KrwRates>;
    if (
      parsed &&
      typeof parsed.USD === "number" &&
      typeof parsed.EUR === "number" &&
      typeof parsed.date === "string" &&
      parsed.date === todayKey()
    ) {
      return parsed as KrwRates;
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

function writeCache(rates: KrwRates): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
  } catch {
    /* ignore quota errors */
  }
}

type EndpointResponse = {
  result?: string;
  rates?: Record<string, number>;
};

async function fetchKrwForBase(base: "USD" | "EUR"): Promise<number | null> {
  const res = await fetch(`${API_BASE}/${base}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as EndpointResponse;
  if (body?.result && body.result !== "success") return null;
  const krw = body?.rates?.KRW;
  return typeof krw === "number" && Number.isFinite(krw) ? krw : null;
}

/**
 * USD/EUR → KRW 환율을 가져오는 훅.
 * - 당일 캐시(localStorage) 있으면 즉시 반환.
 * - 캐시 없으면 백그라운드로 fetch 후 state 갱신.
 * - 실패 시 `null` 그대로 유지 (UI 는 환산 없이 원본만 표시하도록 폴백).
 */
export function useKrwRates(): KrwRates | null {
  const [rates, setRates] = useState<KrwRates | null>(() => readCache());

  useEffect(() => {
    if (rates) return;
    let cancelled = false;
    (async () => {
      try {
        const [usd, eur] = await Promise.all([fetchKrwForBase("USD"), fetchKrwForBase("EUR")]);
        if (cancelled) return;
        if (usd != null && eur != null) {
          const fresh: KrwRates = { USD: usd, EUR: eur, date: todayKey() };
          writeCache(fresh);
          setRates(fresh);
        }
      } catch (e) {
        console.error("[fx] failed to fetch rates", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rates]);

  return rates;
}
