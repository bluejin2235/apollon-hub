"use client";

import Link from "next/link";
import { useMemo } from "react";
import { reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import {
  categoryBadgeClass,
  getRestaurantCategories,
  isRestaurantNewWithinDays,
  restaurantCategoryDisplayLabel,
  normalizeAtmosphereTag,
  atmosphereTagDisplayLabel,
  normalizeFoodTypeValue,
  type Restaurant,
  type Review,
  reviewStarsScore
} from "@/lib/restaurants/types";

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
  /** 최신 리뷰 첨부 경로(review-images) 최대 3개 */
  reviewImagePaths: string[];
};

const PREVIEW_SLOTS = 3;

export function RestaurantPreviewPanel({ restaurant, reviews, reviewImagePaths }: Props) {
  const { avg, count } = useMemo(() => {
    if (reviews.length === 0) return { avg: 0, count: 0 };
    const sum = reviews.reduce((s, r) => s + reviewStarsScore(r), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);

  const summary = useMemo(() => teamReviewSummary(reviews), [reviews]);

  if (!restaurant) {
    return (
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white px-4 py-8 text-center text-sm text-gray-600">
        목록에서 맛집을 선택하면 미리보기가 표시됩니다.
      </div>
    );
  }

  const foodTags = [...(restaurant.food_type ?? [])].slice(0, 4).map(normalizeFoodTypeValue).join(" · ");
  const atmosTags = [...(restaurant.atmosphere_tags ?? [])]
    .slice(0, 3)
    .map((t) => atmosphereTagDisplayLabel(normalizeAtmosphereTag(t)))
    .join(" · ");
  const catLine = getRestaurantCategories(restaurant).map(restaurantCategoryDisplayLabel).join(" · ");
  const tagLine = [catLine || null, foodTags || null, atmosTags || null].filter(Boolean).join(" / ");

  const paths = reviewImagePaths.slice(0, PREVIEW_SLOTS);
  const hasAnyImage = paths.length > 0;

  return (
    <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 grid grid-cols-3 gap-2">
        {hasAnyImage ? (
          Array.from({ length: PREVIEW_SLOTS }, (_, i) => {
            const path = paths[i];
            return (
              <div
                key={path ?? `empty-${i}`}
                className="aspect-[4/3] min-h-[72px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                {path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reviewImagePublicUrl(path)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-slate-50" />
                )}
              </div>
            );
          })
        ) : (
          <div className="col-span-3 flex aspect-[4/1] min-h-[72px] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-400">
            이미지 없음
          </div>
        )}
      </div>

      <div className="space-y-2">
        <span className="flex flex-wrap gap-1">
          {getRestaurantCategories(restaurant).map((cat) => (
            <span key={cat} className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${categoryBadgeClass(cat)}`}>
              {restaurantCategoryDisplayLabel(cat)}
            </span>
          ))}
          {isRestaurantNewWithinDays(restaurant.created_at) ? (
            <span className="inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/90">
              신규등록
            </span>
          ) : null}
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
