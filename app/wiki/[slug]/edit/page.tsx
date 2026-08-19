"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { WikiDocEdit } from "@/components/wiki/WikiDocEdit";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function WikiEditPage() {
  const params = useParams<{ slug: string }>();
  const slug = firstParam(params.slug);
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
        <WikiDocEdit slug={slug} />
      </Suspense>
    </div>
  );
}
