"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { MOBILE_SUBNAV_PADDING } from "@/components/portal/MobileSubNav";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { WebsitePermissionsProvider } from "@/components/website/website-permissions";
import { WebsiteTesterBanner } from "@/components/website/website-tester-banner";
import { WebsiteMobileSubNav, WebsiteSidebarNav } from "@/components/website/website-nav";
import { WebsiteToastHost } from "@/components/website/toast";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { canAccessWebsiteAdmin, isWebsiteTesterRole } from "@/lib/auth/website-tester";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

export function WebsiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, profile } = useRequirePortalSession();
  const canAccess = canAccessWebsiteAdmin(profile?.role);
  const isWebsiteTester = isWebsiteTesterRole(profile?.role);

  useEffect(() => {
    if (status !== "ready") return;
    if (!canAccess) router.replace("/hub");
  }, [status, canAccess, router]);

  if (status === "checking" || !canAccess) {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const shellTopPadding = isWebsiteTester ? "pt-[calc(3.5rem+1.75rem)]" : "pt-14";

  return (
    <WebsitePermissionsProvider role={profile?.role}>
      <div className="min-h-screen">
        <PortalHeader
          userInfoLine={userInfoLine}
          onLogout={() => void signOutAndRedirectToLogin()}
          homeHref={isWebsiteTester ? "/website" : "/hub"}
          showSettingsLink={!isWebsiteTester}
          showHubNotifications={!isWebsiteTester}
        />

        {isWebsiteTester ? <WebsiteTesterBanner /> : null}

        <div className={`flex h-screen w-full ${shellTopPadding} ${MOBILE_SUBNAV_PADDING}`}>
          <aside className="sticky top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 px-4 py-6 md:block">
            <p className="text-xs font-semibold uppercase tracking-wider text-apollon-600">Website</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">홈페이지</h2>
            <WebsiteSidebarNav pathname={pathname} />
          </aside>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-8 pb-0 sm:px-6 lg:px-8">
            {children}
          </div>
        </div>

        <WebsiteMobileSubNav />
        <WebsiteToastHost />
      </div>
    </WebsitePermissionsProvider>
  );
}
