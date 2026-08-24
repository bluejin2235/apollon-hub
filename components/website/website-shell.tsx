"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { MOBILE_SUBNAV_PADDING } from "@/components/portal/MobileSubNav";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { WebsiteMobileSubNav, WebsiteSidebarNav } from "@/components/website/website-nav";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

export function WebsiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, profile } = useRequirePortalSession();
  const isSuperAdmin = profile?.role === "슈퍼관리자";

  useEffect(() => {
    if (status !== "ready") return;
    if (!isSuperAdmin) router.replace("/hub");
  }, [status, isSuperAdmin, router]);

  if (status === "checking" || !isSuperAdmin) {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className={`flex h-screen w-full pt-14 ${MOBILE_SUBNAV_PADDING}`}>
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
    </div>
  );
}
