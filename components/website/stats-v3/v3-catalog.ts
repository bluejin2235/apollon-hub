"use client";

import { useEffect, useState } from "react";

import { listInsights, listWorks } from "@/lib/website/api";
import type { InsightListItem, WorkListItem } from "@/lib/website/types";

export type V3Catalog = { works: WorkListItem[]; insights: InsightListItem[] };

/** 글 목록 상태. 「새 글」인지 가리는 일은 목록이 준비됐을 때만 한다 */
export type CatalogState = "loading" | "ready" | "error";

/** 워크·인사이트 목록: 제목 붙이기 · 「새 글」 판정. 기간과 상관없어 화면을 열 때 한 번 읽는다 */
export function useV3Catalog(enabled: boolean): { catalog: V3Catalog | null; state: CatalogState } {
  const [catalog, setCatalog] = useState<V3Catalog | null>(null);
  const [state, setState] = useState<CatalogState>("loading");

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.all([
      listWorks({ status: "all", limit: 200 }),
      listInsights({ status: "all", limit: 200 })
    ]).then(
      ([works, insights]) => {
        if (!live) return;
        if (!works.ok || !insights.ok) {
          setState("error");
          return;
        }
        setCatalog({ works: works.data.items, insights: insights.data.items });
        setState("ready");
      },
      () => {
        if (live) setState("error");
      }
    );
    return () => {
      live = false;
    };
  }, [enabled]);

  return { catalog, state };
}
