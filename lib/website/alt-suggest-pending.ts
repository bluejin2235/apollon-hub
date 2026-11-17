"use client";

import type { AltSuggestResult } from "@/lib/website/alt-suggest-types";

export type PendingAltBefore = { ko: string; en: string };

export type PendingAltValue =
  | { status: "loading"; koBefore: string; enBefore: string }
  | { status: "failed" }
  | {
      status: "ready";
      ko: string;
      en: string;
      koBefore: string;
      enBefore: string;
    };

const pending = new Map<string, PendingAltValue>();
const listeners = new Set<() => void>();

function normalizeSrc(src: string): string {
  return src.trim().replace(/\/$/, "");
}

function notify() {
  for (const listener of listeners) listener();
}

export function setPendingAlt(src: string, value: PendingAltValue | null) {
  const key = normalizeSrc(src);
  if (!key) return;
  if (value == null) pending.delete(key);
  else pending.set(key, value);
  notify();
}

export function getPendingAlt(src: string): PendingAltValue | undefined {
  return pending.get(normalizeSrc(src));
}

export function clearPendingAlt(src: string) {
  setPendingAlt(src, null);
}

/** 자동 채우기 요청 시작 — 이때의 국·영을 적용 직전 비교에 쓴다 */
export function beginPendingAlt(src: string, before: PendingAltBefore) {
  setPendingAlt(src, {
    status: "loading",
    koBefore: before.ko,
    enBefore: before.en
  });
}

/** 응답 도착 — loading 때 저장한 before 를 결과에 붙인다 */
export function finishPendingAlt(src: string, result: AltSuggestResult | null) {
  const prev = getPendingAlt(src);
  const koBefore =
    prev && prev.status !== "failed" ? prev.koBefore : "";
  const enBefore =
    prev && prev.status !== "failed" ? prev.enBefore : "";
  if (!result) {
    setPendingAlt(src, { status: "failed" });
    return;
  }
  setPendingAlt(src, {
    status: "ready",
    ko: result.ko,
    en: result.en,
    koBefore,
    enBefore
  });
}

export function subscribePendingAlt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
