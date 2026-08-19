"use client";

import { useParams } from "next/navigation";
import { WikiDocHistory } from "@/components/wiki/WikiDocHistory";
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

export default function WikiHistoryPage() {
  const params = useParams<{ slug: string }>();
  const slug = firstParam(params.slug);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiDocHistory slug={slug} />
    </div>
  );
}
