"use client";

import { formatSupplyLocation } from "@/lib/supplies/locations";
import { imagePublicUrls } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";

export function SupplyInfoCard({ supply }: { supply: SupplyWithRelations }) {
  const thumb = imagePublicUrls(supply.image_paths)[0];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-4">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">
            📦
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{supply.code}</p>
          <p className="font-semibold text-slate-900">{supply.name}</p>
          <p className="text-sm text-slate-600">{formatSupplyLocation(supply.location)}</p>
        </div>
      </div>
    </div>
  );
}
