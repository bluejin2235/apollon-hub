"use client";

import { ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalProfileSummary } from "@/lib/portal/profile";

export function RestaurantsShell({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const summary = profile ? formatPortalProfileSummary(profile) : "- / -";

  return (
    <div className="min-h-screen">
      <PortalHeader profileSummary={summary} onLogout={() => void signOutAndRedirectToLogin()} />

      <div className="min-h-[calc(100vh-3.5rem)] w-full bg-slate-50 text-slate-900">
        <div className="w-full pb-16 pt-6">{children}</div>
      </div>
    </div>
  );
}
