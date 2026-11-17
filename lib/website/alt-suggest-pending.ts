"use client";

import type { AltSuggestResult } from "@/lib/website/alt-suggest-types";

export type PendingAltValue = AltSuggestResult | "loading" | "failed";

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

export function subscribePendingAlt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
