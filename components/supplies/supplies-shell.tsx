"use client";

import { ReactNode, Suspense } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

export function SuppliesShell({ children }: { children: ReactNode }) {
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
      <div className="min-h-[calc(100vh-3.5rem)] w-full bg-white pt-14 text-gray-900">
        <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-6 md:pb-16">
          <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중…</p>}>{children}</Suspense>
        </div>
      </div>
    </div>
  );
}
