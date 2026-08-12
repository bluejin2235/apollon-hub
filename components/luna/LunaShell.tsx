"use client";

import type { ReactNode } from "react";

/**
 * /luna 와 /glossary 가 공유하는 좌측 레일 레이아웃.
 * PC 는 고정 사이드바, 모바일은 왼쪽에서 밀려 나오는 서랍.
 */
export function LunaShell({
  sidebar,
  drawerOpen,
  onCloseDrawer,
  children
}: {
  sidebar: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
      <div className="hidden h-full p-2 md:flex">{sidebar}</div>

      <div
        className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <button
          type="button"
          aria-label="메뉴 닫기"
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={onCloseDrawer}
        />
        <div
          className={`absolute inset-y-0 left-0 flex w-[min(280px,86vw)] transform bg-white shadow-xl transition-transform duration-200 ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="h-full w-full p-2 pt-[calc(3.5rem+0.5rem)]">{sidebar}</div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
