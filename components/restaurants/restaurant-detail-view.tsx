"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AshulengImageLightbox,
  type AshulengLightboxItem
} from "@/components/restaurants/ashuleng-image-lightbox";
import { ReviewWriteModal, reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import { SharePageButton } from "@/components/ui/share-page-button";
import { loadKakaoMapsSdk } from "@/lib/kakao/load-maps-sdk";
import {
  RESTAURANT_REACTION_EMOJIS,
  REVIEW_REACTION_EMOJIS,
  type RestaurantReactionRow,
  type ReviewReactionRow
} from "@/lib/restaurants/reactions";
import {
  ATMOSPHERE_TAG_OPTIONS,
  categoryBadgeClass,
  categoryFieldsForDb,
  FOOD_TYPE_OPTIONS,
  getRestaurantCategories,
  atmosphereTagDisplayLabel,
  normalizeAtmosphereTag,
  normalizeAtmosphereTagList,
  normalizeFoodTypeList,
  normalizeFoodTypeValue,
  RESTAURANT_CATEGORY_META,
  restaurantCategoryDisplayLabel,
  type ProfileLite,
  type Restaurant,
  type RestaurantCategory,
  type Review,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { formatMenuAndPriceRange, parseMenuStringToRows, type MenuRow } from "@/lib/restaurants/menu-rows";
import { keywordEmoji, keywordLabel } from "@/lib/restaurants/review-keywords";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";
import { useCanManageRestaurant } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

const MENU_BUCKET = "menu-images";
const REVIEW_BUCKET = "review-images";
const MEMO_MAX = 300;
const REVIEW_PAGE_SIZE = 5;
const REVIEW_GALLERY_MAX = 8;

function toggle<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function menuPublicUrl(path: string): string {
  return storagePublicUrl(MENU_BUCKET, path);
}

function naverMapUrl(query: string): string {
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

function IconTrash(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
      />
    </svg>
  );
}

type KakaoMapsApi = {
  Map: new (el: HTMLElement, opts: { center: unknown; level: number }) => {
    relayout: () => void;
  };
  LatLng: new (lat: number, lng: number) => unknown;
  Marker: new (opts: { position: unknown; map: unknown }) => unknown;
};

function kakaoMaps(): KakaoMapsApi {
  const m = (window as unknown as { kakao?: { maps: KakaoMapsApi } }).kakao?.maps;
  if (!m) throw new Error("kakao.maps 없음");
  return m;
}

function resolveRestaurantCoords(
  lat: number | null,
  lng: number | null
): { lat: number; lng: number } | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

function RestaurantDetailMapEmbed({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await loadKakaoMapsSdk();
        if (cancelled || !containerRef.current) return;
        const M = kakaoMaps();
        const center = new M.LatLng(lat, lng);
        const map = new M.Map(containerRef.current, { center, level: 4 });
        new M.Marker({ position: center, map });
        window.setTimeout(() => map.relayout(), 100);
      } catch (e) {
        console.error("[RestaurantDetailMapEmbed] map init failed", e);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      aria-label="맛집 위치 지도"
    />
  );
}

const RESTAURANT_REACTION_LABELS: Record<(typeof RESTAURANT_REACTION_EMOJIS)[number], string> = {
  "👍": "좋아요",
  "🔥": "핫플",
  "😋": "맛있어",
  "💰": "가성비",
  "🏆": "강추"
};

const REVIEW_REACTION_LABELS: Record<(typeof REVIEW_REACTION_EMOJIS)[number], string> = {
  "👍": "좋아요",
  "❤️": "공감해요",
  "😂": "웃겨요",
  "😮": "놀라워요"
};

function ReactionBar({
  emojis,
  reactions,
  myProfileId,
  onToggle,
  busyEmoji,
  emojiSizeClass,
  labels
}: {
  emojis: readonly string[];
  reactions: { profile_id: string; emoji: string }[];
  myProfileId: string | null;
  onToggle: (emoji: string) => void;
  busyEmoji?: string | null;
  emojiSizeClass: "text-xl" | "text-lg";
  labels: Record<string, string>;
}) {
  const [tooltipEmoji, setTooltipEmoji] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      {emojis.map((emoji) => {
        const count = reactions.filter((r) => r.emoji === emoji).length;
        const mine =
          myProfileId != null && reactions.some((r) => r.profile_id === myProfileId && r.emoji === emoji);
        const label = labels[emoji];

        return (
          <button
            key={emoji}
            type="button"
            disabled={!myProfileId || busyEmoji === emoji}
            onClick={() => onToggle(emoji)}
            onMouseEnter={() => setTooltipEmoji(emoji)}
            onMouseLeave={() => {
              setTooltipEmoji((current) => (current === emoji ? null : current));
              clearLongPressTimer();
            }}
            onTouchStart={() => {
              clearLongPressTimer();
              longPressTimerRef.current = setTimeout(() => setTooltipEmoji(emoji), 500);
            }}
            onTouchEnd={() => {
              clearLongPressTimer();
              setTooltipEmoji((current) => (current === emoji ? null : current));
            }}
            onTouchCancel={() => {
              clearLongPressTimer();
              setTooltipEmoji((current) => (current === emoji ? null : current));
            }}
            className="relative inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
            aria-pressed={mine}
            aria-label={label ? `${emoji} ${label}` : emoji}
          >
            {tooltipEmoji === emoji && label ? (
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2 py-[3px] text-[11px] leading-tight text-white">
                {label}
                <span
                  className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-black"
                  aria-hidden
                />
              </span>
            ) : null}
            <span className={emojiSizeClass} aria-hidden>
              {emoji}
            </span>
            <span
              className={`tabular-nums text-[13px] ${mine ? "font-medium text-slate-900" : "text-slate-500"}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
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
  const [reviewOpen, setReviewOpen] = useState(false);
  /** 수정 모드일 때 대상 리뷰 (없으면 신규 등록) */
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const canManageResult = useCanManageRestaurant(restaurant?.registered_by);
  const canManage = canManageResult ?? false;
  /** 삭제 확인 대상 리뷰. null 이면 모달 닫힘. */
  const [deletingReview, setDeletingReview] = useState<Review | null>(null);
  const [reviewDeleteBusy, setReviewDeleteBusy] = useState(false);
  const [reviewDeleteErr, setReviewDeleteErr] = useState("");
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuUploadMsg, setMenuUploadMsg] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [lightboxItems, setLightboxItems] = useState<AshulengLightboxItem[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [restaurantReactions, setRestaurantReactions] = useState<RestaurantReactionRow[]>([]);
  const [reviewReactions, setReviewReactions] = useState<ReviewReactionRow[]>([]);
  const [restaurantReactionBusy, setRestaurantReactionBusy] = useState<string | null>(null);
  const [reviewReactionBusy, setReviewReactionBusy] = useState<string | null>(null);

  const [eName, setEName] = useState("");
  const [eCategories, setECategories] = useState<RestaurantCategory[]>(["성수점심"]);
  const [eFoodTypes, setEFoodTypes] = useState<string[]>([]);
  const [eTags, setETags] = useState<string[]>([]);
  const [ePrice, setEPrice] = useState("");
  const [eTagline, setETagline] = useState("");
  const [eMenuRows, setEMenuRows] = useState<MenuRow[]>([{ name: "", price: "" }]);
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

  const fetchReactions = useCallback(async (reviewIds: string[]) => {
    const [{ data: restaurantRows, error: restaurantError }, reviewResult] = await Promise.all([
      supabase
        .from("restaurant_reactions")
        .select("id, restaurant_id, profile_id, emoji")
        .eq("restaurant_id", id),
      reviewIds.length > 0
        ? supabase
            .from("review_reactions")
            .select("id, review_id, profile_id, emoji")
            .in("review_id", reviewIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (restaurantError) {
      console.error("[Ashuleng reactions] restaurant_reactions fetch failed", restaurantError);
      setRestaurantReactions([]);
    } else {
      setRestaurantReactions((restaurantRows ?? []) as RestaurantReactionRow[]);
    }

    if (reviewResult.error) {
      console.error("[Ashuleng reactions] review_reactions fetch failed", reviewResult.error);
      setReviewReactions([]);
    } else {
      setReviewReactions((reviewResult.data ?? []) as ReviewReactionRow[]);
    }
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
      await fetchReactions(((data ?? []) as Review[]).map((row) => row.id));
    },
    [id, fetchReactions]
  );

  const load = useCallback(async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    // auth.users.id === profiles.id 보장: user.id 를 그대로 profiles.id 로 사용.
    setMyProfileId(user?.id ?? null);

    const [{ data: r }, { data: rv }, { data: p }] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", id).maybeSingle(),
      supabase.from("reviews").select("*").eq("restaurant_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, email, name, department")
    ]);
    const rest = (r ?? null) as Restaurant | null;
    const reviewRows = (rv ?? []) as Review[];
    setRestaurant(rest);
    setReviews(reviewRows);
    setProfiles((p ?? []) as ProfileLite[]);
    await Promise.all([
      fetchMenuStoragePaths("page load (load())"),
      fetchReactions(reviewRows.map((row) => row.id))
    ]);
    if (rest) {
      setEName(rest.name);
      setECategories(getRestaurantCategories(rest));
      setEFoodTypes(normalizeFoodTypeList(rest.food_type));
      setETags(normalizeAtmosphereTagList(rest.atmosphere_tags));
      setEPrice(rest.price_range ?? "");
      setETagline(rest.tagline ?? "");
      setEMenuRows(parseMenuStringToRows(rest.menu));
      setEDescription(rest.description ?? "");
    }
    setLoading(false);
  }, [id, fetchMenuStoragePaths, fetchReactions]);

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
    setECategories(getRestaurantCategories(restaurant));
    setEFoodTypes(normalizeFoodTypeList(restaurant.food_type));
    setETags(normalizeAtmosphereTagList(restaurant.atmosphere_tags));
    setEPrice(restaurant.price_range ?? "");
    setETagline(restaurant.tagline ?? "");
    setEMenuRows(parseMenuStringToRows(restaurant.menu));
    setEDescription(restaurant.description ?? "");
  };

  const addMenuRow = () => setEMenuRows((prev) => [...prev, { name: "", price: "" }]);

  const removeMenuRow = (index: number) => {
    setEMenuRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateMenuRow = (index: number, field: keyof MenuRow, value: string) => {
    if (field === "price") {
      value = value.replace(/[^\d]/g, "");
    }
    setEMenuRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const persistRestaurant = async (): Promise<boolean> => {
    if (!restaurant) return false;
    if (eCategories.length === 0) {
      window.alert("카테고리는 1개 이상 선택해주세요.");
      return false;
    }
    setSaving(true);
    const desc = eDescription.slice(0, MEMO_MAX);
    const catRow = categoryFieldsForDb(eCategories);
    const tagsNorm = normalizeAtmosphereTagList(eTags);
    const { menu: menuFormatted, price_range: rangeFromMenu } = formatMenuAndPriceRange(eMenuRows);
    const nextPriceRange = rangeFromMenu ?? (ePrice.trim() || null);
    const { error } = await supabase
      .from("restaurants")
      .update({
        name: eName.trim(),
        categories: catRow.categories,
        food_type: normalizeFoodTypeList(eFoodTypes),
        atmosphere_tags: tagsNorm,
        price_range: nextPriceRange,
        tagline: eTagline.trim() || null,
        menu: menuFormatted,
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
            categories: catRow.categories,
            food_type: normalizeFoodTypeList(eFoodTypes),
            atmosphere_tags: tagsNorm,
            price_range: nextPriceRange,
            tagline: eTagline.trim() || null,
            menu: menuFormatted,
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

  /**
   * 본인 리뷰 삭제:
   * 1) reviews 테이블에서 row 삭제 (RLS 또는 reviewer_id 일치 조건으로 본인만 가능)
   * 2) 성공 시 review-images 버킷에서 첨부 파일들 best-effort 제거
   *    (스토리지 제거가 실패해도 DB 는 이미 지워졌으므로 UI 갱신은 진행)
   */
  const confirmDeleteReview = useCallback(async () => {
    const target = deletingReview;
    if (!target || !myProfileId) return;
    if (target.reviewer_id !== myProfileId) {
      setReviewDeleteErr("본인이 작성한 리뷰만 삭제할 수 있습니다.");
      return;
    }
    setReviewDeleteErr("");
    setReviewDeleteBusy(true);

    const { error } = await supabase
      .from("reviews")
      .delete()
      .eq("id", target.id)
      .eq("reviewer_id", myProfileId);

    if (error) {
      console.error("[Ashuleng review] delete failed", error);
      setReviewDeleteErr(error.message || "리뷰 삭제에 실패했습니다.");
      setReviewDeleteBusy(false);
      return;
    }

    const paths = (target.image_paths ?? []).filter((p): p is string => Boolean(p?.trim()));
    if (paths.length > 0) {
      const { error: storageErr } = await supabase.storage.from(REVIEW_BUCKET).remove(paths);
      if (storageErr) {
        console.error("[Ashuleng review] storage cleanup failed", storageErr);
      }
    }

    setReviewDeleteBusy(false);
    setDeletingReview(null);
    await fetchReviews("after review delete");
  }, [deletingReview, myProfileId, fetchReviews]);

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

  const reviewGalleryVisiblePaths = useMemo(() => {
    if (reviewPhotoPaths.length > REVIEW_GALLERY_MAX) {
      return reviewPhotoPaths.slice(0, REVIEW_GALLERY_MAX - 1);
    }
    return reviewPhotoPaths.slice(0, REVIEW_GALLERY_MAX);
  }, [reviewPhotoPaths]);

  const reviewGalleryOverflow =
    reviewPhotoPaths.length > REVIEW_GALLERY_MAX
      ? reviewPhotoPaths.length - (REVIEW_GALLERY_MAX - 1)
      : 0;

  const reviewTotalPages = Math.max(1, Math.ceil(reviews.length / REVIEW_PAGE_SIZE));
  const reviewPageSlice = useMemo(() => {
    const start = (reviewPage - 1) * REVIEW_PAGE_SIZE;
    return reviews.slice(start, start + REVIEW_PAGE_SIZE);
  }, [reviews, reviewPage]);

  useEffect(() => {
    setReviewPage((p) => Math.min(Math.max(1, p), reviewTotalPages));
  }, [reviewTotalPages]);

  const openMenuLightbox = useCallback((startIndex: number) => {
    if (menuStoragePaths.length === 0) return;
    const items: AshulengLightboxItem[] = menuStoragePaths.map((path, i) => ({
      id: `menu-${path}-${i}`,
      src: menuPublicUrl(path),
      showMenuBadge: true
    }));
    const idx = Math.min(Math.max(0, startIndex), items.length - 1);
    setLightboxItems(items);
    setLightboxIndex(idx);
  }, [menuStoragePaths]);

  const openReviewPhotoGalleryLightbox = useCallback((startIndex: number) => {
    if (reviewPhotoPaths.length === 0) return;
    const items: AshulengLightboxItem[] = reviewPhotoPaths.map((path, i) => ({
      id: `review-gallery-${path}-${i}`,
      src: reviewImagePublicUrl(path),
      showMenuBadge: false
    }));
    const idx = Math.min(Math.max(0, startIndex), items.length - 1);
    setLightboxItems(items);
    setLightboxIndex(idx);
  }, [reviewPhotoPaths]);

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

  const postReaction = useCallback(async (url: string, body: Record<string, string>) => {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      console.error("[Ashuleng reactions] API failed", err?.error ?? res.status);
      return false;
    }
    return true;
  }, []);

  const toggleRestaurantReaction = useCallback(
    async (emoji: string) => {
      if (!myProfileId || !restaurant) return;
      setRestaurantReactionBusy(emoji);
      let snapshot: RestaurantReactionRow[] = [];
      setRestaurantReactions((prev) => {
        snapshot = prev;
        const existing = prev.find((r) => r.profile_id === myProfileId && r.emoji === emoji);
        if (existing) return prev.filter((r) => r.id !== existing.id);
        return [
          ...prev,
          { id: `optimistic-${emoji}`, restaurant_id: restaurant.id, profile_id: myProfileId, emoji }
        ];
      });

      const ok = await postReaction("/api/restaurants/react", {
        restaurant_id: restaurant.id,
        emoji
      });
      if (!ok) setRestaurantReactions(snapshot);
      setRestaurantReactionBusy(null);
    },
    [myProfileId, postReaction, restaurant]
  );

  const toggleReviewReaction = useCallback(
    async (reviewId: string, emoji: string) => {
      if (!myProfileId) return;
      const busyKey = `${reviewId}:${emoji}`;
      setReviewReactionBusy(busyKey);
      let snapshot: ReviewReactionRow[] = [];
      setReviewReactions((prev) => {
        snapshot = prev;
        const existing = prev.find(
          (r) => r.review_id === reviewId && r.profile_id === myProfileId && r.emoji === emoji
        );
        if (existing) return prev.filter((r) => r.id !== existing.id);
        return [...prev, { id: `optimistic-${busyKey}`, review_id: reviewId, profile_id: myProfileId, emoji }];
      });

      const ok = await postReaction("/api/restaurants/review-react", {
        review_id: reviewId,
        emoji
      });
      if (!ok) setReviewReactions(snapshot);
      setReviewReactionBusy(null);
    },
    [myProfileId, postReaction]
  );

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
              <div className="flex items-center gap-2">
                <SharePageButton />
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
              ) : canManage ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-500"
                  onClick={() => {
                    setEditBasic(true);
                  }}
                >
                  수정
                </button>
              ) : null}
              </div>
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
                  <p className="mb-2 text-xs font-semibold text-slate-700">카테고리 (다중 선택)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {RESTAURANT_CATEGORY_META.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() =>
                          setECategories((p) => {
                            const next = toggle(p, c.key);
                            return next.length === 0 ? p : next;
                          })
                        }
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          eCategories.includes(c.key) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
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
                        {atmosphereTagDisplayLabel(t)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hidden" aria-hidden="true">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">가격대</label>
                    <input
                      value={ePrice}
                      onChange={(e) => setEPrice(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                      placeholder="예: 1만5천원대"
                      tabIndex={-1}
                    />
                  </div>
                  <div className="mt-4">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">한 줄 소개</label>
                    <input
                      value={eTagline}
                      onChange={(e) => setETagline(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
                      tabIndex={-1}
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-sm font-bold text-slate-900">대표 메뉴</p>
                  <div className="space-y-3">
                    {eMenuRows.map((row, index) => (
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <input
                          value={row.name}
                          onChange={(e) => updateMenuRow(index, "name", e.target.value)}
                          className="min-w-[8rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="예시 : 김치찌개"
                        />
                        <input
                          value={row.price}
                          onChange={(e) => updateMenuRow(index, "price", e.target.value)}
                          inputMode="numeric"
                          className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          placeholder="가격 : 15000"
                        />
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={addMenuRow}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200"
                            aria-label="메뉴 행 추가"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMenuRow(index)}
                            disabled={eMenuRows.length <= 1}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="이 메뉴 행 삭제"
                          >
                            −
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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

                <div className="mt-6">
                  <p className="mb-2 text-sm font-bold text-slate-900">카테고리</p>
                  <div className="flex flex-wrap gap-2">
                    {getRestaurantCategories(restaurant).map((cat) => (
                      <span key={cat} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${categoryBadgeClass(cat)}`}>
                        {restaurantCategoryDisplayLabel(cat)}
                      </span>
                    ))}
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
                        {atmosphereTagDisplayLabel(normalizeAtmosphereTag(t))}
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
              </>
            )}
            {!editBasic ? (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    메뉴사진 ({menuStoragePaths.length}장)
                  </h3>
                  {canManage ? (
                    <label className="inline-flex shrink-0 cursor-pointer text-xs font-semibold text-blue-600 hover:text-blue-500">
                      + 사진 추가
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => void uploadMenuImages(e.target.files)}
                      />
                    </label>
                  ) : null}
                </div>
                {menuUploadMsg ? <p className="mb-2 text-sm text-rose-600">{menuUploadMsg}</p> : null}
                {menuSaving ? <p className="mb-2 text-xs text-slate-500">업로드 중…</p> : null}
                {menuStoragePaths.length > 0 ? (
                  <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                    {menuStoragePaths.map((path, idx) => (
                      <li
                        key={path}
                        className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                      >
                        <button
                          type="button"
                          onClick={() => openMenuLightbox(idx)}
                          className="absolute inset-0 z-0 block h-full w-full cursor-zoom-in text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                          aria-label={`메뉴사진 ${idx + 1} 확대 보기`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={menuPublicUrl(path)}
                            alt=""
                            className="pointer-events-none h-full w-full object-contain"
                          />
                        </button>
                        {idx === 0 ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] bg-black/55 py-1 text-center text-[10px] font-medium text-white sm:text-xs">
                            대표
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">등록된 메뉴사진이 없습니다.</p>
                )}
              </div>
            ) : null}
            {!editBasic ? (
              <div className="mt-6">
                <p className="mb-2 text-sm font-bold text-slate-900">소개 메모</p>
                {(restaurant.description ?? "").trim() ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{restaurant.description}</p>
                ) : (
                  <p className="text-sm text-slate-400">—</p>
                )}
              </div>
            ) : null}
            {!editBasic ? (
              <div className="mt-6 border-t border-slate-100 pt-5">
                <p className="mb-2 text-sm font-bold text-slate-900">반응</p>
                <ReactionBar
                  emojis={RESTAURANT_REACTION_EMOJIS}
                  reactions={restaurantReactions}
                  myProfileId={myProfileId}
                  onToggle={(emoji) => void toggleRestaurantReaction(emoji)}
                  busyEmoji={restaurantReactionBusy}
                  emojiSizeClass="text-xl"
                  labels={RESTAURANT_REACTION_LABELS}
                />
              </div>
            ) : null}
          </section>

          {(() => {
            const coords = resolveRestaurantCoords(restaurant.lat, restaurant.lng);
            if (!coords) return null;
            return (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-bold text-slate-900">위치정보</h2>
                <div className="mb-4 flex flex-wrap items-start gap-3">
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">{restaurant.address}</p>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <a
                      href={naverMapUrl(restaurant.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-lg border-2 border-emerald-500 bg-white px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 sm:text-sm"
                    >
                      네이버 지도
                    </a>
                    <a
                      href={kakaoMapUrl(restaurant.name, coords.lat, coords.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex rounded-lg border-2 border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 sm:text-sm"
                    >
                      카카오맵
                    </a>
                  </div>
                </div>
                <RestaurantDetailMapEmbed lat={coords.lat} lng={coords.lng} />
              </section>
            );
          })()}

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
              onClick={() => {
                setEditingReview(null);
                setReviewOpen(true);
              }}
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
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">
                            {formatReviewCardDate(rv.created_at)} · {who?.name ?? "멤버"}
                          </p>
                          {myProfileId && rv.reviewer_id === myProfileId ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingReview(rv);
                                  setReviewOpen(true);
                                }}
                                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-sm hover:border-blue-300 hover:bg-blue-50/80"
                              >
                                수정
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewDeleteErr("");
                                  setDeletingReview(rv);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-500 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                                aria-label="이 리뷰 삭제"
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                                삭제
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3 border-t border-slate-100 pt-2">
                          <ReactionBar
                            emojis={REVIEW_REACTION_EMOJIS}
                            reactions={reviewReactions.filter((r) => r.review_id === rv.id)}
                            myProfileId={myProfileId}
                            onToggle={(emoji) => void toggleReviewReaction(rv.id, emoji)}
                            busyEmoji={
                              reviewReactionBusy?.startsWith(`${rv.id}:`)
                                ? reviewReactionBusy.slice(rv.id.length + 1)
                                : null
                            }
                            emojiSizeClass="text-lg"
                            labels={REVIEW_REACTION_LABELS}
                          />
                        </div>
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

          {reviewPhotoPaths.length > 0 ? (
            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">리뷰 사진 ({reviewPhotoPaths.length}장)</h3>
                <button
                  type="button"
                  onClick={() => openReviewPhotoGalleryLightbox(0)}
                  className="shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-500"
                >
                  전체 보기
                </button>
              </div>
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {reviewGalleryVisiblePaths.map((path, idx) => (
                  <li
                    key={path}
                    className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                  >
                    <button
                      type="button"
                      onClick={() => openReviewPhotoGalleryLightbox(idx)}
                      className="block h-full w-full cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                      aria-label={`리뷰 사진 ${idx + 1} 확대`}
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
                {reviewGalleryOverflow > 0 ? (
                  <li className="relative aspect-square overflow-hidden rounded-lg border border-blue-200 bg-blue-600">
                    <button
                      type="button"
                      onClick={() => openReviewPhotoGalleryLightbox(REVIEW_GALLERY_MAX - 1)}
                      className="flex h-full w-full items-center justify-center text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
                      aria-label={`리뷰 사진 ${reviewGalleryOverflow}장 더 보기`}
                    >
                      +{reviewGalleryOverflow}
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </section>
        {canManage ? (
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
        ) : null}
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

      {deletingReview ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-review-title"
          onClick={() => {
            if (!reviewDeleteBusy) setDeletingReview(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-review-title" className="text-base font-bold text-slate-900">
              리뷰 삭제
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              리뷰를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>
            {reviewDeleteErr ? (
              <p className="mt-3 text-sm text-rose-600">{reviewDeleteErr}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={reviewDeleteBusy}
                className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setDeletingReview(null)}
              >
                취소
              </button>
              <button
                type="button"
                disabled={reviewDeleteBusy}
                aria-busy={reviewDeleteBusy}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-400 disabled:opacity-90"
                onClick={() => void confirmDeleteReview()}
              >
                {reviewDeleteBusy ? (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : null}
                {reviewDeleteBusy ? "삭제 중..." : "삭제"}
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
          key={editingReview?.id ?? "new-review"}
          open={reviewOpen}
          onClose={() => {
            setReviewOpen(false);
            setEditingReview(null);
          }}
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          profileId={myProfileId}
          initialReview={editingReview}
          onSaved={(row) => {
            console.log("[Ashuleng review] onSaved", { id: row.id, image_paths: row.image_paths });
            void fetchReviews("after review submit (onSaved)");
          }}
        />
      ) : null}
    </div>
  );
}
