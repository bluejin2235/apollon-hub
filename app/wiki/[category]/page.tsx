"use client";

import { useParams } from "next/navigation";
import { WikiDocList } from "@/components/wiki/WikiDocList";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";
import { isWikiCategory } from "@/lib/wiki/types";

export default function WikiCategoryPage() {
  const params = useParams<{ category: string }>();
  const category = params.category;
  if (!isWikiCategory(category)) {
    return (
      <p className="px-6 py-8 text-sm text-slate-500">없는 분류입니다.</p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiDocList category={category} />
    </div>
  );
}
