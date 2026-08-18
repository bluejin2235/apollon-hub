"use client";

import { useParams } from "next/navigation";
import { WikiDocView } from "@/components/wiki/WikiDocView";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";
import { isWikiCategory } from "@/lib/wiki/types";

export default function WikiDocPage() {
  const params = useParams<{ category: string; slug: string }>();
  const category = params.category;
  const slug = params.slug;
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
