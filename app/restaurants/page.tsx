"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KakaoMapPanel } from "@/components/restaurants/kakao-map";
import { RestaurantFormModal } from "@/components/restaurants/restaurant-form-modal";
import { RestaurantPreviewPanel } from "@/components/restaurants/restaurant-preview-panel";
import { reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  categoryBadgeClass,
  normalizeFoodTypeValue,
  normalizeRestaurantCategory,
  type LunchVoteRow,
  type ProfileLite,
  type Restaurant,
  type RestaurantCategory,
  type Review,
  reviewRevisitPositive,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { supabase } from "@/lib/supabase/client";

type ReviewAgg = { sum: number; n: number; revisit: number };

function mondayOfWeekLocal(d = new Date()): string {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = c.getDay();
  const back = dow === 0 ? 6 : dow - 1;
  c.setDate(c.getDate() - back);
  const y = c.getFullYear();
  const m = String(c.getMonth() + 1).padStart(2, "0");
  const day = String(c.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildReviewAgg(reviews: Review[]): Map<string, ReviewAgg> {
  const map = new Map<string, ReviewAgg>();
  for (const rv of reviews) {
    const cur = map.get(rv.restaurant_id) ?? { sum: 0, n: 0, revisit: 0 };
    cur.sum += reviewStarsScore(rv);
    cur.n += 1;
    if (reviewRevisitPositive(rv)) cur.revisit += 1;
    map.set(rv.restaurant_id, cur);
  }
  return map;
}

function scoreForReco(id: string, agg: Map<string, ReviewAgg>): number {
  const a = agg.get(id);
  if (!a || a.n === 0) return 0;
  const avg = a.sum / a.n;
  const revisitRate = a.revisit / a.n;
  return avg * 4 + revisitRate * 2 + Math.min(a.n, 12) * 0.12;
}

function toggleSet<T extends string>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** 맛집 목록 카드 페이지 크기 (상세 사진/리뷰 페이지네이션과 동일 UI) */
const LIST_PAGE_SIZE = 4;

const PRICE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "가격대" },
  { value: "1만", label: "1만원대" },
  { value: "1만5천", label: "1만5천원대" },
  { value: "2만", label: "2만원대" },
  { value: "3만", label: "3만원대" },
  { value: "5만", label: "5만원대" }
];

type SortKey = "reco" | "rating" | "recent";

export default function RestaurantsMainPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [lunchVotes, setLunchVotes] = useState<LunchVoteRow[]>([]);
  const [galleryByRestaurant, setGalleryByRestaurant] = useState<Map<string, string[]>>(new Map());
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [catFilter, setCatFilter] = useState<Set<RestaurantCategory>>(new Set());
  const [foodFilter, setFoodFilter] = useState<Set<(typeof FOOD_TYPE_OPTIONS)[number]>>(new Set());
  const [atmosFilter, setAtmosFilter] = useState<Set<(typeof ATMOSPHERE_TAG_OPTIONS)[number]>>(new Set());
  const [priceKeyword, setPriceKeyword] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("reco");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [voteMsg, setVoteMsg] = useState("");

  const weekStart = useMemo(() => mondayOfWeekLocal(), []);

  const loadAll = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const email = session?.user?.email;
    let pid: string | null = null;
    if (email) {
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
      pid = prof?.id ?? null;
    }
    setMyProfileId(pid);

    const [r, rv, p, votes, imgs] = await Promise.all([
      supabase.from("restaurants").select("*").order("created_at", { ascending: false }),
      supabase.from("reviews").select("*"),
      supabase.from("profiles").select("id, email, name, department"),
      supabase.from("lunch_votes").select("*").eq("week_start", weekStart),
      supabase.from("restaurant_images").select("restaurant_id, storage_path, created_at").order("created_at", { ascending: true })
    ]);
    setRestaurants((r.data ?? []) as Restaurant[]);
    setReviews((rv.data ?? []) as Review[]);
    setProfiles((p.data ?? []) as ProfileLite[]);
    setLunchVotes((votes.data ?? []) as LunchVoteRow[]);

    const gMap = new Map<string, string[]>();
    for (const row of imgs.data ?? []) {
      const rid = row.restaurant_id as string;
      const path = row.storage_path as string;
      const arr = gMap.get(rid) ?? [];
      arr.push(path);
      gMap.set(rid, arr);
    }
    setGalleryByRestaurant(gMap);
  }, [weekStart]);

  useEffect(() => {
    const run = async () => {
      await loadAll();
      setLoading(false);
    };
    void run();
  }, [loadAll]);

  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    profiles.forEach((x) => m.set(x.id, x));
    return m;
  }, [profiles]);

  const reviewAgg = useMemo(() => buildReviewAgg(reviews), [reviews]);

  /** 목록 카드 썸네일: 가장 최신 리뷰의 첫 첨부 사진(review-images), 없으면 null */
  const listCardReviewThumbPathByRestaurant = useMemo(() => {
    const byRestaurant = new Map<string, Review[]>();
    for (const rv of reviews) {
      const arr = byRestaurant.get(rv.restaurant_id) ?? [];
      arr.push(rv);
      byRestaurant.set(rv.restaurant_id, arr);
    }
    const pathById = new Map<string, string>();
    for (const [rid, arr] of byRestaurant) {
      const sorted = [...arr].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      for (const rv of sorted) {
        const paths = (rv.image_paths ?? []).filter((p): p is string => Boolean(p?.trim()));
        if (paths.length > 0) {
          pathById.set(rid, paths[0]);
          break;
        }
      }
    }
    return pathById;
  }, [reviews]);

  const lunchRecoPick = useMemo(() => {
    const pool = restaurants.filter((r) => normalizeRestaurantCategory(r.category) === "점심");
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => scoreForReco(b.id, reviewAgg) - scoreForReco(a.id, reviewAgg));
    return sorted[0];
  }, [restaurants, reviewAgg]);

  const cafeRecoPick = useMemo(() => {
    const pool = restaurants.filter((r) => normalizeRestaurantCategory(r.category) === "카페·디저트");
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => scoreForReco(b.id, reviewAgg) - scoreForReco(a.id, reviewAgg));
    return sorted[0];
  }, [restaurants, reviewAgg]);

  const searchNorm = searchQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    return restaurants.filter((r) => {
      if (catFilter.size > 0 && !catFilter.has(normalizeRestaurantCategory(r.category))) return false;
      const ftsNorm = (r.food_type ?? []).map(normalizeFoodTypeValue);
      if (foodFilter.size > 0) {
        const hit = [...foodFilter].some((f) => ftsNorm.includes(f));
        if (!hit) return false;
      }
      const atm = r.atmosphere_tags ?? [];
      if (atmosFilter.size > 0) {
        const hit = [...atmosFilter].some((t) => atm.includes(t));
        if (!hit) return false;
      }
      if (priceKeyword) {
        const pr = (r.price_range ?? "").toLowerCase();
        if (!pr.includes(priceKeyword.toLowerCase())) return false;
      }
      if (searchNorm) {
        const blob = [r.name, r.menu, r.address, r.description, r.tagline]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!blob.includes(searchNorm)) return false;
      }
      return true;
    });
  }, [restaurants, catFilter, foodFilter, atmosFilter, priceKeyword, searchNorm]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "recent") {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortBy === "rating") {
      list.sort((a, b) => {
        const ag = reviewAgg.get(a.id);
        const bg = reviewAgg.get(b.id);
        const aa = ag && ag.n > 0 ? ag.sum / ag.n : 0;
        const bb = bg && bg.n > 0 ? bg.sum / bg.n : 0;
        if (bb !== aa) return bb - aa;
        return scoreForReco(b.id, reviewAgg) - scoreForReco(a.id, reviewAgg);
      });
    } else {
      list.sort((a, b) => scoreForReco(b.id, reviewAgg) - scoreForReco(a.id, reviewAgg));
    }
    return list;
  }, [filtered, sortBy, reviewAgg]);

  const listTotalPages = Math.max(1, Math.ceil(sortedFiltered.length / LIST_PAGE_SIZE));
  const listPageSlice = useMemo(() => {
    const start = (listPage - 1) * LIST_PAGE_SIZE;
    return sortedFiltered.slice(start, start + LIST_PAGE_SIZE);
  }, [sortedFiltered, listPage]);

  useEffect(() => {
    setListPage((p) => Math.min(Math.max(1, p), listTotalPages));
  }, [listTotalPages]);

  const voteCounts = useMemo(() => {
    const m = new Map<string, number>();
    lunchVotes.forEach((v) => m.set(v.restaurant_id, (m.get(v.restaurant_id) ?? 0) + 1));
    return m;
  }, [lunchVotes]);

  const myVoteRestaurantId = useMemo(() => {
    if (!myProfileId) return null;
    return lunchVotes.find((v) => v.voter_id === myProfileId)?.restaurant_id ?? null;
  }, [lunchVotes, myProfileId]);

  const lunchCandidates = useMemo(
    () => restaurants.filter((r) => normalizeRestaurantCategory(r.category) === "점심"),
    [restaurants]
  );

  const selectedRestaurant = useMemo(
    () => (selectedId ? restaurants.find((x) => x.id === selectedId) ?? null : null),
    [selectedId, restaurants]
  );

  const selectedReviews = useMemo(
    () => (selectedId ? reviews.filter((rv) => rv.restaurant_id === selectedId) : []),
    [selectedId, reviews]
  );

  const previewImagePlan = useMemo(() => {
    if (!selectedRestaurant) return { paths: [] as string[], sources: [] as ("gallery" | "menu")[] };
    const paths: string[] = [];
    const sources: ("gallery" | "menu")[] = [];
    const gal = galleryByRestaurant.get(selectedRestaurant.id) ?? [];
    for (const p of gal.slice(0, 3)) {
      paths.push(p);
      sources.push("gallery");
    }
    const menus = selectedRestaurant.menu_image_paths ?? [];
    for (const p of menus) {
      if (paths.length >= 5) break;
      if (!paths.includes(p)) {
        paths.push(p);
        sources.push("menu");
      }
    }
    return { paths, sources };
  }, [selectedRestaurant, galleryByRestaurant]);

  const focusCard = (id: string) => {
    setSelectedId(id);
    setFocusNonce((n) => n + 1);
  };

  const castVote = async (restaurantId: string) => {
    if (!myProfileId) {
      setVoteMsg("로그인·프로필이 필요합니다.");
      return;
    }
    setVoteMsg("");
    const { error } = await supabase.from("lunch_votes").upsert(
      { week_start: weekStart, restaurant_id: restaurantId, voter_id: myProfileId },
      { onConflict: "week_start,voter_id" }
    );
    if (error) {
      console.error(error);
      setVoteMsg(`투표 저장 실패: ${error.message}`);
      return;
    }
    const { data: votes } = await supabase.from("lunch_votes").select("*").eq("week_start", weekStart);
    setLunchVotes((votes ?? []) as LunchVoteRow[]);
  };

  const resetFilters = () => {
    setSearchQuery("");
    setCatFilter(new Set());
    setFoodFilter(new Set());
    setAtmosFilter(new Set());
    setPriceKeyword("");
    setSortBy("reco");
  };

  if (loading) {
    return <p className="py-20 text-center text-gray-600">불러오는 중...</p>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      {/* 타이틀 + 액션 */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">아슐랭</h1>
          <p className="mt-1 text-sm text-slate-500">성수동 기반 · 팀 내부 전용</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <span className="text-base leading-none" aria-hidden>
              ↺
            </span>
            초기화
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            + 맛집 등록
          </button>
        </div>
      </header>

      {/* 필터 바 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="relative min-w-[10rem] flex-1 basis-[14rem]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
              </svg>
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="맛집, 메뉴, 장소 검색"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-2.5 text-xs text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <select
              key={`cat-${[...catFilter].sort().join(",")}`}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as RestaurantCategory;
                if (v) setCatFilter((prev) => new Set([...prev, v]));
              }}
              className="w-[8.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">카테고리</option>
              {RESTAURANT_CATEGORY_META.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>

            <select
              key={`food-${[...foodFilter].sort().join(",")}`}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as (typeof FOOD_TYPE_OPTIONS)[number];
                if (v) setFoodFilter((prev) => new Set([...prev, v]));
              }}
              className="w-[8.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">음식 종류</option>
              {FOOD_TYPE_OPTIONS.map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>

            <select
              key={`atm-${[...atmosFilter].sort().join(",")}`}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as (typeof ATMOSPHERE_TAG_OPTIONS)[number];
                if (v) setAtmosFilter((prev) => new Set([...prev, v]));
              }}
              className="w-[8.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">분위기</option>
              {ATMOSPHERE_TAG_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              value={priceKeyword}
              onChange={(e) => setPriceKeyword(e.target.value)}
              className="w-[8.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PRICE_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(catFilter.size > 0 || foodFilter.size > 0 || atmosFilter.size > 0 || priceKeyword) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {[...catFilter].map((c) => {
              const label = RESTAURANT_CATEGORY_META.find((x) => x.key === c)?.label ?? c;
              const cafeIncluded = c === "카페·디저트";
              return (
                <span
                  key={`c-${c}`}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800"
                >
                  {cafeIncluded ? "카페 포함" : label}
                  <button
                    type="button"
                    className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                    aria-label={`${label} 필터 제거`}
                    onClick={() => setCatFilter((prev) => toggleSet(prev, c))}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {[...foodFilter].map((f) => (
              <span
                key={`f-${f}`}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800"
              >
                {f}
                <button
                  type="button"
                  className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                  aria-label={`${f} 필터 제거`}
                  onClick={() => setFoodFilter((prev) => toggleSet(prev, f))}
                >
                  ×
                </button>
              </span>
            ))}
            {[...atmosFilter].map((t) => (
              <span
                key={`a-${t}`}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800"
              >
                {t}
                <button
                  type="button"
                  className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                  aria-label={`${t} 필터 제거`}
                  onClick={() => setAtmosFilter((prev) => toggleSet(prev, t))}
                >
                  ×
                </button>
              </span>
            ))}
            {priceKeyword ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800">
                {PRICE_OPTIONS.find((p) => p.value === priceKeyword)?.label ?? priceKeyword}
                <button
                  type="button"
                  className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                  aria-label="가격대 필터 제거"
                  onClick={() => setPriceKeyword("")}
                >
                  ×
                </button>
              </span>
            ) : null}
          </div>
        )}
      </section>

      {/* 리스트 + 지도/미리보기 */}
      <section className="grid min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="flex max-h-[min(78vh,820px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">
              <span className="text-blue-600">{sortedFiltered.length}</span>곳
            </p>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="reco">추천순</option>
              <option value="rating">평점순</option>
              <option value="recent">최근등록순</option>
            </select>
          </div>
          <ul className="flex-1 space-y-0 overflow-y-auto">
            {listPageSlice.map((row) => {
              const agg = reviewAgg.get(row.id);
              const avgStr = agg && agg.n > 0 ? (agg.sum / agg.n).toFixed(1) : "—";
              const owner = row.registered_by ? profileMap.get(row.registered_by) : null;
              const selected = selectedId === row.id;
              const reviewThumbPath = listCardReviewThumbPathByRestaurant.get(row.id);
              const isLunchReco = lunchRecoPick?.id === row.id;
              const isCafeReco = cafeRecoPick?.id === row.id;
              const foodLine = [...(row.food_type ?? [])].slice(0, 4).map(normalizeFoodTypeValue).join(" / ");
              return (
                <li key={row.id} className="border-b border-slate-100 last:border-b-0">
                  <div
                    className={`flex items-stretch transition hover:bg-slate-50 ${
                      selected ? "bg-blue-50/90 ring-1 ring-inset ring-blue-200" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => focusCard(row.id)}
                      className="flex min-w-0 flex-1 gap-3 px-3 py-3 text-left sm:px-4 sm:py-4"
                    >
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:h-24 sm:w-24">
                        {reviewThumbPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={reviewImagePublicUrl(reviewThumbPath)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">이미지 없음</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isLunchReco ? (
                            <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800">
                              점심 추천
                            </span>
                          ) : null}
                          {isCafeReco ? (
                            <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">
                              카페 추천
                            </span>
                          ) : null}
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(row.category)}`}>
                            {normalizeRestaurantCategory(row.category)}
                          </span>
                        </div>
                        <p className="mt-1 font-bold text-slate-900">{row.name}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">
                          {[normalizeRestaurantCategory(row.category), foodLine || null].filter(Boolean).join(" · ")}
                        </p>
                        <p className="mt-1 text-sm text-amber-700">
                          ★ {avgStr} ({agg?.n ?? 0})
                          {row.price_range ? <span className="text-slate-600"> · {row.price_range}</span> : null}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">📍 {row.address}</p>
                        <p className="mt-1 text-[10px] text-slate-400">등록 {owner?.name ?? "—"}</p>
                      </div>
                    </button>
                    <Link
                      href={`/restaurants/${row.id}`}
                      prefetch={false}
                      className="flex shrink-0 items-center justify-center border-l border-slate-100 bg-white px-3 no-underline [-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      aria-label={`${row.name} 상세 페이지`}
                      title="상세"
                    >
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-500 active:bg-blue-700">
                        <svg
                          className="h-5 w-5 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          aria-hidden
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
                        </svg>
                      </span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          {sortedFiltered.length > LIST_PAGE_SIZE ? (
            <nav
              className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-slate-100 px-2 py-3 text-sm text-slate-600"
              aria-label="맛집 목록 페이지"
            >
              <button
                type="button"
                aria-label="이전 페이지"
                disabled={listPage <= 1}
                className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                onClick={() => setListPage((p) => Math.max(1, p - 1))}
              >
                {"<"}
              </button>
              {Array.from({ length: listTotalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setListPage(p)}
                  className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                    p === listPage
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
                disabled={listPage >= listTotalPages}
                className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
              >
                {">"}
              </button>
            </nav>
          ) : null}
          {sortedFiltered.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500">조건에 맞는 맛집이 없습니다.</p>
          ) : null}
        </div>

        <div className="flex min-h-[400px] flex-col lg:min-h-[min(78vh,820px)]">
          <div className="h-[360px] w-full shrink-0 lg:h-0 lg:min-h-[300px] lg:flex-1">
            <KakaoMapPanel
              restaurants={sortedFiltered}
              selectedId={selectedId}
              focusNonce={focusNonce}
              onMarkerClick={(id) => {
                setSelectedId(id);
                setFocusNonce((n) => n + 1);
              }}
            />
          </div>
          <RestaurantPreviewPanel
            restaurant={selectedRestaurant}
            reviews={selectedReviews}
            imagePaths={previewImagePlan.paths}
            imageSources={previewImagePlan.sources}
          />
        </div>
      </section>

      {/* 보조: 오늘의 추천 · 점심 투표 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">오늘의 추천</h2>
          <p className="mt-1 text-xs text-slate-500">팀 리뷰·재방문 비율 기준</p>
          <div className="mt-3 space-y-2 text-sm">
            {lunchRecoPick ? (
              <p>
                <span className="font-semibold text-slate-800">점심:</span>{" "}
                <button type="button" className="text-blue-600 hover:underline" onClick={() => focusCard(lunchRecoPick.id)}>
                  {lunchRecoPick.name}
                </button>
              </p>
            ) : (
              <p className="text-slate-500">점심 후보 없음</p>
            )}
            {cafeRecoPick ? (
              <p>
                <span className="font-semibold text-slate-800">카페:</span>{" "}
                <button type="button" className="text-violet-700 hover:underline" onClick={() => focusCard(cafeRecoPick.id)}>
                  {cafeRecoPick.name}
                </button>
              </p>
            ) : (
              <p className="text-slate-500">카페 후보 없음</p>
            )}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">이번 주 점심 투표</h2>
          <p className="mt-1 text-xs text-slate-500">주 시작 {weekStart} · 멤버당 1표</p>
          {voteMsg ? <p className="mt-2 text-sm text-rose-600">{voteMsg}</p> : null}
          {lunchCandidates.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">점심 맛집을 등록하면 투표할 수 있습니다.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {lunchCandidates.map((r) => {
                const cnt = voteCounts.get(r.id) ?? 0;
                const active = myVoteRestaurantId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => void castVote(r.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:border-blue-300"
                      }`}
                    >
                      {r.name}
                      <span className={`ml-1 ${active ? "text-blue-100" : "text-slate-500"}`}>{cnt}표</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <RestaurantFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={() => void loadAll()} />
    </div>
  );
}
