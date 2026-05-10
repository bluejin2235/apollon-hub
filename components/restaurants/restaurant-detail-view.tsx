"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewWriteModal, reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  categoryBadgeClass,
  type ProfileLite,
  type Restaurant,
  type RestaurantCategory,
  type RestaurantImageRow,
  type Review,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { keywordLabel, REVISIT_OPTIONS, type RevisitIntent } from "@/lib/restaurants/review-keywords";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";
import { supabase } from "@/lib/supabase/client";

const GALLERY_BUCKET = "restaurant-images";
const MENU_BUCKET = "menu-images";

function toggle<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function galleryPublicUrl(path: string): string {
  return storagePublicUrl(GALLERY_BUCKET, path);
}

function menuPublicUrl(path: string): string {
  return storagePublicUrl(MENU_BUCKET, path);
}

function naverMapSearchUrl(query: string): string {
  return `https://map.naver.com/v5/search/${encodeURIComponent(query)}`;
}

function kakaoMapUrl(name: string, lat: number | null, lng: number | null): string {
  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(name)}`;
}

function revisitDisplay(rv: Review): { icon: string; label: string } {
  const intent = rv.revisit_intent as RevisitIntent | null;
  const hit = REVISIT_OPTIONS.find((o) => o.id === intent);
  if (hit) return { icon: hit.icon, label: hit.label };
  if (rv.revisit) return { icon: "✅", label: "또 가고 싶다" };
  return { icon: "🤔", label: "글쎄" };
}

function AvgStarsBlock({ avg, count }: { avg: number; count: number }) {
  const stars = [1, 2, 3, 4, 5].map((i) => {
    if (avg >= i) return "full";
    if (avg >= i - 0.5) return "half";
    return "empty";
  });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <span className="text-3xl font-bold text-amber-600">{avg > 0 ? avg.toFixed(1) : "—"}</span>
      <div className="flex gap-0.5 text-2xl leading-none text-amber-500">
        {stars.map((t, i) => (
          <span key={i} className="relative inline-block w-[1em] text-center">
            {t === "full" ? (
              "★"
            ) : t === "half" ? (
              <span className="relative inline-block w-[1em]">
                <span className="text-slate-300">★</span>
                <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-amber-500">★</span>
              </span>
            ) : (
              <span className="text-slate-300">★</span>
            )}
          </span>
        ))}
      </div>
      <span className="text-sm text-slate-500">리뷰 {count}건</span>
    </div>
  );
}

function SmallStars({ value }: { value: number }) {
  const stars = [1, 2, 3, 4, 5].map((i) => {
    if (value >= i) return "full";
    if (value >= i - 0.5) return "half";
    return "empty";
  });
  return (
    <div className="flex gap-0.5 text-base leading-none text-amber-500">
      {stars.map((t, i) => (
        <span key={i} className="relative inline-block w-[0.85em] text-center">
          {t === "full" ? (
            "★"
          ) : t === "half" ? (
            <span className="relative inline-block w-[0.85em]">
              <span className="text-slate-300">★</span>
              <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-amber-500">★</span>
            </span>
          ) : (
            <span className="text-slate-300">★</span>
          )}
        </span>
      ))}
    </div>
  );
}

export function RestaurantDetailView({ id }: { id: string }) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [images, setImages] = useState<RestaurantImageRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editBasic, setEditBasic] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [savingBasic, setSavingBasic] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);

  const [eName, setEName] = useState("");
  const [eCategory, setECategory] = useState<RestaurantCategory>("점심");
  const [eFoodTypes, setEFoodTypes] = useState<string[]>([]);
  const [eTags, setETags] = useState<string[]>([]);
  const [ePrice, setEPrice] = useState("");
  const [eTagline, setETagline] = useState("");
  const [eMenuText, setEMenuText] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    let pid: string | null = null;
    if (user?.email) {
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", user.email).maybeSingle();
      pid = prof?.id ?? null;
    }
    setMyProfileId(pid);

    const [{ data: r }, { data: imgs }, { data: rv }, { data: p }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", id).maybeSingle(),
      supabase.from("restaurant_images").select("*").eq("restaurant_id", id).order("created_at", { ascending: true }),
      supabase.from("reviews").select("*").eq("restaurant_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, email, name, department")
    ]);
    const rest = (r ?? null) as Restaurant | null;
    setRestaurant(rest);
    setImages((imgs ?? []) as RestaurantImageRow[]);
    setReviews((rv ?? []) as Review[]);
    setProfiles((p ?? []) as ProfileLite[]);
    if (rest) {
      setEName(rest.name);
      setECategory((RESTAURANT_CATEGORY_META.some((c) => c.key === rest.category) ? rest.category : "점심") as RestaurantCategory);
      setEFoodTypes([...(rest.food_type ?? [])]);
      setETags([...(rest.atmosphere_tags ?? [])]);
      setEPrice(rest.price_range ?? "");
      setETagline(rest.tagline ?? "");
      setEMenuText(rest.menu ?? "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    profiles.forEach((x) => m.set(x.id, x));
    return m;
  }, [profiles]);

  const { avg, count } = useMemo(() => {
    if (reviews.length === 0) return { avg: 0, count: 0 };
    const sum = reviews.reduce((s, rv) => s + reviewStarsScore(rv), 0);
    return { avg: sum / reviews.length, count: reviews.length };
  }, [reviews]);

  const syncEditFromRestaurant = () => {
    if (!restaurant) return;
    setEName(restaurant.name);
    setECategory(
      (RESTAURANT_CATEGORY_META.some((c) => c.key === restaurant.category) ? restaurant.category : "점심") as RestaurantCategory
    );
    setEFoodTypes([...(restaurant.food_type ?? [])]);
    setETags([...(restaurant.atmosphere_tags ?? [])]);
    setEPrice(restaurant.price_range ?? "");
    setETagline(restaurant.tagline ?? "");
    setEMenuText(restaurant.menu ?? "");
  };

  const saveBasic = async () => {
    if (!restaurant) return;
    setSavingBasic(true);
    const { error } = await supabase
      .from("restaurants")
      .update({
        name: eName.trim(),
        category: eCategory,
        food_type: eFoodTypes,
        atmosphere_tags: eTags,
        price_range: ePrice.trim() || null,
        tagline: eTagline.trim() || null
      })
      .eq("id", restaurant.id);
    setSavingBasic(false);
    if (error) {
      console.error(error);
      return;
    }
    setRestaurant((prev) =>
      prev
        ? {
            ...prev,
            name: eName.trim(),
            category: eCategory,
            food_type: eFoodTypes,
            atmosphere_tags: eTags,
            price_range: ePrice.trim() || null,
            tagline: eTagline.trim() || null
          }
        : null
    );
    setEditBasic(false);
  };

  const uploadGallery = async (fileList: FileList | null) => {
    if (!fileList?.length || !restaurant || !myProfileId) return;
    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${restaurant.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(GALLERY_BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false
      });
      if (upErr) {
        console.error(upErr);
        continue;
      }
      const { data: row, error } = await supabase
        .from("restaurant_images")
        .insert({ restaurant_id: restaurant.id, storage_path: path, uploaded_by: myProfileId })
        .select("*")
        .single();
      if (!error && row) setImages((prev) => [...prev, row as RestaurantImageRow]);
    }
  };

  const uploadMenuImages = async (fileList: FileList | null) => {
    if (!fileList?.length || !restaurant) return;
    setMenuSaving(true);
    const paths = [...(restaurant.menu_image_paths ?? [])];
    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${restaurant.id}/menu_${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(MENU_BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false
      });
      if (!upErr) paths.push(path);
    }
    const { error } = await supabase.from("restaurants").update({ menu_image_paths: paths }).eq("id", restaurant.id);
    setMenuSaving(false);
    if (error) {
      console.error(error);
      return;
    }
    setRestaurant((prev) => (prev ? { ...prev, menu_image_paths: paths } : null));
  };

  const saveMenuText = async () => {
    if (!restaurant) return;
    setMenuSaving(true);
    const { error } = await supabase.from("restaurants").update({ menu: eMenuText.trim() || null }).eq("id", restaurant.id);
    setMenuSaving(false);
    if (error) {
      console.error(error);
      return;
    }
    setRestaurant((prev) => (prev ? { ...prev, menu: eMenuText.trim() || null } : null));
  };

  if (loading) {
    return <p className="py-12 text-center text-slate-500">불러오는 중...</p>;
  }

  if (!restaurant) {
    return (
      <p className="text-slate-600">
        맛집을 찾을 수 없습니다.{" "}
        <Link href="/restaurants" className="text-blue-600 hover:underline">
          목록으로
        </Link>
      </p>
    );
  }

  const menuPaths = restaurant.menu_image_paths ?? [];

  return (
    <div className="space-y-8 pb-12">
      <Link href="/restaurants" className="text-sm font-medium text-blue-600 hover:underline">
        ← 맛집 목록
      </Link>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        {/* 좌측 */}
        <div className="space-y-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">매장 사진</h2>
              <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
                사진 추가
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void uploadGallery(e.target.files)} />
              </label>
            </div>
            {images.length === 0 ? (
              <p className="text-sm text-slate-500">등록된 사진이 없습니다.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img) => (
                  <li key={img.id} className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={galleryPublicUrl(img.storage_path)} alt="" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">기본 정보</h2>
              {editBasic ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-sm text-slate-500 hover:text-slate-800"
                    onClick={() => {
                      syncEditFromRestaurant();
                      setEditBasic(false);
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={savingBasic}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    onClick={() => void saveBasic()}
                  >
                    저장
                  </button>
                </div>
              ) : (
                <button type="button" className="text-sm font-medium text-blue-600 hover:underline" onClick={() => setEditBasic(true)}>
                  수정
                </button>
              )}
            </div>

            {editBasic ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">가게명</label>
                  <input
                    value={eName}
                    onChange={(e) => setEName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">카테고리</label>
                  <select
                    value={eCategory}
                    onChange={(e) => setECategory(e.target.value as RestaurantCategory)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    {RESTAURANT_CATEGORY_META.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-600">음식 종류</p>
                  <div className="flex flex-wrap gap-1">
                    {FOOD_TYPE_OPTIONS.map((ft) => (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setEFoodTypes((p) => toggle(p, ft))}
                        className={`rounded-full px-2 py-0.5 text-xs ${eFoodTypes.includes(ft) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                      >
                        {ft}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-600">태그 (분위기·특징)</p>
                  <div className="flex flex-wrap gap-1">
                    {ATMOSPHERE_TAG_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setETags((p) => toggle(p, t))}
                        className={`rounded-full px-2 py-0.5 text-xs ${eTags.includes(t) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">가격대</label>
                  <input
                    value={ePrice}
                    onChange={(e) => setEPrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="예: 1만5천원대"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">한 줄 소개</label>
                  <input
                    value={eTagline}
                    onChange={(e) => setETagline(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="한 줄로 매장을 소개해 주세요"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-2xl font-bold text-slate-900">{restaurant.name}</p>
                <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${categoryBadgeClass(restaurant.category)}`}>
                  {restaurant.category}
                </span>
                {(restaurant.food_type?.length ?? 0) > 0 ? (
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">음식 종류:</span> {(restaurant.food_type ?? []).join(", ")}
                  </p>
                ) : null}
                {(restaurant.atmosphere_tags?.length ?? 0) > 0 ? (
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">태그:</span> {(restaurant.atmosphere_tags ?? []).join(", ")}
                  </p>
                ) : null}
                {restaurant.price_range ? (
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">가격대:</span> {restaurant.price_range}
                  </p>
                ) : null}
                {restaurant.tagline ? <p className="text-slate-800">{restaurant.tagline}</p> : <p className="text-sm text-slate-400">한 줄 소개 없음</p>}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-lg font-bold text-slate-900">주소</h2>
            <p className="text-sm text-slate-700">{restaurant.address}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={naverMapSearchUrl(restaurant.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg border border-green-600 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-100"
              >
                네이버 지도
              </a>
              <a
                href={kakaoMapUrl(restaurant.name, restaurant.lat, restaurant.lng)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                카카오맵
              </a>
            </div>
          </section>
        </div>

        {/* 우측 */}
        <div className="flex flex-col gap-8">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">메뉴판</h2>
              <label className="cursor-pointer rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                메뉴 이미지 업로드
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void uploadMenuImages(e.target.files)} />
              </label>
            </div>
            {menuPaths.length > 0 ? (
              <ul className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {menuPaths.map((p) => (
                  <li key={p} className="aspect-[3/4] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={menuPublicUrl(p)} alt="메뉴" className="h-full w-full object-contain" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-slate-500">메뉴 이미지가 없습니다.</p>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600">메뉴 텍스트</label>
            <textarea
              value={eMenuText}
              onChange={(e) => setEMenuText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="대표 메뉴·가격 등을 적어주세요"
            />
            <button
              type="button"
              disabled={menuSaving}
              onClick={() => void saveMenuText()}
              className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              메뉴 텍스트 저장
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">아슐랭 멤버 리뷰</h2>
              <button
                type="button"
                disabled={!myProfileId}
                onClick={() => setReviewOpen(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                리뷰 작성
              </button>
            </div>
            <AvgStarsBlock avg={avg} count={count} />

            <ul className="mt-6 space-y-6 divide-y divide-slate-100">
              {reviews.map((rv) => {
                const who = profileMap.get(rv.reviewer_id);
                const score = reviewStarsScore(rv);
                const rev = revisitDisplay(rv);
                const kws = rv.keyword_tags ?? [];
                const imgs = rv.image_paths ?? [];
                return (
                  <li key={rv.id} className="pt-6 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{who?.name ?? "멤버"}</span>
                      <SmallStars value={score} />
                      <span className="text-sm font-medium text-amber-700">{score.toFixed(1)}</span>
                    </div>
                    {kws.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {kws.map((kid) => (
                          <span key={kid} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                            {keywordLabel(kid)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {rv.comment ? <p className="mt-2 text-sm text-slate-700">{rv.comment}</p> : null}
                    {imgs.length > 0 ? (
                      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {imgs.map((ip) => (
                          <li key={ip} className="aspect-square overflow-hidden rounded-lg border border-slate-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={reviewImagePublicUrl(ip)} alt="" className="h-full w-full object-cover" />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                      <span className="mr-2">{rev.icon}</span>
                      {rev.label}
                      {rv.visit_date ? <span className="ml-2">· 방문 {rv.visit_date}</span> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
            {reviews.length === 0 ? <p className="mt-4 text-center text-sm text-slate-500">리뷰가 없습니다.</p> : null}
          </section>
        </div>
      </div>

      {myProfileId ? (
        <ReviewWriteModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          restaurantId={restaurant.id}
          profileId={myProfileId}
          onSaved={(row) => {
            setReviews((prev) => [row, ...prev]);
          }}
        />
      ) : null}
    </div>
  );
}
