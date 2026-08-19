"use client";

import { useParams } from "next/navigation";
import { WikiDocList } from "@/components/wiki/WikiDocList";
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

export default function WikiListPage() {
  const params = useParams<{ menu: string }>();
  const menu = firstParam(params.menu);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiDocList menuSlug={menu} />
    </div>
  );
}
