"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KakaoMapPanel } from "@/components/restaurants/kakao-map";
import { RestaurantFormModal } from "@/components/restaurants/restaurant-form-modal";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  categoryBadgeClass,
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

export default function RestaurantsMainPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [lunchVotes, setLunchVotes] = useState<LunchVoteRow[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [recoTab, setRecoTab] = useState<"lunch" | "cafe">("lunch");
  const [catFilter, setCatFilter] = useState<Set<RestaurantCategory>>(new Set());
  const [foodFilter, setFoodFilter] = useState<Set<(typeof FOOD_TYPE_OPTIONS)[number]>>(new Set());
  const [atmosFilter, setAtmosFilter] = useState<Set<(typeof ATMOSPHERE_TAG_OPTIONS)[number]>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [voteMsg, setVoteMsg] = useState("");

  const weekStart = useMemo(() => mondayOfWeekLocal(), []);

  const loadAll = useCallback(async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    let pid: string | null = null;
    if (user?.email) {
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", user.email).maybeSingle();
      pid = prof?.id ?? null;
    }
    setMyProfileId(pid);

    const [r, rv, p, votes] = await Promise.all([
      supabase.from("restaurants").select("*").order("created_at", { ascending: false }),
      supabase.from("reviews").select("*"),
      supabase.from("profiles").select("id, email, name, department"),
      supabase.from("lunch_votes").select("*").eq("week_start", weekStart)
    ]);
    setRestaurants((r.data ?? []) as Restaurant[]);
    setReviews((rv.data ?? []) as Review[]);
    setProfiles((p.data ?? []) as ProfileLite[]);
    setLunchVotes((votes.data ?? []) as LunchVoteRow[]);
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

  const filtered = useMemo(() => {
    return restaurants.filter((r) => {
      if (catFilter.size > 0 && !catFilter.has(r.category as RestaurantCategory)) return false;
      const fts = r.food_type ?? [];
      if (foodFilter.size > 0) {
        const hit = [...foodFilter].some((f) => fts.includes(f));
        if (!hit) return false;
      }
      const atm = r.atmosphere_tags ?? [];
      if (atmosFilter.size > 0) {
        const hit = [...atmosFilter].some((t) => atm.includes(t));
        if (!hit) return false;
      }
      return true;
    });
  }, [restaurants, catFilter, foodFilter, atmosFilter]);

  const recoPick = useMemo(() => {
    const wantCats: RestaurantCategory[] = recoTab === "lunch" ? ["점심"] : ["카페·디저트"];
    const pool = restaurants.filter((r) => wantCats.includes(r.category as RestaurantCategory));
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => scoreForReco(b.id, reviewAgg) - scoreForReco(a.id, reviewAgg));
    return sorted[0];
  }, [recoTab, restaurants, reviewAgg]);

  const voteCounts = useMemo(() => {
    const m = new Map<string, number>();
    lunchVotes.forEach((v) => m.set(v.restaurant_id, (m.get(v.restaurant_id) ?? 0) + 1));
    return m;
  }, [lunchVotes]);

  const myVoteRestaurantId = useMemo(() => {
    if (!myProfileId) return null;
    return lunchVotes.find((v) => v.voter_id === myProfileId)?.restaurant_id ?? null;
  }, [lunchVotes, myProfileId]);

  const lunchCandidates = useMemo(() => restaurants.filter((r) => r.category === "점심"), [restaurants]);

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

  if (loading) {
    return <p className="py-20 text-center text-slate-500">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">아슐랭</h1>
          <p className="mt-1 text-sm text-slate-500">성수동 기반 · 팀 내부 전용</p>
          <p className="mt-2 text-lg font-semibold text-blue-600">{restaurants.length}곳 등록됨</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 self-start rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
        >
          + 맛집 등록
        </button>
      </header>

      {/* 1. 오늘의 추천 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold text-slate-900">오늘의 추천 맛집</h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setRecoTab("lunch")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${recoTab === "lunch" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              점심
            </button>
            <button
              type="button"
              onClick={() => setRecoTab("cafe")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${recoTab === "cafe" ? "bg-white text-violet-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              카페
            </button>
          </div>
        </div>
        <div className="px-5 py-5">
          {recoPick ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {recoTab === "lunch" ? "점심" : "카페·디저트"} · 팀 리뷰 기준 추천
                </p>
                <p className="mt-1 text-xl font-bold text-slate-900">{recoPick.name}</p>
                <p className="mt-1 text-sm text-slate-600">{recoPick.address}</p>
                {recoPick.menu ? (
                  <p className="mt-2 text-sm text-slate-500">
                    대표 {recoPick.menu}
                    {recoPick.price_range ? ` · ${recoPick.price_range}` : ""}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => focusCard(recoPick.id)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  지도에서 보기
                </button>
                <Link
                  href={`/restaurants/${recoPick.id}`}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  상세
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">해당 카테고리 맛집이 아직 없습니다. 등록해 주세요.</p>
          )}
        </div>
      </section>

      {/* 2. 이번 주 점심 투표 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">이번 주 점심 투표</h2>
        <p className="mt-1 text-xs text-slate-500">
          주 시작일 {weekStart} (월요일 기준) · 멤버당 1표 · 점심 카테고리만 표시
        </p>
        {voteMsg ? <p className="mt-2 text-sm text-rose-600">{voteMsg}</p> : null}
        {lunchCandidates.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">점심 맛집을 등록하면 투표할 수 있습니다.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {lunchCandidates.map((r) => {
              const cnt = voteCounts.get(r.id) ?? 0;
              const active = myVoteRestaurantId === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void castVote(r.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-800 hover:border-blue-300 hover:bg-blue-50"
                    }`}
                  >
                    {r.name}
                    <span className={`ml-1.5 text-xs ${active ? "text-blue-100" : "text-slate-500"}`}>{cnt}표</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. 카테고리 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">카테고리</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCatFilter(new Set())}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              catFilter.size === 0 ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체
          </button>
          {RESTAURANT_CATEGORY_META.map((c) => {
            const on = catFilter.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCatFilter(toggleSet(catFilter, c.key))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  on ? `${c.badgeClass} ring-2 ring-offset-1 ring-slate-300` : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. 음식 종류 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">음식 종류</h3>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 p-3">
          {FOOD_TYPE_OPTIONS.map((ft) => {
            const on = foodFilter.has(ft);
            return (
              <button
                key={ft}
                type="button"
                onClick={() => setFoodFilter(toggleSet(foodFilter, ft))}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  on ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {ft}
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. 분위기 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">분위기·특징</h3>
        <div className="flex flex-wrap gap-2">
          {ATMOSPHERE_TAG_OPTIONS.map((t) => {
            const on = atmosFilter.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => setAtmosFilter(toggleSet(atmosFilter, t))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  on ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </section>

      {/* 6. 리스트 + 지도 */}
      <section className="grid min-h-[480px] grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="flex max-h-[min(70vh,720px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">맛집 {filtered.length}곳</h2>
            <p className="text-xs text-slate-500">카드를 누르면 지도가 해당 위치로 이동합니다.</p>
          </div>
          <ul className="flex-1 space-y-0 overflow-y-auto divide-y divide-slate-100">
            {filtered.map((row) => {
              const agg = reviewAgg.get(row.id);
              const avgStr = agg && agg.n > 0 ? (agg.sum / agg.n).toFixed(1) : "—";
              const revisitPct = agg && agg.n > 0 ? Math.round((agg.revisit / agg.n) * 100) : null;
              const owner = row.registered_by ? profileMap.get(row.registered_by) : null;
              const selected = selectedId === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => focusCard(row.id)}
                    className={`w-full px-4 py-4 text-left transition hover:bg-slate-50 ${selected ? "bg-blue-50/80 ring-inset ring-1 ring-blue-200" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${categoryBadgeClass(row.category)}`}>
                        {row.category}
                      </span>
                    </div>
                    <p className="mt-1 font-bold text-slate-900">{row.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{row.address}</p>
                    <p className="mt-1.5 text-sm text-slate-600">
                      {[row.menu, row.price_range].filter(Boolean).join(" · ") || "메뉴·가격대 미입력"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      <span className="font-medium text-amber-600">{avgStr}</span>점 · 리뷰 {agg?.n ?? 0}건
                      {revisitPct != null ? ` · 재방문 ${revisitPct}%` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">등록 {owner?.name ?? "—"}</p>
                    <Link
                      href={`/restaurants/${row.id}`}
                      className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      상세 페이지 →
                    </Link>
                  </button>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">조건에 맞는 맛집이 없습니다.</p>
          ) : null}
        </div>

        <div className="flex min-h-[360px] flex-col lg:min-h-0">
          <KakaoMapPanel
            restaurants={filtered}
            selectedId={selectedId}
            focusNonce={focusNonce}
            onMarkerClick={(id) => {
              setSelectedId(id);
              setFocusNonce((n) => n + 1);
            }}
          />
        </div>
      </section>

      <RestaurantFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => void loadAll()}
      />
    </div>
  );
}
