"use client";

import { ReactNode, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { WikiDrawerContext } from "@/components/wiki/wiki-drawer";
import { WikiShell } from "@/components/wiki/WikiShell";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

export default function WikiLayout({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile
    ? formatPortalHeaderUserInfo(profile)
    : "- / - / -";

  return (
    <WikiDrawerContext.Provider value={{ open: () => setDrawerOpen(true) }}>
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white">
        <PortalHeader
          userInfoLine={userInfoLine}
          onLogout={() => void signOutAndRedirectToLogin()}
        />
        <div className="flex min-h-0 w-full flex-1 overflow-hidden pt-14">
          <WikiShell
            drawerOpen={drawerOpen}
            onCloseDrawer={() => setDrawerOpen(false)}
          >
            {children}
          </WikiShell>
        </div>
      </div>
    </WikiDrawerContext.Provider>
  );
}
