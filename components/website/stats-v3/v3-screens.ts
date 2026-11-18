/** 통계 다섯 화면 — 주소와 받아 올 자료. 사이드바 「홈페이지 통계」도 이 목록을 쓴다 */

import type { StatsActionsState } from "@/components/website/stats/stats-actions";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import type { V3Catalog } from "@/components/website/stats-v3/v3-catalog";
import type { V3AiDays } from "@/components/website/stats-v3/v3-ai-days";
import type { AiAnswerSummary, StatsBundle } from "@/lib/website/stats";

/** 묶음(bundle) 밖에서 따로 받는 자료. 화면은 받아 오지 않고 그리기만 한다 */
export type V3Extras = {
  /** AI 「답에 씀」 수동 확인 기록 */
  answers: { state: "loading" | "ready" | "none"; summary: AiAnswerSummary | null };
  /** AI 날짜별 — 로봇 · AI 에서 온 방문 (하루씩 따로 받는다) */
  aiDays: V3AiDays;
};

export const EMPTY_EXTRAS: V3Extras = {
  answers: { state: "loading", summary: null },
  aiDays: { state: "off", buckets: [] }
};

/** 화면 부품이 받는 것. 화면은 받아 오지 않고 그리기만 한다 */
export type V3ScreenProps = {
  bundle: StatsBundle | null;
  status: LoadStatus;
  from: string;
  to: string;
  today: string;
  catalog: V3Catalog | null;
  actions: StatsActionsState;
  extras: V3Extras;
};

/** URL 세그먼트와 같다. summary=요약, behavior=방문 패턴 */
export type V3ScreenId = "summary" | "content" | "search" | "ai" | "behavior";

export const V3_SCREENS: { id: V3ScreenId; href: string; label: string; kinds: string[] }[] = [
  {
    id: "summary",
    href: "/website/stats/summary",
    label: "요약",
    kinds: ["daily", "channel", "page", "query", "landing_channel", "ai_visits"]
  },
  {
    id: "content",
    href: "/website/stats/content",
    label: "콘텐츠",
    kinds: ["daily", "page", "landing", "landing_channel", "ai_visits", "page_engagement", "query_page"]
  },
  {
    id: "search",
    href: "/website/stats/search",
    label: "검색",
    kinds: ["daily", "query", "landing_channel", "target_keywords", "query_page"]
  },
  { id: "ai", href: "/website/stats/ai", label: "AI", kinds: ["bots", "ai_visits"] },
  {
    id: "behavior",
    href: "/website/stats/behavior",
    label: "방문 패턴",
    kinds: ["daily", "landing", "landing_channel", "ai_visits", "page_exit", "event", "country", "device", "hourly"]
  }
];

export function isV3ScreenId(value: string): value is V3ScreenId {
  return V3_SCREENS.some((item) => item.id === value);
}

/** 워크·인사이트 제목이 필요한 화면 */
export const V3_NEEDS_CATALOG: V3ScreenId[] = ["content", "search", "ai", "behavior"];
