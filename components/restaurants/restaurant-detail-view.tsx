"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AshulengImageLightbox,
  type AshulengLightboxItem
} from "@/components/restaurants/ashuleng-image-lightbox";
import { ReviewWriteModal, reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  categoryBadgeClass,
  normalizeFoodTypeList,
  normalizeFoodTypeValue,
  normalizeRestaurantCategory,
  type ProfileLite,
  type Restaurant,
  type RestaurantCategory,
  type Review,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { keywordEmoji, keywordLabel } from "@/lib/restaurants/review-keywords";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";
import { supabase } from "@/lib/supabase/client";

const MENU_BUCKET = "menu-images";
const MEMO_MAX = 300;
const PHOTO_PAGE_SIZE = 10;
const REVIEW_PAGE_SIZE = 5;

function toggle<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
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

function parseMenuBulletLines(menu: string | null | undefined): string[] {
  if (!menu?.trim()) return [];
  return menu
    .split(/[·•\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatReviewCardDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function ReviewCommentClamp({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showToggle, setShowToggle] = useState(false);
  const pRef = useRef<HTMLParagraphElement>(null);
  const display = text.trim() || "내용 없음";

  useLayoutEffect(() => {
    const el = pRef.current;
    if (!el || expanded) return;
    const measure = () => {
      const node = pRef.current;
      if (!node || expanded) return;
      setShowToggle(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [display, expanded]);

  return (
    <div>
      <p
        ref={pRef}
        className={`text-sm leading-relaxed text-slate-800 whitespace-pre-wrap ${expanded ? "" : "line-clamp-2"}`}
      >
        {display}
      </p>
      {showToggle || expanded ? (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-500"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      ) : null}
    </div>
  );
}

function IconPin(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
      />
    </svg>
  );
}

export function RestaurantDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  /** menu-images 버킷에서 `id/` 접두사로 list 한 스토리지 경로들 */
  const [menuStoragePaths, setMenuStoragePaths] = useState<string[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editBasic, setEditBasic] = useState(false);
  const [editMemo, setEditMemo] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuUploadMsg, setMenuUploadMsg] = useState("");
  const [photoPage, setPhotoPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [lightboxItems, setLightboxItems] = useState<AshulengLightboxItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const [eName, setEName] = useState("");
  const [eCategory, setECategory] = useState<RestaurantCategory>("점심");
  const [eFoodTypes, setEFoodTypes] = useState<string[]>([]);
  const [eTags, setETags] = useState<string[]>([]);
  const [ePrice, setEPrice] = useState("");
  const [eTagline, setETagline] = useState("");
  const [eMenuText, setEMenuText] = useState("");
  const [eDescription, setEDescription] = useState("");

  const fetchMenuStoragePaths = useCallback(async (reason: string) => {
    const { data, error } = await supabase.storage.from(MENU_BUCKET).list(id, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) {
      console.error("[Ashuleng photo section] menu-images list failed", { reason, error });
      setMenuStoragePaths([]);
      return;
    }
    const paths = (data ?? [])
      .filter((item) => item.metadata != null)
      .map((item) => `${id}/${item.name}`);
    setMenuStoragePaths(paths);
  }, [id]);

  const fetchReviews = useCallback(
    async (reason: string) => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("restaurant_id", id)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[Ashuleng review] fetchReviews failed", { reason, error });
        return;
      }
      setReviews((data ?? []) as Review[]);
    },
    [id]
  );

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

    const [{ data: r }, { data: rv }, { data: p }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", id).maybeSingle(),
      supabase.from("reviews").select("*").eq("restaurant_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, email, name, department")
    ]);
    const rest = (r ?? null) as Restaurant | null;
    setRestaurant(rest);
    setReviews((rv ?? []) as Review[]);
    setProfiles((p ?? []) as ProfileLite[]);
    await fetchMenuStoragePaths("page load (load())");
    if (rest) {
      setEName(rest.name);
      setECategory(normalizeRestaurantCategory(rest.category));
      setEFoodTypes(normalizeFoodTypeList(rest.food_type));
      setETags([...(rest.atmosphere_tags ?? [])]);
      setEPrice(rest.price_range ?? "");
      setETagline(rest.tagline ?? "");
      setEMenuText(rest.menu ?? "");
      setEDescription(rest.description ?? "");
    }
    setLoading(false);
  }, [id, fetchMenuStoragePaths]);

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

  const keywordRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const rv of reviews) {
      for (const kid of rv.keyword_tags ?? []) {
        m.set(kid, (m.get(kid) ?? 0) + 1);
      }
    }
    return Array.from(m.entries())
      .map(([kid, n]) => ({
        id: kid,
        label: keywordLabel(kid),
        emoji: keywordEmoji(kid),
        count: n
      }))
      .sort((a, b) => b.count - a.count);
  }, [reviews]);

  const syncEditFromRestaurant = () => {
    if (!restaurant) return;
    setEName(restaurant.name);
    setECategory(normalizeRestaurantCategory(restaurant.category));
    setEFoodTypes(normalizeFoodTypeList(restaurant.food_type));
    setETags([...(restaurant.atmosphere_tags ?? [])]);
    setEPrice(restaurant.price_range ?? "");
    setETagline(restaurant.tagline ?? "");
    setEMenuText(restaurant.menu ?? "");
    setEDescription(restaurant.description ?? "");
  };

  const persistRestaurant = async (): Promise<boolean> => {
    if (!restaurant) return false;
    setSaving(true);
    const desc = eDescription.slice(0, MEMO_MAX);
    const { error } = await supabase
      .from("restaurants")
      .update({
        name: eName.trim(),
        category: eCategory,
        food_type: normalizeFoodTypeList(eFoodTypes),
        atmosphere_tags: eTags,
        price_range: ePrice.trim() || null,
        tagline: eTagline.trim() || null,
        menu: eMenuText.trim() || null,
        description: desc.trim() || null
      })
      .eq("id", restaurant.id);
    setSaving(false);
    if (error) {
      console.error(error);
      return false;
    }
    setRestaurant((prev) =>
      prev
        ? {
            ...prev,
            name: eName.trim(),
            category: eCategory,
            food_type: normalizeFoodTypeList(eFoodTypes),
            atmosphere_tags: eTags,
            price_range: ePrice.trim() || null,
            tagline: eTagline.trim() || null,
            menu: eMenuText.trim() || null,
            description: desc.trim() || null
          }
        : null
    );
    setEditBasic(false);
    return true;
  };

  const confirmDeleteRestaurant = async () => {
    if (!restaurant) return;
    setDeleteErr("");
    setDeleteBusy(true);
    const { error } = await supabase.from("restaurants").delete().eq("id", restaurant.id);
    setDeleteBusy(false);
    if (error) {
      console.error("[restaurants] delete failed", error);
      setDeleteErr(error.message);
      return;
    }
    setDeleteModalOpen(false);
    router.push("/restaurants");
  };

  const uploadMenuImages = async (fileList: FileList | null) => {
    if (!fileList?.length || !restaurant) return;
    setMenuUploadMsg("");
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      const msg = "로그인 세션이 없습니다. 다시 로그인한 뒤 업로드해 주세요.";
      setMenuUploadMsg(msg);
      console.error("[menu-images] upload aborted: no authenticated session");
      return;
    }

    setMenuSaving(true);
    const prevLen = (restaurant.menu_image_paths ?? []).length;
    const paths = [...(restaurant.menu_image_paths ?? [])];
    let firstErr: { message: string; status?: string } | null = null;

    for (const file of Array.from(fileList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${restaurant.id}/menu_${crypto.randomUUID()}.${ext}`;
      const contentType =
        file.type ||
        (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : undefined);

      const up = await supabase.storage.from(MENU_BUCKET).upload(path, file, {
        contentType: contentType || undefined,
        upsert: true
      });

      if (up.error) {
        console.error("[menu-images] storage upload failed", {
          path,
          bucket: MENU_BUCKET,
          error: up.error,
          hasSession: Boolean(session?.access_token)
        });
        if (!firstErr) firstErr = { message: up.error.message, status: up.error.name };
        continue;
      }
      paths.push(path);
    }

    setMenuSaving(false);

    if (firstErr && paths.length === prevLen) {
      setMenuUploadMsg(
        `업로드 실패: ${firstErr.message}. Storage RLS·버킷(menu-images)·로그인 상태를 확인해 주세요.`
      );
      return;
    }
    if (firstErr) {
      setMenuUploadMsg(`일부 파일만 업로드됨: ${firstErr.message}`);
    }

    const { error } = await supabase.from("restaurants").update({ menu_image_paths: paths }).eq("id", restaurant.id);
    if (error) {
      console.error("[menu-images] restaurants.update failed", error);
      setMenuUploadMsg(`DB 저장 실패: ${error.message}`);
      return;
    }
    setRestaurant((prev) => (prev ? { ...prev, menu_image_paths: paths } : null));
    await fetchMenuStoragePaths("after menu upload");
  };

  const menuLines = useMemo(() => parseMenuBulletLines(restaurant?.menu), [restaurant?.menu]);

  const reviewPhotoPaths = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of reviews) {
      for (const p of r.image_paths?.filter(Boolean) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  }, [reviews]);

  const photoWallItems = useMemo(() => {
    const seen = new Set<string>();
    const items: { kind: "menu" | "review"; path: string }[] = [];
    for (const p of menuStoragePaths) {
      if (seen.has(p)) continue;
      seen.add(p);
      items.push({ kind: "menu", path: p });
    }
    for (const p of reviewPhotoPaths) {
      if (seen.has(p)) continue;
      seen.add(p);
      items.push({ kind: "review", path: p });
    }
    return items;
  }, [menuStoragePaths, reviewPhotoPaths]);

  const photoTotalPages = Math.max(1, Math.ceil(photoWallItems.length / PHOTO_PAGE_SIZE));
  const photoPageSlice = useMemo(() => {
    const start = (photoPage - 1) * PHOTO_PAGE_SIZE;
    return photoWallItems.slice(start, start + PHOTO_PAGE_SIZE);
  }, [photoWallItems, photoPage]);

  useEffect(() => {
    setPhotoPage((p) => Math.min(Math.max(1, p), photoTotalPages));
  }, [photoTotalPages]);

  const reviewTotalPages = Math.max(1, Math.ceil(reviews.length / REVIEW_PAGE_SIZE));
  const reviewPageSlice = useMemo(() => {
    const start = (reviewPage - 1) * REVIEW_PAGE_SIZE;
    return reviews.slice(start, start + REVIEW_PAGE_SIZE);
  }, [reviews, reviewPage]);

  useEffect(() => {
    setReviewPage((p) => Math.min(Math.max(1, p), reviewTotalPages));
  }, [reviewTotalPages]);

  const openPhotoWallLightbox = useCallback(
    (globalIdx: number) => {
      const items: AshulengLightboxItem[] = photoWallItems.map((item) => ({
        id: `${item.kind}-${item.path}`,
        src: item.kind === "menu" ? menuPublicUrl(item.path) : reviewImagePublicUrl(item.path),
        showMenuBadge: item.kind === "menu"
      }));
      if (items.length === 0) return;
      const idx = Math.min(Math.max(0, globalIdx), items.length - 1);
      setLightboxItems(items);
      setLightboxIndex(idx);
    },
    [photoWallItems]
  );

  const openReviewImagesLightbox = useCallback((paths: string[], reviewId: string, startIndex: number) => {
    const filtered = paths.filter(Boolean);
    if (filtered.length === 0) return;
    const items: AshulengLightboxItem[] = filtered.map((path, i) => ({
      id: `${reviewId}-${path}-${i}`,
      src: reviewImagePublicUrl(path),
      showMenuBadge: false
    }));
    const idx = Math.min(Math.max(0, startIndex), items.length - 1);
    setLightboxItems(items);
    setLightboxIndex(idx);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxItems([]);
    setLightboxIndex(0);
  }, []);

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

  return (
    <div className="min-h-0 bg-white pb-16 pt-1">
      <div className="mb-6">
        <Link href="/restaurants" className="text-sm text-slate-500 hover:text-slate-800">
          ← 맛집 목록
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
        {/* 좌측 */}
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">기본 정보</h2>
              {editBasic ? (
                <div className="flex items-center gap-2">
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
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    onClick={() => void persistRestaurant()}
                  >
                    저장
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-500"
                  onClick={() => {
                    setEditMemo(false);
                    setEditBasic(true);
                  }}
                >
                  수정
                </button>
              )}
            </div>

            {editBasic ? (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">가게명</label>
                  <input
                    value={eName}
                    onChange={(e) => setEName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">카테고리</label>
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
                  <p className="mb-2 text-xs font-semibold text-slate-700">음식 종류</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FOOD_TYPE_OPTIONS.map((ft) => (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setEFoodTypes((p) => toggle(p, ft))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          eFoodTypes.includes(ft) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {ft}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-slate-700">분위기 · 특징</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATMOSPHERE_TAG_OPTIONS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setETags((p) => toggle(p, t))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          eTags.includes(t) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">가격대</label>
                  <input
                    value={ePrice}
                    onChange={(e) => setEPrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="예: 1만5천원대"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">한 줄 소개</label>
                  <input
                    value={eTagline}
                    onChange={(e) => setETagline(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">대표 메뉴 (텍스트)</label>
                  <textarea
                    value={eMenuText}
                    onChange={(e) => setEMenuText(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                    placeholder="예: 설렁탕 12,000원 · 만두국 13,000원"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">소개 메모</label>
                  <div className="relative">
                    <textarea
                      value={eDescription}
                      onChange={(e) => setEDescription(e.target.value.slice(0, MEMO_MAX))}
                      rows={5}
                      maxLength={MEMO_MAX}
                      className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 pb-8 text-sm text-gray-900"
                    />
                    <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-slate-400">
                      {eDescription.length} / {MEMO_MAX}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold leading-tight text-slate-900 sm:text-3xl">{restaurant.name}</p>

                <div className="mt-5 flex flex-wrap items-start gap-3">
                  <div className="flex min-w-0 flex-1 gap-2">
                    <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                    <p className="text-sm leading-relaxed text-slate-700">{restaurant.address}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a
                      href={naverMapSearchUrl(restaurant.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-lg border-2 border-emerald-500 bg-white px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 sm:text-sm"
                    >
                      네이버 지도
                    </a>
                    <a
                      href={kakaoMapUrl(restaurant.name, restaurant.lat, restaurant.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-lg border-2 border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 sm:text-sm"
                    >
                      카카오맵
                    </a>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="mb-2 text-sm font-bold text-slate-900">카테고리</p>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${categoryBadgeClass(restaurant.category)}`}>
                      {normalizeRestaurantCategory(restaurant.category)}
                    </span>
                    {(restaurant.food_type ?? []).map((ft) => (
                      <span key={ft} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {normalizeFoodTypeValue(ft)}
                      </span>
                    ))}
                    {(restaurant.atmosphere_tags ?? []).map((t) => (
                      <span
                        key={t}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                      >
                        {t === "분위기좋은" ? "분위기 좋은" : t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <p className="mb-2 text-sm font-bold text-slate-900">대표 메뉴</p>
                  {menuLines.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {menuLines.map((line, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-slate-400">·</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400">등록된 대표 메뉴가 없습니다.</p>
                  )}
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-900">소개 메모</p>
                    {editMemo ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-sm text-slate-500 hover:text-slate-800"
                          onClick={() => {
                            setEDescription(restaurant.description ?? "");
                            setEditMemo(false);
                          }}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                          onClick={() =>
                            void (async () => {
                              const ok = await persistRestaurant();
                              if (ok) setEditMemo(false);
                            })()
                          }
                        >
                          저장
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-sm font-semibold text-blue-600 hover:text-blue-500"
                        onClick={() => setEditMemo(true)}
                      >
                        수정
                      </button>
                    )}
                  </div>
                  {editMemo ? (
                    <div className="relative">
                      <textarea
                        value={eDescription}
                        onChange={(e) => setEDescription(e.target.value.slice(0, MEMO_MAX))}
                        rows={5}
                        maxLength={MEMO_MAX}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 pb-8 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="매장을 소개해 주세요."
                      />
                      <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-slate-400">
                        {eDescription.length} / {MEMO_MAX}
                      </span>
                    </div>
                  ) : (restaurant.description ?? "").trim() ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{restaurant.description}</p>
                  ) : (
                    <p className="text-sm text-slate-400">—</p>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-base font-bold text-slate-900">사진 ({photoWallItems.length}장)</h2>
            <p className="mb-3 text-xs text-slate-500">
              메뉴 이미지(menu-images)가 먼저 오고, 이어서 리뷰에 첨부된 사진이 표시됩니다.
            </p>
            {photoWallItems.length > 0 ? (
              <>
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {photoPageSlice.map((item, idx) => {
                    const globalIdx = (photoPage - 1) * PHOTO_PAGE_SIZE + idx;
                    return (
                      <li
                        key={`${item.kind}-${item.path}`}
                        className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                      >
                        <button
                          type="button"
                          onClick={() => openPhotoWallLightbox(globalIdx)}
                          className="absolute inset-0 z-0 block h-full w-full cursor-zoom-in text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                          aria-label={`사진 ${globalIdx + 1} 확대 보기`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.kind === "menu" ? menuPublicUrl(item.path) : reviewImagePublicUrl(item.path)}
                            alt=""
                            className={`pointer-events-none h-full w-full ${item.kind === "menu" ? "object-contain" : "object-cover"}`}
                          />
                        </button>
                        {globalIdx === 0 ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] bg-black/55 py-1 text-center text-[10px] font-medium text-white sm:text-xs">
                            대표 사진
                          </span>
                        ) : null}
                        {item.kind === "menu" ? (
                          <span
                            className="pointer-events-none absolute left-1 top-1 z-[1] rounded bg-red-600/95 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm sm:text-[10px]"
                            title="메뉴 이미지"
                          >
                            메뉴
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {photoWallItems.length > PHOTO_PAGE_SIZE ? (
                  <nav
                    className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600"
                    aria-label="사진 페이지"
                  >
                    <button
                      type="button"
                      aria-label="이전 페이지"
                      disabled={photoPage <= 1}
                      className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                      onClick={() => setPhotoPage((p) => Math.max(1, p - 1))}
                    >
                      {"<"}
                    </button>
                    {Array.from({ length: photoTotalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPhotoPage(p)}
                        className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                          p === photoPage
                            ? "font-bold text-slate-900 underline decoration-slate-900 decoration-2 underline-offset-4"
                            : "font-normal hover:text-slate-900"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="다음 페이지"
                      disabled={photoPage >= photoTotalPages}
                      className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                      onClick={() => setPhotoPage((p) => Math.min(photoTotalPages, p + 1))}
                    >
                      {">"}
                    </button>
                  </nav>
                ) : null}
              </>
            ) : (
              <p className="mb-4 text-sm text-slate-400">등록된 사진이 없습니다.</p>
            )}

            <div className="mt-4 border-t border-slate-100 pt-4">
              {menuUploadMsg ? <p className="mb-2 text-sm text-rose-600">{menuUploadMsg}</p> : null}
              <label className="inline-flex cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                메뉴 이미지 업로드
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void uploadMenuImages(e.target.files)}
                />
              </label>
              {menuSaving ? <span className="ml-2 text-xs text-slate-500">업로드 중…</span> : null}
            </div>
          </section>
        </div>

        {/* 우측 */}
        <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xl leading-none text-amber-400" aria-hidden>
                ★
              </span>
              <div>
                <p className="text-lg font-bold text-slate-900 sm:text-xl">
                  {avg > 0 ? `${avg.toFixed(1)}` : "—"} / 5.0{" "}
                  <span className="font-semibold text-slate-600">
                    ({count}명 참여)
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!myProfileId}
              onClick={() => setReviewOpen(true)}
              className="shrink-0 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              리뷰 등록
            </button>
          </div>

          <div className="mb-6">
            <h3 className="mb-3 text-sm font-bold text-slate-900">맛집 키워드 (복수 선택)</h3>
            {keywordRows.length === 0 ? (
              <p className="text-sm text-slate-400">아직 키워드가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                {keywordRows.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-3 text-sm">
                    <span className="text-lg leading-none" aria-hidden>
                      {row.emoji}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-800">{row.label}</span>
                    <span className="shrink-0 tabular-nums font-semibold text-blue-600">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold text-slate-900">리뷰 목록</h3>
            {reviews.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">리뷰가 없습니다.</p>
            ) : (
              <>
                <ul className="space-y-3">
                  {reviewPageSlice.map((rv) => {
                    const who = profileMap.get(rv.reviewer_id);
                    const reviewPhotos = rv.image_paths?.filter(Boolean) ?? [];
                    return (
                      <li
                        key={rv.id}
                        className="rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-3 transition hover:border-slate-200 hover:bg-slate-50"
                      >
                        <ReviewCommentClamp text={rv.comment ?? ""} />
                        {reviewPhotos.length > 0 ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {reviewPhotos.slice(0, 5).map((path, thumbIdx) => (
                              <li
                                key={`${rv.id}-${path}`}
                                className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                              >
                                <button
                                  type="button"
                                  onClick={() => openReviewImagesLightbox(reviewPhotos, rv.id, thumbIdx)}
                                  className="block h-full w-full cursor-zoom-in overflow-hidden rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                                  aria-label={`리뷰 첨부 사진 ${thumbIdx + 1} 확대`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={reviewImagePublicUrl(path)}
                                    alt=""
                                    className="pointer-events-none h-full w-full object-cover"
                                  />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="mt-2 text-xs text-slate-500">
                          {formatReviewCardDate(rv.created_at)} · {who?.name ?? "멤버"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {reviews.length > REVIEW_PAGE_SIZE ? (
                  <nav
                    className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600"
                    aria-label="리뷰 페이지"
                  >
                    <button
                      type="button"
                      aria-label="이전 페이지"
                      disabled={reviewPage <= 1}
                      className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                      onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
                    >
                      {"<"}
                    </button>
                    {Array.from({ length: reviewTotalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setReviewPage(p)}
                        className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                          p === reviewPage
                            ? "font-bold text-slate-900 underline decoration-slate-900 decoration-2 underline-offset-4"
                            : "font-normal hover:text-slate-900"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="다음 페이지"
                      disabled={reviewPage >= reviewTotalPages}
                      className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                      onClick={() => setReviewPage((p) => Math.min(reviewTotalPages, p + 1))}
                    >
                      {">"}
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </div>
        </section>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setDeleteErr("");
              setDeleteModalOpen(true);
            }}
            className="text-xs font-medium text-slate-400 no-underline decoration-transparent outline-none transition-colors hover:text-red-600 focus-visible:text-red-600 active:text-red-600"
          >
            맛집 삭제
          </button>
        </div>
        </div>
      </div>

      {deleteModalOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-restaurant-title"
          onClick={() => {
            if (!deleteBusy) setDeleteModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-restaurant-title" className="sr-only">
              맛집 삭제 확인
            </h2>
            <p className="text-sm leading-relaxed text-slate-800">
              정말 삭제하시겠어요? 이 맛집의 모든 리뷰와 사진도 함께 삭제됩니다.
            </p>
            {deleteErr ? <p className="mt-3 text-sm text-rose-600">{deleteErr}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                onClick={() => setDeleteModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                onClick={() => void confirmDeleteRestaurant()}
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AshulengImageLightbox
        open={lightboxItems.length > 0}
        items={lightboxItems}
        index={lightboxIndex}
        onClose={closeLightbox}
        onIndexChange={setLightboxIndex}
      />

      {myProfileId ? (
        <ReviewWriteModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          profileId={myProfileId}
          onSaved={(row) => {
            console.log("[Ashuleng review] onSaved", { id: row.id, image_paths: row.image_paths });
            void fetchReviews("after review submit (onSaved)");
          }}
        />
      ) : null}
    </div>
  );
}
