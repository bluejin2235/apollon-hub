"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { LicenseMobileNav, LicenseSidebarNav } from "@/components/licenses/license-nav";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalProfileSummary } from "@/lib/portal/profile";

export function LicensesShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const summary = profile ? formatPortalProfileSummary(profile) : "- / -";

  return (
    <div className="min-h-screen">
      <PortalHeader profileSummary={summary} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="mx-auto flex w-full max-w-[1600px] gap-0 px-0 pb-12 pt-0">
        <aside className="sticky top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-slate-800/80 bg-slate-950/60 px-4 py-6 backdrop-blur md:block">
          <p className="text-xs font-semibold uppercase tracking-wider text-apollon-300">License</p>
          <h2 className="mt-1 text-lg font-bold text-white">Apollon License Manager</h2>
          <LicenseSidebarNav pathname={pathname} />
        </aside>

        <div className="min-w-0 flex-1 px-4 py-8 md:px-8">
          <LicenseMobileNav pathname={pathname} />
          {children}
        </div>
      </div>
    </div>
  );
}
