"use client";

import "./luna-workspace.css";

import { useEffect, useRef, ReactNode } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { usePathname } from "next/navigation";
import { LunaWorkspaceContext } from "@/components/luna/LunaWorkspaceContext";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { useRedirectUnlessLunaAccess } from "@/lib/luna/use-has-luna-access";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { GlossaryHighlightProvider } from "@/components/glossary/GlossaryHighlightProvider";
import { LunaOpenQuestionsFab } from "@/components/luna/LunaOpenQuestionsFab";

export default function LunaLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname === "/luna";
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isChat || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const resize = () => {
      // Follow the on-screen keyboard without disabling pinch zoom accessibility.
      if (viewportRef.current && viewport.scale === 1) viewportRef.current.style.height = `${viewport.height}px`;
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [isChat]);
  const { status, profile } = useRequirePortalSession();
  const access = useRedirectUnlessLunaAccess(
    profile?.id,
    profile?.role,
    status === "ready"
  );

  if (status === "checking" || !access.ready || !access.allowed) {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <GlossaryHighlightProvider>
    <LunaWorkspaceContext.Provider value={{ name: profile?.name ?? "" }}>
    <div ref={viewportRef} data-luna-workspace={isChat ? "chat" : undefined} className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-white">
      {!isChat && <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
        role={profile?.role}
      />}
      <div className={`flex min-h-0 w-full flex-1 overflow-hidden ${isChat ? "" : "pt-14"}`}>
        {children}
      </div>
      {profile?.role === "슈퍼관리자" ? <LunaOpenQuestionsFab /> : null}
    </div>
    </LunaWorkspaceContext.Provider>
    </GlossaryHighlightProvider>
  );
}
