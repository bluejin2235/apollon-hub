"use client";

import Link from "next/link";
import { CreditCard, LayoutGrid, Plug } from "lucide-react";
import { MobileSubNav, type SubNavItem } from "@/components/portal/MobileSubNav";

export type AgentsTabKey = "dashboard" | "api" | "credit";

export type AgentsTabId = "overview" | "usage" | "credits";

export const AGENTS_NAV: {
  tabKey: AgentsTabKey;
  tabId: AgentsTabId;
  label: string;
  shortLabel: string;
  href: string;
  icon: typeof LayoutGrid;
}[] = [
  {
    tabKey: "dashboard",
    tabId: "overview",
    label: "대시보드",
    shortLabel: "대시보드",
    href: "/agents?tab=dashboard",
    icon: LayoutGrid
  },
  {
    tabKey: "api",
    tabId: "usage",
    label: "API 사용 내역",
    shortLabel: "API 사용",
    href: "/agents?tab=api",
    icon: Plug
  },
  {
    tabKey: "credit",
    tabId: "credits",
    label: "크레딧 결제 내역",
    shortLabel: "크레딧",
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

export function AgentsMobileSubNav() {
  const items: SubNavItem[] = AGENTS_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.shortLabel,
      icon: <Icon aria-hidden />
    };
  });

  return <MobileSubNav items={items} />;
}
