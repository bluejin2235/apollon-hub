"use client";

import { useParams } from "next/navigation";
import { WikiDocView } from "@/components/wiki/WikiDocView";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";
import { isWikiCategory } from "@/lib/wiki/types";

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function WikiDocPage() {
  const params = useParams<{ category: string; slug: string }>();
  const category = firstParam(params.category);
  const slug = firstParam(params.slug);
  if (!isWikiCategory(category) || !slug) {
    return (
      <p className="px-6 py-8 text-sm text-slate-500">문서를 찾지 못했습니다.</p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiDocView category={category} slug={slug} />
    </div>
  );
}
