"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { DevnoteNavChrome } from "@/components/devnote/devnote-sidebar";
import { loadDevnoteNav } from "@/lib/devnote/load-nav";
import type { DevnoteNavData } from "@/lib/devnote/types";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { supabase } from "@/lib/supabase/client";

export function DevnoteShell({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();
  const [nav, setNav] = useState<DevnoteNavData | null>(null);
  const [navReady, setNavReady] = useState(false);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    void loadDevnoteNav(supabase).then((data) => {
      if (cancelled) return;
      setNav(data);
      setNavReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "checking" || !navReady) {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile
    ? formatPortalHeaderUserInfo(profile)
    : "- / - / -";

  if (!nav) {
    return (
      <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white">
        <PortalHeader
          userInfoLine={userInfoLine}
          onLogout={() => void signOutAndRedirectToLogin()}
          maxWidthClass="max-w-none"
          role={profile?.role}
        />
        <main className="flex min-h-0 flex-1 items-center justify-center px-6 pt-14 text-center">
          <div>
            <h1 className="text-lg font-semibold text-[#15171C]">접근할 수 없습니다</h1>
            <p className="mt-2 text-sm text-[#4A505C]">
              이 노트를 볼 권한이 없습니다.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
        maxWidthClass="max-w-none"
        role={profile?.role}
      />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden pt-14">
        <DevnoteNavChrome nav={nav}>{children}</DevnoteNavChrome>
      </div>
    </div>
  );
}
