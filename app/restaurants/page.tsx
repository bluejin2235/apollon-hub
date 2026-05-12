"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AshulengBoardSection } from "@/components/restaurants/ashuleng-board-section";
import { KakaoMapPanel } from "@/components/restaurants/kakao-map";
import { RestaurantFormModal } from "@/components/restaurants/restaurant-form-modal";
import { RestaurantPreviewPanel } from "@/components/restaurants/restaurant-preview-panel";
import { reviewImagePublicUrl } from "@/components/restaurants/review-write-modal";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  categoryBadgeClass,
  atmosphereTagDisplayLabel,
  normalizeAtmosphereTag,
  normalizeFoodTypeValue,
  getRestaurantCategories,
  isRestaurantNewWithinDays,
  restaurantCategoryDisplayLabel,
  type ProfileLite,
  type Restaurant,
  type RestaurantCategory,
  type Review,
  reviewRevisitPositive,
  reviewStarsScore
} from "@/lib/restaurants/types";
import { supabase } from "@/lib/supabase/client";

type ReviewAgg = { sum: number; n: number; revisit: number };

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

const GOURMET_RANK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GOURMET_REG_POINTS = 3;
const GOURMET_REVIEW_POINTS = 1;

type GourmetRankRow = {
  profileId: string;
  name: string;
  regCount: number;
  revCount: number;
  total: number;
};

type SortKey = "reco" | "rating" | "recent";

