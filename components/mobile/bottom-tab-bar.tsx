"use client";

import Link from "next/link";
import { ReactNode } from "react";

export type MobileBottomTabItem = {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
};

type MobileBottomTabBarProps = {
  items: MobileBottomTabItem[];
  variant: "dark" | "light";
};

export function MobileBottomTabBar({ items, variant }: MobileBottomTabBarProps) {
  const isDark = variant === "dark";

  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-30 border-t md:hidden ${
        isDark ? "border-white/10 bg-[#111]" : "border-slate-200 bg-white"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="하단 메뉴"
    >
      <div className="mx-auto flex max-w-7xl items-stretch justify-around">
        {items.map((item) => (
          <Link
            key={item.href + item.label}
            href={item.href}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium transition ${
              item.active
                ? "text-[#534AB7]"
                : isDark
                  ? "text-[#ffffff66]"
                  : "text-slate-500"
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
              {item.icon}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Main content padding to clear fixed mobile tab bar */
export const MOBILE_BOTTOM_TAB_PADDING = "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0";
