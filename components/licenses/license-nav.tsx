"use client";

import Link from "next/link";
import { KeyRound, LayoutGrid, Tag, Users, Wallet } from "lucide-react";
import { MobileSubNav, type SubNavItem } from "@/components/portal/MobileSubNav";

export type LicenseNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  match: (pathname: string) => boolean;
  icon: typeof LayoutGrid;
};

export const LICENSE_NAV: LicenseNavItem[] = [
  {
    href: "/licenses",
    label: "대시보드",
    shortLabel: "대시보드",
    match: (p) => p === "/licenses",
    icon: LayoutGrid
  },
  {
    href: "/licenses/list",
    label: "라이선스",
    shortLabel: "라이선스",
    match: (p) => p.startsWith("/licenses/list") || /^\/licenses\/[0-9a-f-]{36}$/i.test(p),
    icon: KeyRound
  },
  {
    href: "/licenses/members",
    label: "멤버",
    shortLabel: "멤버",
    match: (p) => p.startsWith("/licenses/members"),
    icon: Users
  },
  {
    href: "/licenses/costs",
    label: "비용",
    shortLabel: "비용",
    match: (p) => p.startsWith("/licenses/costs"),
    icon: Wallet
  },
  {
    href: "/licenses/categories",
    label: "분류",
    shortLabel: "분류",
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

export function LicenseMobileSubNav() {
  const items: SubNavItem[] = LICENSE_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.shortLabel,
      icon: <Icon aria-hidden />,
      isActive: ({ pathname }) => item.match(pathname)
    };
  });

  return <MobileSubNav items={items} />;
}
