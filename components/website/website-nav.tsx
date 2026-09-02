"use client";

import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  FileText,
  FolderKanban,
  Home,
  LayoutGrid,
  Layers,
  Mail,
  Newspaper,
  Settings
} from "lucide-react";
import { MobileSubNav, type SubNavItem } from "@/components/portal/MobileSubNav";
import { STATS_SCREENS } from "@/lib/website/stats";

export type WebsiteNavItem = {
  href: string;
  label: string;
  shortLabel: string;
  match: (pathname: string) => boolean;
  icon: typeof LayoutGrid;
  /** 안 읽은 건수. 0 이거나 없으면 뱃지를 그리지 않는다. */
  badge?: number;
};

type WebsiteNavGroup =
  | { kind: "links"; items: WebsiteNavItem[] }
  | {
      kind: "tree";
      title: string;
      titleHref: string;
      match: (pathname: string) => boolean;
      items: WebsiteNavItem[];
    };

/** 커리어 안 읽은 지원자. 데이터 연결 전 자리만 둔다. */
const CAREER_UNREAD = 0;
/** Let's Talk 안 읽은 문의. 데이터 연결 전 자리만 둔다. */
const CONTACT_UNREAD = 0;

const STATS_NAV_ITEMS: WebsiteNavItem[] = STATS_SCREENS.map((item) => ({
  href: item.href,
  label: item.label,
  shortLabel: item.label,
  match: (p) => p === item.href,
  icon: BarChart3
}));

export const WEBSITE_NAV_GROUPS: WebsiteNavGroup[] = [
  {
    kind: "links",
    items: [
      {
        href: "/website",
        label: "대시보드",
        shortLabel: "대시보드",
        match: (p) => p === "/website",
        icon: LayoutGrid
      }
    ]
  },
  {
    kind: "links",
    items: [
      {
        href: "/website/home",
        label: "홈",
        shortLabel: "홈",
        match: (p) => p.startsWith("/website/home"),
        icon: Home
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
        href: "/website/career",
        label: "커리어",
        shortLabel: "커리어",
        match: (p) => p.startsWith("/website/career"),
        icon: Briefcase,
        badge: CAREER_UNREAD
      },
      {
        href: "/website/contact",
        label: "Let's Talk",
        shortLabel: "문의",
        match: (p) => p.startsWith("/website/contact"),
        icon: Mail,
        badge: CONTACT_UNREAD
      },
      {
        href: "/website/newsletter",
        label: "뉴스레터",
        shortLabel: "뉴스레터",
        match: (p) => p.startsWith("/website/newsletter"),
        icon: Newspaper
      },
      {
        href: "/website/etc",
        label: "기타",
        shortLabel: "기타",
        match: (p) => p.startsWith("/website/etc"),
        icon: Layers
      }
    ]
  },
  {
    kind: "tree",
    title: "홈페이지 통계",
    titleHref: "/website/stats/summary",
    match: (p) => p.startsWith("/website/stats"),
    items: STATS_NAV_ITEMS
  },
  {
    kind: "links",
    items: [
      {
        href: "/website/settings",
        label: "설정",
        shortLabel: "설정",
        match: (p) => p.startsWith("/website/settings"),
        icon: Settings
      },
      {
        href: "/website/guide",
        label: "제작·운영 가이드",
        shortLabel: "가이드",
        match: (p) => p.startsWith("/website/guide"),
        icon: BookOpen
      }
    ]
  }
];

export const WEBSITE_NAV: WebsiteNavItem[] = WEBSITE_NAV_GROUPS.flatMap((group) => group.items);

function navLinkClass(active: boolean, nested = false) {
  return `flex items-center gap-2 rounded-xl py-2 text-sm font-medium transition ${
    nested ? "px-3 pl-6" : "px-3"
  } ${
    active
      ? "bg-apollon-500/15 text-apollon-800 ring-1 ring-apollon-500/40"
      : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
  }`;
}

function NavLink({
  item,
  pathname,
  nested
}: {
  item: WebsiteNavItem;
  pathname: string;
  nested?: boolean;
}) {
  const active = item.match(pathname);
  const badge = item.badge ?? 0;

  return (
    <Link href={item.href} className={navLinkClass(active, nested)} aria-current={active ? "page" : undefined}>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge > 0 ? (
        <span className="ml-auto shrink-0 rounded-full bg-rose-600 px-1.5 py-px text-[10px] font-bold leading-4 text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

export function WebsiteSidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {WEBSITE_NAV_GROUPS.map((group, index) => (
        <div key={group.kind === "tree" ? group.titleHref : group.items[0]?.href ?? index}>
          {index > 0 ? (
            <div className="my-3 border-t border-slate-300" role="separator" />
          ) : null}
          {group.kind === "tree" ? (
            <div className="flex flex-col gap-0.5">
              <Link
                href={group.titleHref}
                className={`px-3 py-1.5 text-[13px] font-semibold ${
                  group.match(pathname) ? "text-slate-800" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {group.title}
              </Link>
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} nested />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

export function WebsiteMobileSubNav() {
  const items: SubNavItem[] = WEBSITE_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.shortLabel,
      icon: <Icon aria-hidden />,
      isActive: ({ pathname }: { pathname: string }) => item.match(pathname)
    };
  });

  return <MobileSubNav items={items} />;
}
