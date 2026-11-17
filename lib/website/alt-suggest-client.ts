"use client";

import { isPlaceholderAlt } from "@/lib/website/placeholder-alt";
import type { AltSuggestContext, AltSuggestResult } from "@/lib/website/alt-suggest-types";

export type { AltSuggestContext, AltSuggestResult };

export type AltSuggestStatus = "idle" | "loading" | "filled" | "failed" | "kept";

type QueueItem = {
  run: () => Promise<void>;
};

const queue: QueueItem[] = [];
let active = 0;
const MAX_PARALLEL = 3;

function pumpQueue() {
  while (active < MAX_PARALLEL && queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    active += 1;
    void next.run().finally(() => {
      active -= 1;
      pumpQueue();
    });
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: async () => {
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        }
      }
    });
    pumpQueue();
  });
}

export function shouldAutoFillAlt(ko: string | null | undefined): boolean {
  return isPlaceholderAlt(ko);
}

export async function requestAltSuggest(opts: {
  imageUrl: string;
  context: AltSuggestContext;
}): Promise<AltSuggestResult | null> {
  return enqueue(async () => {
    const res = await fetch("/api/website/alt-suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: opts.imageUrl,
        context: opts.context
      })
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const data = rec?.data;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as { ko?: unknown }).ko === "string" &&
      typeof (data as { en?: unknown }).en === "string"
    ) {
      const ko = (data as { ko: string }).ko.trim();
      const en = (data as { en: string }).en.trim();
      if (ko && en) return { ko, en };
    }
    return null;
  });
}

/** 절대 URL이 아니면 siteUrl 기준으로 붙인다 */
export function resolveImageUrlForAlt(
  siteUrl: string | undefined,
  src: string | null | undefined
): string | null {
  if (!src?.trim()) return null;
  if (/^https?:\/\//i.test(src)) return src.trim();
  const base = (siteUrl || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}
