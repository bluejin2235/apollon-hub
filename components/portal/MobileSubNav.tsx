"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type SubNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** When set, overrides default path/query matching for this item. */
  isActive?: (ctx: { pathname: string; searchParams: URLSearchParams }) => boolean;
};

type Props = {
  items: SubNavItem[];
};

/** Content padding to clear fixed MobileSubNav */
export const MOBILE_SUBNAV_PADDING =
  "pb-[calc(52px+env(safe-area-inset-bottom,0px))] md:pb-0";

function parseHref(href: string): { pathname: string; searchParams: URLSearchParams } {
  const q = href.indexOf("?");
  if (q < 0) {
    return { pathname: href, searchParams: new URLSearchParams() };
  }
  return {
    pathname: href.slice(0, q) || "/",
    searchParams: new URLSearchParams(href.slice(q + 1))
  };
}

function pathMatches(currentPath: string, itemPath: string): boolean {
  if (currentPath === itemPath) return true;
  if (itemPath !== "/" && currentPath.startsWith(`${itemPath}/`)) return true;
  return false;
}

function queryMatches(
  current: URLSearchParams,
  required: URLSearchParams
): boolean {
  for (const [key, value] of required.entries()) {
    if (current.get(key) !== value) return false;
  }
  return true;
}

function withDefaultTab(pathname: string, search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  if ((pathname === "/agents" || pathname.startsWith("/agents/")) && !next.has("tab")) {
    next.set("tab", "dashboard");
  }
  return next;
}

/** Longest matching href wins (path + query). */
export function resolveActiveSubNavHref(
  pathname: string,
  search: string,
  items: SubNavItem[]
): string | null {
  const rawSearch = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  const currentSearch = withDefaultTab(pathname, rawSearch);

  let best: { href: string; score: number } | null = null;

  for (const item of items) {
    const { pathname: itemPath, searchParams: itemQuery } = parseHref(item.href);

    const matched = item.isActive
      ? item.isActive({ pathname, searchParams: currentSearch })
      : pathMatches(pathname, itemPath) && queryMatches(currentSearch, itemQuery);

    if (!matched) continue;

    const score = itemPath.length * 1000 + item.href.length;
    if (!best || score > best.score) {
      best = { href: item.href, score };
    }
  }

  return best?.href ?? null;
}

function MobileSubNavInner({ items }: Props) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [isMobile, setIsMobile] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (!isMobile || !items.length) {
      document.documentElement.style.setProperty("--mobile-subnav-h", "0px");
      return;
    }
    const el = navRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--mobile-subnav-h",
        `${Math.round(el.getBoundingClientRect().height)}px`
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--mobile-subnav-h", "0px");
    };
  }, [isMobile, items.length]);

  const search = searchParams?.toString() ?? "";
  const activeHref = useMemo(
    () => resolveActiveSubNavHref(pathname, search, items),
    [pathname, search, items]
  );

  if (!isMobile) return null;
  if (!items.length) return null;

  const scrollable = items.length >= 6;

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E4E2DA] bg-white md:hidden"
      style={{
        height: "calc(52px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)"
      }}
      aria-label="서비스 메뉴"
    >
      <div
        className={`flex h-[52px] w-full ${
          scrollable
            ? "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : ""
        }`}
      >
        {items.map((item) => {
          const active = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-full flex-col items-center justify-center gap-0.5 ${
                scrollable ? "min-w-[68px] shrink-0" : "min-w-0 flex-1"
              }`}
              style={{
                color: active ? "#534AB7" : "#6B6A64",
                fontSize: 10,
                fontWeight: active ? 600 : 400
              }}
            >
              <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
                {item.icon}
              </span>
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileSubNav({ items }: Props) {
  return (
    <Suspense fallback={null}>
      <MobileSubNavInner items={items} />
    </Suspense>
  );
}
