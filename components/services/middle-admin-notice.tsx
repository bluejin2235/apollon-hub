"use client";

import { Info } from "lucide-react";
import { MIDDLE_ADMIN_DESCRIPTIONS } from "@/lib/services/permission-descriptions";
import type { ServiceUrl } from "@/lib/services/permissions";

export function MiddleAdminNotice({
  serviceUrl,
  className = ""
}: {
  serviceUrl: ServiceUrl;
  className?: string;
}) {
  const description = MIDDLE_ADMIN_DESCRIPTIONS[serviceUrl];
  if (!description) return null;

  return (
    <div className={`mt-8 border-t border-slate-200 pt-6 ${className}`.trim()}>
      <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">중간관리자 권한 안내</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>
    </div>
  );
}
