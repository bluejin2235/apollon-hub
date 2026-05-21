"use client";

import { ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

export function AgentsShell({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking light />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="min-h-[calc(100vh-3.5rem)] w-full bg-white text-gray-900">
        <div className="mx-auto w-full max-w-7xl pb-16 pt-6">{children}</div>
      </div>
    </div>
  );
}
