"use client";

import { WikiDocView } from "@/components/wiki/WikiDocView";
import { useParams } from "next/navigation";

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function WebsiteGuideDocPage() {
  const params = useParams<{ slug: string }>();
  const slug = firstParam(params.slug);

  if (!slug) {
    return (
      <p className="px-6 py-8 text-sm text-slate-500">문서를 찾지 못했습니다.</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WikiDocView slug={slug} />
    </div>
  );
}
