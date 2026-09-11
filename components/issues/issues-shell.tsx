"use client";

import { ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import "@/components/issues/issues.css";

export function IssuesShell({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking light />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
      />
      <div className="min-h-[calc(100vh-3.5rem)] w-full bg-[#f8fafc] pt-14 text-gray-900">
        <div className="iss mx-auto w-full max-w-[1040px] px-4 pb-20 pt-6 md:pb-8">{children}</div>
      </div>
    </div>
  );
}
