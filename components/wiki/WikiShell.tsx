"use client";

import type { ReactNode } from "react";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";

export function WikiShell({
  children,
  drawerOpen,
  onCloseDrawer
}: {
  children: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden bg-[#f5f6f8]">
      <div className="hidden h-full md:flex">
        <WikiSidebar />
      </div>

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
          <div className="h-full w-full pt-[3.5rem]">
            <WikiSidebar />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {children}
      </div>
    </div>
  );
}
