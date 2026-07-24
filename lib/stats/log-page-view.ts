"use client";

import { supabase } from "@/lib/supabase/client";

export const STATS_SERVICES = [
  "licenses",
  "restaurants",
  "supplies",
  "agents",
  "research"
] as const;

export type StatsService = (typeof STATS_SERVICES)[number];

const SERVICE_SET = new Set<string>(STATS_SERVICES);

let lastLoggedPath: string | null = null;

/** pathname 최상위 세그먼트 → service (미매핑이면 null) */
export function mapPathnameToService(pathname: string): StatsService | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  return SERVICE_SET.has(segment) ? (segment as StatsService) : null;
}

/** 서비스 페이지 진입 시 page_view_logs 기록 (같은 path 연속 중복 skip) */
export async function logPageView(service: string, path: string): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (!SERVICE_SET.has(service)) return;
    if (lastLoggedPath === path) return;

    const {
      data: { session }
    } = await supabase.auth.getSession();
    const profileId = session?.user?.id;
    if (!profileId) return;

    const { error } = await supabase.from("page_view_logs").insert({
      profile_id: profileId,
      service,
      path
    });

    if (error) {
      console.error("[stats] page_view_logs insert failed", error);
      return;
    }

    lastLoggedPath = path;
  } catch (e) {
    console.error("[stats] logPageView failed", e);
  }
}
