"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { logAccess } from "@/lib/stats/log-access";
import { logPageView, mapPathnameToService } from "@/lib/stats/log-page-view";

/** 로그인된 포털 화면에서 접속/페이지뷰 통계를 기록 */
export function PortalStatsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    void logAccess();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const service = mapPathnameToService(pathname);
    if (!service) return;
    void logPageView(service, pathname);
  }, [pathname]);

  return null;
}
