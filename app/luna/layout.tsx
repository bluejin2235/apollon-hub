"use client";

import { ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { GlossaryHighlightProvider } from "@/components/glossary/GlossaryHighlightProvider";

export default function LunaLayout({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <GlossaryHighlightProvider>
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
      />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden pt-14">
        {children}
      </div>
    </div>
    </GlossaryHighlightProvider>
  );
}
