"use client";

import Link from "next/link";
import { Coins, LayoutDashboard, List, Tag, Users } from "lucide-react";
import { MobileBottomTabBar, type MobileBottomTabItem } from "@/components/mobile/bottom-tab-bar";

export type LicenseNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  match: (pathname: string) => boolean;
  icon: typeof LayoutDashboard;
};

export const LICENSE_NAV: LicenseNavItem[] = [
  {
    href: "/licenses",
    label: "대시보드",
    shortLabel: "대시보드",
    match: (p) => p === "/licenses",
    icon: LayoutDashboard
  },
  {
    href: "/licenses/list",
    label: "라이선스별",
    shortLabel: "라이선스별",
    match: (p) => p.startsWith("/licenses/list") || /^\/licenses\/[0-9a-f-]{36}$/i.test(p),
    icon: List
  },
  {
    href: "/licenses/members",
    label: "멤버별",
    shortLabel: "멤버별",
    match: (p) => p.startsWith("/licenses/members"),
    icon: Users
  },
  {
    href: "/licenses/costs",
    label: "비용 현황",
    shortLabel: "비용 현황",
    match: (p) => p.startsWith("/licenses/costs"),
    icon: Coins
  },
  {
    href: "/licenses/categories",
    label: "카테고리 설정",
    shortLabel: "카테고리 설정",
    match: (p) => p.startsWith("/licenses/categories"),
    icon: Tag
  }
];

export function LicenseSidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {LICENSE_NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-apollon-500/15 text-apollon-800 ring-1 ring-apollon-500/40"
                : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LicenseMobileBottomNav({ pathname }: { pathname: string }) {
  const items: MobileBottomTabItem[] = LICENSE_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.shortLabel,
      icon: <Icon aria-hidden />,
      active: item.match(pathname)
    };
  });

  return <MobileBottomTabBar items={items} variant="light" />;
}
