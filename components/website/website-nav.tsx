"use client";

import Link from "next/link";
import {
  BookOpen,
  FileText,
  FolderKanban,
  ImageIcon,
  LayoutGrid,
  Settings
} from "lucide-react";
import { MobileSubNav, type SubNavItem } from "@/components/portal/MobileSubNav";

export type WebsiteNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  match: (pathname: string) => boolean;
  icon: typeof LayoutGrid;
};

export const WEBSITE_NAV: WebsiteNavItem[] = [
  {
    href: "/website",
    label: "대시보드",
    shortLabel: "대시보드",
    match: (p) => p === "/website",
    icon: LayoutGrid
  },
  {
    href: "/website/works",
    label: "워크",
    shortLabel: "워크",
    match: (p) => p.startsWith("/website/works"),
    icon: FolderKanban
  },
  {
    href: "/website/insights",
    label: "인사이트",
    shortLabel: "인사이트",
    match: (p) => p.startsWith("/website/insights"),
    icon: FileText
  },
  {
    href: "/website/media",
    label: "이미지",
    shortLabel: "이미지",
    match: (p) => p.startsWith("/website/media"),
    icon: ImageIcon
  },
  {
    href: "/website/settings",
    label: "설정",
    shortLabel: "설정",
    match: (p) => p.startsWith("/website/settings"),
    icon: Settings
  }
];

export const WEBSITE_GUIDE_NAV: WebsiteNavItem = {
  href: "/website/guide",
  label: "제작·운영 가이드",
  shortLabel: "가이드",
  match: (p) => p.startsWith("/website/guide"),
  icon: BookOpen
};

export function WebsiteSidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {WEBSITE_NAV.map((item) => {
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

      <div className="my-3 border-t border-slate-300" role="separator" />

      <Link
        href={WEBSITE_GUIDE_NAV.href}
        className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          WEBSITE_GUIDE_NAV.match(pathname)
            ? "bg-apollon-500/15 text-apollon-800 ring-1 ring-apollon-500/40"
            : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
        }`}
      >
        {WEBSITE_GUIDE_NAV.label}
      </Link>
    </nav>
  );
}

export function WebsiteMobileSubNav() {
  const items: SubNavItem[] = [
    ...WEBSITE_NAV.map((item) => {
      const Icon = item.icon;
      return {
        href: item.href,
        label: item.shortLabel,
        icon: <Icon aria-hidden />,
        isActive: ({ pathname }: { pathname: string }) => item.match(pathname)
      };
    }),
    {
      href: WEBSITE_GUIDE_NAV.href,
      label: WEBSITE_GUIDE_NAV.shortLabel,
      icon: <BookOpen aria-hidden />,
      isActive: ({ pathname }: { pathname: string }) => WEBSITE_GUIDE_NAV.match(pathname)
    }
  ];

  return <MobileSubNav items={items} />;
}
