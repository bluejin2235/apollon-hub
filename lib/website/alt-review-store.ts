"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  altReviewStorageKey,
  parseAltReviewRecord,
  type AltReviewRecord
} from "@/lib/website/alt-review";

/**
 * 대표 이미지 설명 확인 필요 기록 — 이 브라우저에 남긴다(새로고침해도 유지).
 * 홈페이지 쪽 저장 형식은 바꾸지 않기 위해 서버에는 보내지 않는다.
 */

const cache = new Map<string, AltReviewRecord | null>();
const listeners = new Set<() => void>();

function readStorage(key: string): AltReviewRecord | null {
  try {
    return parseAltReviewRecord(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function getRecord(key: string): AltReviewRecord | null {
  if (typeof window === "undefined") return null;
  if (!cache.has(key)) cache.set(key, readStorage(key));
  return cache.get(key) ?? null;
}

export function setAltReviewRecord(
  kind: "work" | "insight",
  contentId: string,
  record: AltReviewRecord | null
) {
  const key = altReviewStorageKey(kind, contentId);
  cache.set(key, record);
  try {
    if (record) window.localStorage.setItem(key, JSON.stringify(record));
    else window.localStorage.removeItem(key);
  } catch {
    // 저장이 막힌 브라우저 — 이 화면에서만 유지
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith("hub.website.keyAltReview.")) return;
    cache.delete(e.key);
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** 대표 이미지 설명 확인 필요 기록을 읽고 바꾼다 */
export function useKeyAltReview(kind: "work" | "insight", contentId: string | null | undefined) {
  const key = contentId ? altReviewStorageKey(kind, contentId) : "";
  const record = useSyncExternalStore(
    subscribe,
    () => (key ? getRecord(key) : null),
    () => null
  );
  const setRecord = useCallback(
    (next: AltReviewRecord | null) => {
      if (!contentId) return;
      setAltReviewRecord(kind, contentId, next);
    },
    [kind, contentId]
  );
  return [record, setRecord] as const;
}
