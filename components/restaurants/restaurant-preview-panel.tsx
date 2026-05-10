"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  categoryBadgeClass,
  normalizeFoodTypeValue,
  normalizeRestaurantCategory,
  type Restaurant,
  type Review,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";

const GALLERY_BUCKET = "restaurant-images";
const MENU_BUCKET = "menu-images";

function galleryUrl(path: string): string {
  return storagePublicUrl(GALLERY_BUCKET, path);
}

function menuUrl(path: string): string {
  return storagePublicUrl(MENU_BUCKET, path);
}

function teamReviewSummary(reviews: Review[]): string {
  const texts = reviews
    .map((r) => r.comment?.trim())
    .filter((t): t is string => Boolean(t))
    .slice(0, 4);
  if (texts.length === 0) return "아직 팀 리뷰 요약이 없습니다. 상세 페이지에서 리뷰를 남겨 주세요.";
  const joined = texts.join(" ");
  return joined.length > 220 ? `${joined.slice(0, 220)}…` : joined;
}

type Props = {
  restaurant: Restaurant | null;
  reviews: Review[];
  imagePaths: string[];
  /** 각 path가 갤러리인지 메뉴 이미지인지 (같은 버킷 구분) */
  imageSources?: ("gallery" | "menu")[];
};

export function RestaurantPreviewPanel({ restaurant, reviews, imagePaths, imageSources }: Props) {
  const { avg, count } = useMemo(() => {
    if (reviews.length === 0) return { avg: 0, count: 0 };
    const sum = reviews.reduce((s, r) => s + reviewStarsScore(r), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);

  const summary = useMemo(() => teamReviewSummary(reviews), [reviews]);

  const urls = useMemo(() => {
    return imagePaths.map((p, i) => {
      const src = imageSources?.[i] === "menu" ? menuUrl(p) : galleryUrl(p);
      return { src, key: `${i}-${p}` };
    });
  }, [imagePaths, imageSources]);

  if (!restaurant) {
    return (
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white px-4 py-8 text-center text-sm text-gray-600">
        목록에서 맛집을 선택하면 미리보기가 표시됩니다.
      </div>
    );
  }

  const main = urls[0];
  const sub1 = urls[1];
  const sub2 = urls[2];

  const foodTags = [...(restaurant.food_type ?? [])].slice(0, 4).map(normalizeFoodTypeValue).join(" · ");
  const atmosTags = [...(restaurant.atmosphere_tags ?? [])].slice(0, 3).join(" · ");
  const tagLine = [normalizeRestaurantCategory(restaurant.category), foodTags || null, atmosTags || null]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 gap-2 sm:w-[280px]">
          <div className="aspect-[4/3] min-h-[120px] flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {main ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={main.src} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">이미지 없음</div>
            )}
          </div>
          <div className="flex w-[72px] flex-col gap-2">
            {[sub1, sub2].map((u, idx) => (
              <div
                key={u?.key ?? `empty-${idx}`}
                className="aspect-square w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                {u ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-slate-50" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${categoryBadgeClass(restaurant.category)}`}>
            {normalizeRestaurantCategory(restaurant.category)}
          </span>
          <h3 className="text-lg font-bold text-slate-900">{restaurant.name}</h3>
          {tagLine ? <p className="text-xs text-slate-600">{tagLine}</p> : null}
          <p className="text-sm text-slate-800">
            <span className="text-amber-600">★</span>{" "}
            <span className="font-semibold">{count > 0 ? avg.toFixed(1) : "—"}</span>
            <span className="text-slate-500"> ({count})</span>
            {count > 0 ? <span className="text-slate-500"> · 리뷰 {count}개</span> : null}
            {restaurant.price_range ? (
              <>
                <span className="text-slate-400"> · </span>
                <span>{restaurant.price_range}</span>
              </>
            ) : null}
          </p>
          <p className="flex items-start gap-1 text-sm text-slate-600">
            <span className="mt-0.5 text-slate-400" aria-hidden>
              📍
            </span>
            <span>{restaurant.address}</span>
          </p>
          <Link href={`/restaurants/${restaurant.id}`} className="inline-block text-sm font-medium text-blue-600 hover:underline">
            상세 보기 →
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
          <p className="text-xs font-semibold text-slate-700">팀 리뷰 요약</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{summary}</p>
        </div>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 text-left transition hover:bg-slate-100"
        >
          <div>
            <p className="text-xs font-semibold text-slate-700">팀 평점</p>
            <p className="mt-2 text-sm text-slate-900">
              <span className="text-amber-600">★</span>{" "}
              <span className="font-bold">{count > 0 ? avg.toFixed(1) : "—"}</span>
              <span className="text-slate-500"> / 5.0</span>
              {count > 0 ? <span className="text-slate-500"> ({count}명 참여)</span> : null}
            </p>
          </div>
          <span className="text-slate-400" aria-hidden>
            ›
          </span>
        </button>
      </div>
    </div>
  );
}
