"use client";

import Link from "next/link";
import { formatSupplyLocation } from "@/lib/supplies/locations";
import { imagePublicUrls, supplyDetailPath, supplyStatusBadge } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";

type Props = {
  supply: SupplyWithRelations;
};

export function SupplyCard({ supply }: Props) {
  const badge = supplyStatusBadge(supply.status);
  const urls = imagePublicUrls(supply.image_paths ?? []);
  const thumb = urls[0];

  return (
    <Link
      href={supplyDetailPath(supply.id)}
      className="apollon-card group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-violet-300 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full bg-slate-100">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl text-slate-300">📦</div>
        )}
        <span className={`absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium text-slate-500">{supply.code}</p>
        <h3 className="mt-0.5 line-clamp-2 font-semibold text-slate-900 group-hover:text-violet-700">{supply.name}</h3>
        <p className="mt-1 text-sm text-slate-600">{formatSupplyLocation(supply.location)}</p>
        <p className="mt-2 text-xs text-slate-500">담당 {supply.manager?.name?.trim() || "—"}</p>
      </div>
    </Link>
  );
}
