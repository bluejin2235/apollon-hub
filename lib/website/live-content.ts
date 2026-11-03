/**
 * 고르기 목록용 — content_published.is_current + !is_hidden (= site_visibility live).
 * listWorks / listInsights 응답의 site_visibility 를 기준으로 거른다.
 */

import type { SearchHit } from "@/lib/website/api";
import type { InsightListItem, WorkListItem, WorkSiteVisibility } from "@/lib/website/types";

export function isLiveContent(
  siteVisibility: WorkSiteVisibility | null | undefined,
  status?: string | null
): boolean {
  if (siteVisibility === "live") return true;
  if (siteVisibility === "hidden" || siteVisibility === "draft") return false;
  return status === "published";
}

export function visibilityLabel(
  siteVisibility: WorkSiteVisibility | null | undefined,
  status?: string | null
): "감춤" | "미공개" | null {
  if (siteVisibility === "hidden") return "감춤";
  if (siteVisibility === "live") return null;
  if (siteVisibility === "draft") return "미공개";
  if (status === "published") return null;
  if (status) return "미공개";
  return null;
}

function titleOf(title: WorkListItem["title"] | InsightListItem["title"]): SearchHit["title"] {
  return title;
}

export function workListItemToHit(item: WorkListItem): SearchHit {
  return {
    type: "work",
    id: item.id,
    title: titleOf(item.title),
    slug: item.slug,
    key_image: item.key_image,
    category: item.category_id,
    status: item.status,
    year: item.year,
    published_at: item.published_at,
    site_visibility: item.site_visibility
  };
}

export function insightListItemToHit(item: InsightListItem): SearchHit {
  return {
    type: "insight",
    id: item.id,
    title: titleOf(item.title),
    slug: item.slug,
    key_image: item.key_image,
    category: item.category_id,
    status: item.status,
    year: item.year,
    published_at: item.published_at,
    site_visibility: item.site_visibility ?? (item.status === "published" ? "live" : "draft")
  };
}
