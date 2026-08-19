"use client";

import { WikiDocView } from "@/components/wiki/WikiDocView";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { WIKI_OLD_CATEGORY_TO_LIST } from "@/lib/wiki/types";

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function WikiSlugPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = firstParam(params.slug);
  const mapped = WIKI_OLD_CATEGORY_TO_LIST[slug];

  useEffect(() => {
    if (mapped) router.replace(`/wiki/list/${mapped}`);
  }, [mapped, router]);

  if (!slug) {
    return (
      <p className="px-6 py-8 text-sm text-slate-500">문서를 찾지 못했습니다.</p>
    );
  }
  if (mapped) {
    return (
      <p className="px-6 py-8 text-sm text-slate-500">목록으로 이동 중…</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiDocView slug={slug} />
    </div>
  );
}