export default function RestaurantsMainPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categorySelect, setCategorySelect] = useState<"" | RestaurantCategory>("");
  const [foodFilter, setFoodFilter] = useState<Set<(typeof FOOD_TYPE_OPTIONS)[number]>>(new Set());
  const [atmosFilter, setAtmosFilter] = useState<Set<(typeof ATMOSPHERE_TAG_OPTIONS)[number]>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [randomPickHint, setRandomPickHint] = useState("");
  /** "오늘 뭐 먹지?" 클릭 시 왼쪽 목록을 해당 맛집 1곳만으로 제한 */
  const [randomPickOnlyId, setRandomPickOnlyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [r, rv, p] = await Promise.all([
      supabase.from("restaurants").select("*").order("created_at", { ascending: false }),
      supabase.from("reviews").select("*"),
      supabase.from("profiles").select("id, email, name, department")
    ]);
    setRestaurants((r.data ?? []) as Restaurant[]);
    setReviews((rv.data ?? []) as Review[]);
    setProfiles((p.data ?? []) as ProfileLite[]);
  }, []);

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

  /** 맛집 등록·리뷰 기여: 달력 월이 아니라 `Date.now()` 기준 최근 30일(롤링)만 집계 */
  const gourmetRankBoard = useMemo(() => {
    const cutoff = Date.now() - GOURMET_RANK_WINDOW_MS;
    const byId = new Map<string, { reg: number; rev: number }>();
    const bump = (profileId: string | null | undefined, kind: "reg" | "rev") => {
      if (!profileId) return;
      const cur = byId.get(profileId) ?? { reg: 0, rev: 0 };
      if (kind === "reg") cur.reg += 1;
      else cur.rev += 1;
      byId.set(profileId, cur);
    };
    for (const r of restaurants) {
      const t = new Date(r.created_at).getTime();
      if (Number.isNaN(t) || t < cutoff) continue;
      bump(r.registered_by, "reg");
    }
    for (const rv of reviews) {
      const t = new Date(rv.created_at).getTime();
      if (Number.isNaN(t) || t < cutoff) continue;
      bump(rv.reviewer_id, "rev");
    }
    const rows: GourmetRankRow[] = [];
    for (const [profileId, c] of byId) {
      const total = c.reg * GOURMET_REG_POINTS + c.rev * GOURMET_REVIEW_POINTS;
      if (total <= 0) continue;
      const p = profileMap.get(profileId);
      const name = p?.name?.trim() || p?.email?.trim() || "멤버";
      rows.push({ profileId, name, regCount: c.reg, revCount: c.rev, total });
    }
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.regCount !== a.regCount) return b.regCount - a.regCount;
      return b.revCount - a.revCount;
    });
    const slots: (GourmetRankRow | null)[] = [rows[0] ?? null, rows[1] ?? null, rows[2] ?? null];
    return { slots, showWidget: rows.length > 0 };
  }, [restaurants, reviews, profileMap]);

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

  const searchNorm = searchQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    return restaurants.filter((r) => {
      if (categorySelect) {
        const rCats = getRestaurantCategories(r);
        if (!rCats.includes(categorySelect)) return false;
      }
      const ftsNorm = (r.food_type ?? []).map(normalizeFoodTypeValue);
      if (foodFilter.size > 0) {
        const hit = [...foodFilter].some((f) => ftsNorm.includes(f));
        if (!hit) return false;
      }
      const atmNorm = (r.atmosphere_tags ?? []).map(normalizeAtmosphereTag);
      if (atmosFilter.size > 0) {
        const hit = [...atmosFilter].some((t) => atmNorm.includes(t));
        if (!hit) return false;
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
  }, [restaurants, categorySelect, foodFilter, atmosFilter, searchNorm]);

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

  const listForDisplay = useMemo(() => {
    if (!randomPickOnlyId) return sortedFiltered;
    const row = restaurants.find((r) => r.id === randomPickOnlyId);
    return row ? [row] : [];
  }, [sortedFiltered, randomPickOnlyId, restaurants]);

  /** 랜덤 추천 단일 표시 시 지도도 동일 1곳만 표시; 그 외에는 기존 보강 로직 */
  const mapRestaurants = useMemo(() => {
    if (randomPickOnlyId) {
      const row = restaurants.find((r) => r.id === randomPickOnlyId);
      return row ? [row] : [];
    }
    if (!selectedId) return sortedFiltered;
    if (sortedFiltered.some((r) => r.id === selectedId)) return sortedFiltered;
    const extra = restaurants.find((r) => r.id === selectedId);
    return extra ? [...sortedFiltered, extra] : sortedFiltered;
  }, [sortedFiltered, selectedId, restaurants, randomPickOnlyId]);

  const listTotalPages = Math.max(1, Math.ceil(listForDisplay.length / LIST_PAGE_SIZE));
  const listPageSlice = useMemo(() => {
    const start = (listPage - 1) * LIST_PAGE_SIZE;
    return listForDisplay.slice(start, start + LIST_PAGE_SIZE);
  }, [listForDisplay, listPage]);

  useEffect(() => {
    setListPage((p) => Math.min(Math.max(1, p), listTotalPages));
  }, [listTotalPages]);

  useEffect(() => {
    if (!randomPickOnlyId) return;
    if (!restaurants.some((r) => r.id === randomPickOnlyId)) {
      setRandomPickOnlyId(null);
    }
  }, [restaurants, randomPickOnlyId]);

  const selectedRestaurant = useMemo(
    () => (selectedId ? restaurants.find((x) => x.id === selectedId) ?? null : null),
    [selectedId, restaurants]
  );

  const selectedReviews = useMemo(
    () => (selectedId ? reviews.filter((rv) => rv.restaurant_id === selectedId) : []),
    [selectedId, reviews]
  );

  /** 미리보기 패널: 최신 리뷰 순으로 첨부 사진 최대 3장 (review-images만) */
  const previewReviewImagePaths = useMemo(() => {
    const sorted = [...selectedReviews].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rv of sorted) {
      for (const raw of rv.image_paths ?? []) {
        const p = typeof raw === "string" ? raw.trim() : "";
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
        if (out.length >= 3) return out;
      }
    }
    return out;
  }, [selectedReviews]);

  const focusCard = useCallback((id: string) => {
    setRandomPickHint("");
    const idx = sortedFiltered.findIndex((r) => r.id === id);
    if (idx >= 0) {
      setListPage(Math.floor(idx / LIST_PAGE_SIZE) + 1);
    }
    setSelectedId(id);
    setFocusNonce((n) => n + 1);
  }, [sortedFiltered]);

  const onMapMarkerClick = useCallback(
    (id: string) => {
      focusCard(id);
    },
    [focusCard]
  );

  const pickRandomSeongsuEatery = useCallback(() => {
    const pool = restaurants.filter((r) => getRestaurantCategories(r).includes("성수점심"));
    if (pool.length === 0) {
      setRandomPickHint("성수/뚝섬 맛집이 아직 없습니다.");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    setRandomPickOnlyId(pick.id);
    setSelectedId(pick.id);
    setFocusNonce((n) => n + 1);
    setListPage(1);
    setRandomPickHint("");
  }, [restaurants]);

  const resetFilterBar = () => {
    setSearchQuery("");
    setCategorySelect("");
    setFoodFilter(new Set());
    setAtmosFilter(new Set());
    setRandomPickHint("");
    setRandomPickOnlyId(null);
  };

  if (loading) {
    return <p className="py-20 text-center text-gray-600">불러오는 중...</p>;
  }

  const gourmetRankCaption = "최근 30일 기준";
  const gourmetMedals = ["🥇", "🥈", "🥉"] as const;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      {/* 타이틀 + 액션 */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">아슐랭</h1>
          <p className="mt-1 text-sm text-slate-500">아폴론 미식가들이 직접 뽑은 아슐랭 가이드</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            + 맛집 등록
          </button>
        </div>
      </header>

      {gourmetRankBoard.showWidget ? (
        <section
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          aria-labelledby="gourmet-rank-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2 id="gourmet-rank-heading" className="text-base font-bold tracking-tight text-slate-900">
                이달의 미식가
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">{gourmetRankCaption}</p>
            </div>
            <p className="shrink-0 text-xs font-medium text-slate-600 sm:pt-0.5 sm:text-right">
              등록 {GOURMET_REG_POINTS}점 · 리뷰 {GOURMET_REVIEW_POINTS}점
            </p>
          </div>

          <ul className="mt-4 grid grid-cols-3 gap-2 sm:gap-3" role="list">
            {gourmetRankBoard.slots.map((row, i) => {
              const medal = gourmetMedals[i];
              const empty = row === null;
              return (
                <li
                  key={empty ? `empty-rank-${i + 1}` : row.profileId}
                  className={`flex min-w-0 flex-col rounded-lg border px-2.5 py-3 sm:px-3 sm:py-3.5 ${
                    i === 0
                      ? "border-amber-200/90 bg-amber-50/50 ring-1 ring-amber-100/80"
                      : "border-slate-100 bg-slate-50/80"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-lg leading-none sm:text-xl" aria-hidden>
                      {medal}
                    </span>
                    <span className="sr-only">{i + 1}위</span>
                    <span
                      className={`min-w-0 truncate text-sm font-semibold sm:text-base ${
                        empty ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {empty ? "—" : row.name}
                    </span>
                  </div>
                  <p
                    className={`mt-2 text-lg font-bold tabular-nums sm:text-xl ${
                      empty ? "text-slate-400" : "text-blue-700"
                    }`}
                  >
                    {empty ? "—" : `${row.total}점`}
                  </p>
                  <p className="mt-auto pt-2 text-[10px] leading-snug text-slate-500 sm:text-xs">
                    {empty
                      ? "등록 —개 · 리뷰 —개"
                      : `등록 ${row.regCount}개 · 리뷰 ${row.revCount}개`}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 필터 바 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-2">
            <div className="relative min-w-0 flex-1">
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
            <button
              type="button"
              onClick={() => pickRandomSeongsuEatery()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <span aria-hidden>🎲</span>
              오늘 뭐 먹지?
            </button>
          </div>

          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            <select
              value={categorySelect}
              onChange={(e) => {
                const v = e.target.value;
                setCategorySelect(v === "" ? "" : (v as RestaurantCategory));
              }}
              className="w-[7.6rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="카테고리"
            >
              <option value="">전체</option>
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
              className="w-[7.6rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="w-[7.6rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">분위기</option>
              {ATMOSPHERE_TAG_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {atmosphereTagDisplayLabel(t)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={resetFilterBar}
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg leading-none text-slate-600 shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-label="검색·필터 초기화"
              title="검색·필터 초기화"
            >
              <span aria-hidden>↺</span>
            </button>
          </div>
        </div>

        {randomPickHint ? (
          <p className="mt-2 text-xs text-amber-700" role="status">
            {randomPickHint}
          </p>
        ) : null}

        {(categorySelect || foodFilter.size > 0 || atmosFilter.size > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {categorySelect ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800">
                {RESTAURANT_CATEGORY_META.find((x) => x.key === categorySelect)?.label ?? categorySelect}
                <button
                  type="button"
                  className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                  aria-label="카테고리 필터 제거"
                  onClick={() => setCategorySelect("")}
                >
                  ×
                </button>
              </span>
            ) : null}
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
                {atmosphereTagDisplayLabel(t)}
                <button
                  type="button"
                  className="rounded-full px-0.5 text-slate-500 hover:text-slate-800"
                  aria-label={`${atmosphereTagDisplayLabel(t)} 필터 제거`}
                  onClick={() => setAtmosFilter((prev) => toggleSet(prev, t))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 리스트 + 지도/미리보기 */}
      <section className="grid min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="flex max-h-[min(78vh,820px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">
              <span className="text-blue-600">{listForDisplay.length}</span>곳
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
          {randomPickOnlyId && listForDisplay.length > 0 ? (
            <p className="border-b border-amber-100 bg-amber-50/90 px-4 py-2 text-xs font-semibold text-amber-900 sm:text-sm">
              🎲 오늘의 추천
            </p>
          ) : null}
          <ul className="flex-1 space-y-0 overflow-y-auto">
            {listPageSlice.map((row) => {
              const agg = reviewAgg.get(row.id);
              const avgStr = agg && agg.n > 0 ? (agg.sum / agg.n).toFixed(1) : "—";
              const owner = row.registered_by ? profileMap.get(row.registered_by) : null;
              const selected = selectedId === row.id;
              const reviewThumbPath = listCardReviewThumbPathByRestaurant.get(row.id);
              const foodLine = [...(row.food_type ?? [])].slice(0, 4).map(normalizeFoodTypeValue).join(" / ");
              const rowCats = getRestaurantCategories(row);
              const catLine = rowCats.map(restaurantCategoryDisplayLabel).join(" · ");
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
                          {rowCats.map((cat) => (
                            <span
                              key={cat}
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${categoryBadgeClass(cat)}`}
                            >
                              {restaurantCategoryDisplayLabel(cat)}
                            </span>
                          ))}
                          {isRestaurantNewWithinDays(row.created_at) ? (
                            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200/90">
                              신규등록
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 font-bold text-slate-900">{row.name}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">
                          {[catLine || null, foodLine || null].filter(Boolean).join(" · ")}
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
          {listForDisplay.length > LIST_PAGE_SIZE ? (
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
          {listForDisplay.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500">
              {sortedFiltered.length === 0 && !randomPickOnlyId
                ? "조건에 맞는 맛집이 없습니다."
                : "표시할 맛집이 없습니다."}
            </p>
          ) : null}
        </div>

        <div className="flex min-h-[400px] flex-col lg:min-h-[min(78vh,820px)]">
          <div className="h-[360px] w-full shrink-0 lg:h-0 lg:min-h-[300px] lg:flex-1">
            <KakaoMapPanel
              restaurants={mapRestaurants}
              selectedId={selectedId}
              focusNonce={focusNonce}
              onMarkerClick={onMapMarkerClick}
              onMapBackgroundClick={() => setSelectedId(null)}
            />
          </div>
          <RestaurantPreviewPanel
            restaurant={selectedRestaurant}
            reviews={selectedReviews}
            reviewImagePaths={previewReviewImagePaths}
          />
        </div>
      </section>

      <AshulengBoardSection />

      <RestaurantFormModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={() => void loadAll()} />
    </div>
  );
}
