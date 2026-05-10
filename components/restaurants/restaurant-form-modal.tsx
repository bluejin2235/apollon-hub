"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { KakaoKeywordPlace, KakaoKeywordSearchResponse } from "@/lib/kakao/local-keyword";
import { pickDisplayAddress } from "@/lib/kakao/local-keyword";
import {
  ATMOSPHERE_TAG_OPTIONS,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  type AtmosphereTagOption,
  type FoodTypeOption,
  type RestaurantCategory
} from "@/lib/restaurants/types";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type KakaoSearchApiBody = KakaoKeywordSearchResponse & { error?: string; detail?: string; status?: number };

function toggle<T extends string>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function RestaurantFormModal({ open, onClose, onSaved }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<KakaoKeywordPlace[]>([]);
  const [pick, setPick] = useState<KakaoKeywordPlace | null>(null);
  const [category, setCategory] = useState<RestaurantCategory>("점심");
  const [foodTypes, setFoodTypes] = useState<FoodTypeOption[]>([]);
  const [tags, setTags] = useState<AtmosphereTagOption[]>([]);
  const [menu, setMenu] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setPick(null);
    setCategory("점심");
    setFoodTypes([]);
    setTags([]);
    setMenu("");
    setPriceRange("");
    setMsg("");
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setMsg("");
    try {
      const res = await fetch(`/api/kakao/search?query=${encodeURIComponent(q)}`, { cache: "no-store" });
      const raw = await res.text();
      let body: KakaoSearchApiBody | null = null;
      try {
        body = raw ? (JSON.parse(raw) as KakaoSearchApiBody) : null;
      } catch {
        setMsg(
          res.ok
            ? "검색 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요."
            : `검색 요청 실패 (HTTP ${res.status}). 배포 보호·프록시 응답이 HTML인 경우가 있습니다.`
        );
        setResults([]);
        console.error("[restaurant-form] /api/kakao/search non-JSON body", res.status, raw.slice(0, 300));
        return;
      }
      if (!res.ok) {
        const base = body?.error ?? "검색 실패";
        const extra = body?.detail ? ` — ${body.detail.slice(0, 180)}` : "";
        setMsg(base + extra);
        setResults([]);
        return;
      }
      setResults(body?.documents ?? []);
    } catch (e) {
      console.error(e);
      setMsg("검색 요청에 실패했습니다. 네트워크를 확인하거나 잠시 후 다시 시도해주세요.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) {
      setMsg("장소를 선택해주세요.");
      return;
    }
    const lat = Number(pick.y);
    const lng = Number(pick.x);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setMsg("좌표가 올바르지 않습니다.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setMsg("로그인이 필요합니다.");
        return;
      }
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", user.email).single();
      if (!prof?.id) {
        setMsg("프로필을 찾을 수 없습니다.");
        return;
      }
      const addr = pickDisplayAddress(pick);
      const { error } = await supabase.from("restaurants").insert({
        name: pick.place_name,
        category,
        address: addr || pick.place_name,
        lat,
        lng,
        menu: menu.trim() || null,
        price_range: priceRange.trim() || null,
        description: null,
        is_entertainment: false,
        registered_by: prof.id,
        food_type: foodTypes.length ? foodTypes : [],
        atmosphere_tags: tags.length ? tags : []
      });
      if (error) {
        console.error(error);
        setMsg(`저장 실패: ${error.message}`);
        return;
      }
      onSaved();
      onClose();
      reset();
    } catch (err) {
      console.error(err);
      setMsg("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">맛집 등록</h2>
          <button type="button" className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">카카오 장소 검색 후 카테고리·태그를 선택해 저장합니다.</p>

        <form className="mt-6 space-y-5" onSubmit={submit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">장소 검색</label>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-black placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="예: 성수 맛집"
              />
              <button
                type="button"
                onClick={() => void search()}
                disabled={searching}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {searching ? "검색…" : "검색"}
              </button>
            </div>
            {results.length > 0 ? (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {results.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${pick?.id === doc.id ? "bg-blue-50 font-medium text-blue-800" : "text-slate-800"}`}
                      onClick={() => setPick(doc)}
                    >
                      {doc.place_name}
                      <span className="block text-xs text-slate-500">{pickDisplayAddress(doc)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {pick ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">카테고리</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as RestaurantCategory)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                >
                  {RESTAURANT_CATEGORY_META.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">음식 종류 (다중)</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOOD_TYPE_OPTIONS.map((ft) => (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => setFoodTypes((prev) => toggle(prev, ft))}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        foodTypes.includes(ft) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {ft}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">분위기·특징 (다중)</p>
                <div className="flex flex-wrap gap-1.5">
                  {ATMOSPHERE_TAG_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTags((prev) => toggle(prev, t))}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        tags.includes(t) ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">대표 메뉴 (선택)</label>
                <input
                  value={menu}
                  onChange={(e) => setMenu(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  placeholder="예: 돼지갈비"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">가격대 (선택)</label>
                <input
                  value={priceRange}
                  onChange={(e) => setPriceRange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  placeholder="예: 1만5천원대"
                />
              </div>
            </>
          ) : null}

          {msg ? <p className="text-sm text-rose-600">{msg}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={onClose}>
              취소
            </button>
            <button
              type="submit"
              disabled={!pick || saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
