"use client";

import { Suspense } from "react";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";
import { WikiNewDoc } from "@/components/wiki/WikiNewDoc";

export default function WikiNewPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <Suspense
        fallback={
          <p className="px-[22px] py-6 text-[12px] text-slate-400">불러오는 중…</p>
        }
      >
        <WikiNewDoc />
      </Suspense>
    </div>
  );
}
