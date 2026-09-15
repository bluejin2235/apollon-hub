"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DevnoteStatusDot } from "@/components/devnote/devnote-status-dot";
import type { DevnoteNavData } from "@/lib/devnote/types";

function navClass(active: boolean) {
  return `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${
    active
      ? "bg-white font-semibold text-[#15171C] shadow-[0_0_0_1px_#E2E5EA]"
      : "text-[#4A505C] hover:bg-[#ECEFF3]"
  }`;
}

export function DevnoteSidebar({
  nav,
  pathname
}: {
  nav: DevnoteNavData;
  pathname: string;
}) {
  const overviewActive = pathname === "/devnote";
  const decisionsActive = pathname === "/devnote/decisions";
  const ideasActive = pathname === "/devnote/ideas";
  const blockersActive = pathname === "/devnote/blockers";

  return (
    <div className="flex h-full flex-col px-3 pb-16 pt-4">
      <input
        type="search"
        placeholder="노트 검색"
        className="w-full rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-2 text-[13px] text-[#15171C] placeholder:text-[#858C9A]"
        aria-label="노트 검색"
      />

      <div className="mt-5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-[#858C9A]">
          전체
        </h2>
        <nav className="flex flex-col">
          <Link href="/devnote" className={navClass(overviewActive)}>
            <DevnoteStatusDot status="plain" />
            기본 정보
          </Link>
          <Link href="/devnote/decisions" className={navClass(decisionsActive)}>
            <DevnoteStatusDot status="plain" />
            결정 기록
            <span className="ml-auto font-normal tabular-nums text-[11px] text-[#858C9A]">
              {nav.decisionCount}
            </span>
          </Link>
          <Link href="/devnote/ideas" className={navClass(ideasActive)}>
            <DevnoteStatusDot status="plain" />
            만들고 싶은 것
            <span className="ml-auto font-normal tabular-nums text-[11px] text-[#858C9A]">
              {nav.ideaCount}
            </span>
          </Link>
          <Link href="/devnote/blockers" className={navClass(blockersActive)}>
            <DevnoteStatusDot status="stuck" />
            막힌 것
            <span className="ml-auto font-normal tabular-nums text-[11px] text-[#858C9A]">
              {nav.openBlockerCount}
            </span>
          </Link>
        </nav>
      </div>

      <div className="mt-5">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-[#858C9A]">
          서비스
        </h2>
        <nav className="flex flex-col">
          {nav.services.map((service) => {
            const href = `/devnote/s/${service.slug}`;
            const active = pathname === href;
            return (
              <Link key={service.slug} href={href} className={navClass(active)}>
                <DevnoteStatusDot status={service.status} />
                {service.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-6 flex flex-col gap-1.5 border-t border-[#E2E5EA] px-2.5 pt-2.5 text-[11px] text-[#858C9A]">
        <p className="flex items-center gap-1.5">
          <DevnoteStatusDot status="live" />
          운영 중
        </p>
        <p className="flex items-center gap-1.5">
          <DevnoteStatusDot status="wip" />
          개발 중
        </p>
        <p className="flex items-center gap-1.5">
          <DevnoteStatusDot status="stuck" />
          막힘
        </p>
        <p className="flex items-center gap-1.5">
          <DevnoteStatusDot status="doc" />
          문서만
        </p>
      </div>
    </div>
  );
}

export function DevnoteMobileNav({
  nav,
  pathname
}: {
  nav: DevnoteNavData;
  pathname: string;
}) {
  const router = useRouter();
  const options = [
    { href: "/devnote", label: "기본 정보" },
    { href: "/devnote/decisions", label: `결정 기록 (${nav.decisionCount})` },
    { href: "/devnote/ideas", label: `만들고 싶은 것 (${nav.ideaCount})` },
    {
      href: "/devnote/blockers",
      label: `막힌 것 (${nav.openBlockerCount})`
    },
    ...nav.services.map((service) => ({
      href: `/devnote/s/${service.slug}`,
      label: service.name
    }))
  ];
  const current = options.some((o) => o.href === pathname)
    ? pathname
    : "/devnote";

  return (
    <div className="border-b border-[#E2E5EA] bg-white px-4 py-3 md:hidden">
      <label className="sr-only" htmlFor="devnote-mobile-nav">
        개발노트 메뉴
      </label>
      <select
        id="devnote-mobile-nav"
        value={current}
        onChange={(e) => router.push(e.target.value)}
        className="w-full rounded-lg border border-[#E2E5EA] bg-white px-3 py-2 text-[13px] text-[#15171C]"
      >
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DevnoteNavChrome({
  nav,
  children
}: {
  nav: DevnoteNavData;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <aside className="hidden h-full w-[264px] shrink-0 overflow-y-auto border-r border-[#E2E5EA] bg-[#F7F8FA] md:block">
        <DevnoteSidebar nav={nav} pathname={pathname} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <DevnoteMobileNav nav={nav} pathname={pathname} />
        <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-[22px] md:px-10 md:py-8 md:pb-24">
          <div className="mx-auto max-w-[760px]">{children}</div>
        </div>
      </div>
    </>
  );
}
