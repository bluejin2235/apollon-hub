"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { LicenseMobileNav, LicenseSidebarNav } from "@/components/licenses/license-nav";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

export function LicensesShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="flex w-full gap-0 pb-12 pt-0">
        <aside className="sticky top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-slate-200 bg-slate-50 px-4 py-6 md:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-apollon-600">License</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Apollon License Manager</h2>
          <LicenseSidebarNav pathname={pathname} />
        </aside>

        {/* 콘텐츠: 사이드바 border-r 와 카드 좌측이 맞붙어 보이지 않도록 좌우 여백 부여. */}
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <LicenseMobileNav pathname={pathname} />
          {children}
        </div>
      </div>
    </div>
  );
}
