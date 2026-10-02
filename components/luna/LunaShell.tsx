"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function LunaShell({ sidebar, drawerOpen, onCloseDrawer, desktopOpen = true, children }: {
  sidebar: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  desktopOpen?: boolean;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLButtonElement>("button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseDrawer();
      if (event.key !== "Tab" || !drawer) return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [drawerOpen, onCloseDrawer]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (media.matches) onCloseDrawer(); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, [onCloseDrawer]);
  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden bg-[#faf9f6]">
      {desktopOpen && <aside className="hidden h-full shrink-0 border-r border-[#e4e7e1] bg-white p-2 md:flex">{sidebar}</aside>}
      <div className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none invisible"}`} inert={!drawerOpen} aria-hidden={!drawerOpen}>
        <button type="button" aria-label="대화 목록 닫기" className={`absolute inset-0 bg-black/30 transition-opacity motion-reduce:transition-none ${drawerOpen ? "opacity-100" : "opacity-0"}`} onClick={onCloseDrawer} />
        <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="대화 목록" className={`absolute inset-y-0 left-0 flex w-[min(280px,86vw)] flex-col bg-white shadow-xl transition-transform duration-200 motion-reduce:transition-none ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex h-14 shrink-0 items-center justify-between px-4"><span className="text-sm font-medium">대화 목록</span><button type="button" aria-label="대화 목록 닫기" onClick={onCloseDrawer} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"><X size={20} /></button></div>
          <div className="min-h-0 flex-1 p-2">{sidebar}</div>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={drawerOpen || undefined}>{children}</div>
    </div>
  );
}
