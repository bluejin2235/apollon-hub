"use client";

import Link from "next/link";

export type LicenseNavItem = {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
};

export const LICENSE_NAV: LicenseNavItem[] = [
  { href: "/licenses", label: "대시보드", match: (p) => p === "/licenses" },
  { href: "/licenses/list", label: "전체 라이선스", match: (p) => p.startsWith("/licenses/list") },
  { href: "/licenses/members", label: "멤버별 라이선스", match: (p) => p.startsWith("/licenses/members") },
  { href: "/licenses/costs", label: "비용현황", match: (p) => p.startsWith("/licenses/costs") },
  { href: "/licenses/categories", label: "카테고리 관리", match: (p) => p.startsWith("/licenses/categories") }
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

export function LicenseMobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="mb-6 flex gap-2 overflow-x-auto pb-1 md:hidden">
      {LICENSE_NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
              active ? "bg-apollon-500 text-white" : "bg-slate-200 text-slate-700"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
