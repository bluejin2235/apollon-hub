"use client";

import Link from "next/link";
import { formatSupplyDate, supplyDetailUrl, supplyStatusBadge, categoryPlaceholder } from "@/lib/supplies/utils";
import type { SupplyCardData } from "@/lib/supplies/types";

type Props = {
  supply: SupplyCardData;
};

export function SupplyCard({ supply }: Props) {
  const badge = supplyStatusBadge(supply.status);
  const placeholderClass = categoryPlaceholder(supply.category);

  return (
    <Link
      href={supplyDetailUrl(supply.code)}
      className="apollon-card group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-violet-300 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full bg-slate-100">
        {supply.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={supply.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full w-full items-center justify-center text-3xl font-bold ${placeholderClass}`}>
            {supply.category.trim().toUpperCase() || "—"}
          </div>
        )}
        <span className={`absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium text-slate-500">{supply.code}</p>
        <h3 className="mt-0.5 line-clamp-2 font-semibold text-slate-900 group-hover:text-violet-700">{supply.name}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {supply.category} · {supply.location}
        </p>
        <p className="mt-2 text-xs text-slate-500">담당 {supply.manager?.name?.trim() || "—"}</p>
        {supply.status === "borrowed" && supply.activeDueDate ? (
          <p className="mt-2 text-xs text-amber-700">반납예정 {formatSupplyDate(supply.activeDueDate)}</p>
        ) : null}
      </div>
    </Link>
  );
}
