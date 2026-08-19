"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { WIKI_OLD_CATEGORY_TO_LIST, wikiDocPath } from "@/lib/wiki/types";

type DocPayload = { item?: { slug: string }; canonical_slug?: string };

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 옛 주소 /wiki/standards/rfp_analysis → /wiki/rfp-analysis */
export default function WikiLegacyRedirectPage() {
  const params = useParams<{ slug: string; legacy: string }>();
  const router = useRouter();
  const category = firstParam(params.slug);
  const oldSlug = firstParam(params.legacy);

  useEffect(() => {
    if (!oldSlug) return;
    const fallbackList = WIKI_OLD_CATEGORY_TO_LIST[category];
    void (async () => {
      try {
        const json = await wikiFetch<DocPayload>(
          `/api/wiki/docs/${encodeURIComponent(oldSlug)}`
        );
        const dest = json.canonical_slug || json.item?.slug;
        if (dest) {
          router.replace(wikiDocPath(dest));
          return;
        }
      } catch {
        /* fall through */
      }
      router.replace(fallbackList ? `/wiki/list/${fallbackList}` : "/wiki/terms");
    })();
  }, [category, oldSlug, router]);

  return (
    <p className="px-6 py-8 text-sm text-slate-500">새 주소로 이동 중…</p>
  );
}
