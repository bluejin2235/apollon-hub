"use client";

import { Menu } from "lucide-react";
import { useWikiDrawer } from "@/components/wiki/wiki-drawer";

export function WikiMobileMenu() {
  const drawer = useWikiDrawer();
  return (
    <button
      type="button"
      aria-label="메뉴 열기"
      onClick={() => drawer.open()}
      className="-ml-1 mb-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
    >
      <Menu className="h-5 w-5" strokeWidth={1.75} />
    </button>
  );
}
