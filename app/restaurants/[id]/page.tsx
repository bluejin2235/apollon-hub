"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ProfileLite, Restaurant, Review } from "@/lib/restaurants/types";
import { supabase } from "@/lib/supabase/client";

export default function RestaurantDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const run = async () => {
      const [{ data: r }, { data: rv }, { data: p }] = await Promise.all([
        supabase.from("restaurants").select("*").eq("id", id).maybeSingle(),
        supabase.from("reviews").select("*").eq("restaurant_id", id).order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, email, name, department")
      ]);
      setRestaurant((r ?? null) as Restaurant | null);
      setReviews((rv ?? []) as Review[]);
      setProfiles((p ?? []) as ProfileLite[]);
      setLoading(false);
    };
    void run();
  }, [id]);

  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    profiles.forEach((x) => m.set(x.id, x));
    return m;
  }, [profiles]);

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
    <div className="space-y-8">
      <Link href="/restaurants" className="text-sm font-medium text-blue-600 hover:underline">
        ← 맛집 목록
      </Link>

      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-bold text-slate-900">{restaurant.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {restaurant.category} · {restaurant.address}
        </p>
        {restaurant.description ? <p className="mt-3 text-slate-700">{restaurant.description}</p> : null}
        {restaurant.menu ? (
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium">메뉴:</span> {restaurant.menu}
          </p>
        ) : null}
        {(restaurant.food_type?.length ?? 0) > 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium">음식 종류:</span> {(restaurant.food_type ?? []).join(", ")}
          </p>
        ) : null}
        {(restaurant.atmosphere_tags?.length ?? 0) > 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            <span className="font-medium">분위기·특징:</span> {(restaurant.atmosphere_tags ?? []).join(", ")}
          </p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">팀 리뷰</h2>
        <ul className="mt-4 divide-y divide-slate-100">
          {reviews.map((rv) => {
            const who = profileMap.get(rv.reviewer_id);
            return (
              <li key={rv.id} className="py-3">
                <p className="font-medium text-slate-900">
                  {who?.name ?? "멤버"} · {rv.rating}점
                  {rv.revisit ? <span className="ml-2 text-xs text-emerald-600">재방문</span> : null}
                </p>
                {rv.comment ? <p className="mt-1 text-sm text-slate-600">{rv.comment}</p> : null}
                {rv.visit_date ? <p className="mt-1 text-xs text-slate-400">방문 {rv.visit_date}</p> : null}
              </li>
            );
          })}
        </ul>
        {reviews.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">리뷰가 없습니다.</p> : null}
      </section>
    </div>
  );
}
