"use client";

import { useEffect, useState } from "react";

import { listInsights, listWorks } from "@/lib/website/api";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";

export type V3Catalog = { works: WorkListItem[]; insights: InsightListItem[] };

/** 워크·인사이트 목록 — 제목 붙이기 · 「새 글」 판정. 기간과 상관없어 화면을 열 때 한 번 읽는다 */
export function useV3Catalog(enabled: boolean): V3Catalog | null {
  const [catalog, setCatalog] = useState<V3Catalog | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.all([
      listWorks({ status: "all", limit: 200 }),
      listInsights({ status: "all", limit: 200 })
    ]).then(([works, insights]) => {
      if (!live || !works.ok || !insights.ok) return;
      setCatalog({ works: works.data.items, insights: insights.data.items });
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  return catalog;
}
