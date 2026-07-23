"use client";

import { useSearchParams } from "next/navigation";
import { ReactNode, Suspense } from "react";
import { AgentsSidebarNav, parseAgentsTabKey } from "@/components/agents/agents-nav";
import { MOBILE_BOTTOM_TAB_PADDING } from "@/components/mobile/bottom-tab-bar";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";

function AgentsShellContent({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const activeTabKey = parseAgentsTabKey(searchParams.get("tab"));

  return (
    <div className={`flex h-[calc(100vh-3.5rem)] w-full pt-14 ${MOBILE_BOTTOM_TAB_PADDING}`}>
      <aside className="sticky top-14 z-10 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 px-4 py-6 md:block">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-600">Agents</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">AI 비용 관리</h2>
        <AgentsSidebarNav activeTabKey={activeTabKey} />
      </aside>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white px-4 py-8 text-gray-900 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl pb-20 md:pb-0">
            {children}
          </div>
        </div>
    </div>
  );
}

export function AgentsShell({ children }: { children: ReactNode }) {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking light />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <div className="min-h-screen">
      <PortalHeader userInfoLine={userInfoLine} onLogout={() => void signOutAndRedirectToLogin()} />

      <Suspense fallback={<p className="px-4 py-6 pt-20 text-sm text-slate-500">불러오는 중…</p>}>
        <AgentsShellContent>{children}</AgentsShellContent>
      </Suspense>
    </div>
  );
}
