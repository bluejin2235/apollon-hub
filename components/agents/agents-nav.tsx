"use client";

import Link from "next/link";
import { BarChart3, CreditCard, LayoutDashboard } from "lucide-react";
import { MobileBottomTabBar, type MobileBottomTabItem } from "@/components/mobile/bottom-tab-bar";

export type AgentsTabKey = "dashboard" | "api" | "credit";

export type AgentsTabId = "overview" | "usage" | "credits";

export const AGENTS_NAV: {
  tabKey: AgentsTabKey;
  tabId: AgentsTabId;
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}[] = [
  {
    tabKey: "dashboard",
    tabId: "overview",
    label: "대시보드",
    href: "/agents?tab=dashboard",
    icon: LayoutDashboard
  },
  {
    tabKey: "api",
    tabId: "usage",
    label: "API 사용 내역",
    href: "/agents?tab=api",
    icon: BarChart3
  },
  {
    tabKey: "credit",
    tabId: "credits",
    label: "크레딧 결제 내역",
    href: "/agents?tab=credit",
    icon: CreditCard
  }
];

export function parseAgentsTabKey(value: string | null | undefined): AgentsTabKey {
  if (value === "api") return "api";
  if (value === "credit") return "credit";
  return "dashboard";
}

export function agentsTabKeyToId(tabKey: AgentsTabKey): AgentsTabId {
  const item = AGENTS_NAV.find((entry) => entry.tabKey === tabKey);
  return item?.tabId ?? "overview";
}

export function AgentsSidebarNav({ activeTabKey }: { activeTabKey: AgentsTabKey }) {
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {AGENTS_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.tabKey === activeTabKey;
        return (
          <Link
            key={item.tabKey}
            href={item.href}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-violet-500/15 text-violet-800 ring-1 ring-violet-500/40"
                : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AgentsMobileBottomNav({ activeTabKey }: { activeTabKey: AgentsTabKey }) {
  const items: MobileBottomTabItem[] = AGENTS_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.label,
      icon: <Icon aria-hidden />,
      active: item.tabKey === activeTabKey
    };
  });

  return <MobileBottomTabBar items={items} variant="light" />;
}
