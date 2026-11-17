/** 통계 v3 다섯 화면 — 주소와 받아 올 자료. 사이드바에는 아직 넣지 않는다(검수 뒤 지금 화면과 바꾼다) */

import type { StatsActionsState } from "@/components/website/stats/stats-actions";
import type { LoadStatus } from "@/components/website/stats/stats-slot";
import type { V3Catalog } from "@/components/website/stats-v3/v3-catalog";
import type { StatsBundle } from "@/lib/website/stats";

/** 화면 부품이 받는 것. 화면은 받아 오지 않고 그리기만 한다 */
export type V3ScreenProps = {
  bundle: StatsBundle | null;
  status: LoadStatus;
  from: string;
  to: string;
  today: string;
  catalog: V3Catalog | null;
  actions: StatsActionsState;
};

export type V3ScreenId = "overview" | "content" | "search" | "ai" | "visits";

export const V3_SCREENS: { id: V3ScreenId; href: string; label: string; kinds: string[] }[] = [
  {
    id: "overview",
    href: "/website/stats-v3/overview",
    label: "요약",
    kinds: ["daily", "channel", "page", "query", "landing_channel", "ai_visits"]
  },
  {
    id: "content",
    href: "/website/stats-v3/content",
    label: "콘텐츠",
    kinds: ["daily", "page", "landing", "landing_channel", "ai_visits"]
  },
  {
    id: "search",
    href: "/website/stats-v3/search",
    label: "검색",
    kinds: ["daily", "query", "landing_channel"]
  },
  { id: "ai", href: "/website/stats-v3/ai", label: "AI", kinds: ["bots", "ai_visits"] },
  {
    id: "visits",
    href: "/website/stats-v3/visits",
    label: "방문 패턴",
    kinds: ["daily", "landing", "event", "country", "device"]
  }
];

export function isV3ScreenId(value: string): value is V3ScreenId {
  return V3_SCREENS.some((item) => item.id === value);
}

/** 워크·인사이트 제목이 필요한 화면 */
export const V3_NEEDS_CATALOG: V3ScreenId[] = ["content", "search", "ai", "visits"];
