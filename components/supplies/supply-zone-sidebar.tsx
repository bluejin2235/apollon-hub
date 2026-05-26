"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { supplyDetailPath, supplyStatusBadge } from "@/lib/supplies/utils";
import type { SupplyStatus } from "@/lib/supplies/types";

export type ZoneSupplyListItem = {
  id: string;
  code: string;
  name: string;
  status: SupplyStatus;
};

type Props = {
  zoneCode: string;
  zoneName: string;
  currentId: string;
  items: ZoneSupplyListItem[];
};

export function SupplyZoneSidebar({ zoneCode, zoneName, currentId, items }: Props) {
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentId]);

  return (
    <aside className="hidden min-h-0 lg:block">
      <div className="flex h-[calc(100vh-14rem)] min-h-[320px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 border-b border-slate-100 px-3 py-3">
          <p className="text-xs font-semibold text-slate-500">
            {zoneCode}. {zoneName}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">같은 구역 비품 {items.length}건</p>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="같은 구역 비품 목록">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">등록된 비품이 없습니다.</p>
          ) : (
            <ul>
              {items.map((item) => {
                const isActive = item.id === currentId;
                const badge = supplyStatusBadge(item.status);
                return (
                  <li key={item.id}>
                    <Link
                      ref={isActive ? activeRef : undefined}
                      href={supplyDetailPath(item.id)}
                      className={`block border-b border-slate-100 px-3 py-3 transition hover:bg-slate-50 ${
                        isActive ? "border-l-[3px] border-l-violet-500 bg-violet-50 pl-[9px]" : ""
                      }`}
                    >
                      <p className="text-xs font-medium text-slate-500">{item.code}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-slate-900">{item.name}</p>
                      <span
                        className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </div>
    </aside>
  );
}
