"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { KakaoKeywordPlace, KakaoKeywordSearchResponse } from "@/lib/kakao/local-keyword";
import { pickDisplayAddress } from "@/lib/kakao/local-keyword";
import {
  ATMOSPHERE_TAG_OPTIONS,
  atmosphereTagDisplayLabel,
  categoryFieldsForDb,
  FOOD_TYPE_OPTIONS,
  RESTAURANT_CATEGORY_META,
  type AtmosphereTagOption,
  type FoodTypeOption,
  type RestaurantCategory
} from "@/lib/restaurants/types";
import { formatMenuAndPriceRange, type MenuRow } from "@/lib/restaurants/menu-rows";
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

function IconChevronLeft(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IconClose(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/** DB 저장값과 동일 — 중복 검사·insert 공통 */
function registerNameAndAddress(doc: KakaoKeywordPlace): { name: string; address: string } {
  const name = doc.place_name;
  const address = pickDisplayAddress(doc) || doc.place_name;
  return { name, address };
}

export function RestaurantFormModal({ open, onClose, onSaved }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<KakaoKeywordPlace[]>([]);
  const [pick, setPick] = useState<KakaoKeywordPlace | null>(null);
  const [isDuplicatePlace, setIsDuplicatePlace] = useState(false);
  const [duplicateCheckPending, setDuplicateCheckPending] = useState(false);
  const [categories, setCategories] = useState<RestaurantCategory[]>(["성수점심"]);
  const [foodTypes, setFoodTypes] = useState<FoodTypeOption[]>([]);
  const [tags, setTags] = useState<AtmosphereTagOption[]>([]);
  const [menuRows, setMenuRows] = useState<MenuRow[]>([{ name: "", price: "" }]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const duplicateCheckGen = useRef(0);

  const reset = useCallback(() => {
    duplicateCheckGen.current += 1;
    setStep(1);
    setQuery("");
    setResults([]);
    setPick(null);
    setIsDuplicatePlace(false);
    setDuplicateCheckPending(false);
    setCategories(["성수점심"]);
    setFoodTypes([]);
    setTags([]);
    setMenuRows([{ name: "", price: "" }]);
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

  const selectPlace = useCallback(async (doc: KakaoKeywordPlace) => {
    const gen = ++duplicateCheckGen.current;
    setPick(doc);
    setStep(2);
    setMsg("");
    setIsDuplicatePlace(false);

    const { name, address } = registerNameAndAddress(doc);
    setDuplicateCheckPending(true);
    const { data, error } = await supabase.from("restaurants").select("id").eq("name", name).eq("address", address).limit(1);

    if (gen !== duplicateCheckGen.current) return;

    setDuplicateCheckPending(false);

    if (error) {
      console.error("[restaurant-form] duplicate check", error);
      return;
    }
    if (data && data.length > 0) {
      setIsDuplicatePlace(true);
      setMsg("이미 등록된 맛집입니다");
    }
  }, []);

  const goBack = () => {
    if (step === 2) {
      setStep(1);
      setMsg("");
      setIsDuplicatePlace(false);
      setDuplicateCheckPending(false);
    } else {
      onClose();
    }
  };

  const addMenuRow = () => {
    setMenuRows((prev) => [...prev, { name: "", price: "" }]);
  };

  const removeMenuRow = (index: number) => {
    setMenuRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateMenuRow = (index: number, field: keyof MenuRow, value: string) => {
    if (field === "price") {
      value = value.replace(/[^\d]/g, "");
    }
    setMenuRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) {
      setMsg("장소를 선택해주세요.");
      return;
    }
    if (isDuplicatePlace || duplicateCheckPending) {
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
      if (!user?.id) {
        setMsg("로그인이 필요합니다.");
        return;
      }
      // auth.users.id === profiles.id 보장: user.id 를 그대로 profiles.id (registered_by) 로 사용.
      const { name: regName, address: regAddress } = registerNameAndAddress(pick);
      const { menu, price_range } = formatMenuAndPriceRange(menuRows);
      const catRow = categoryFieldsForDb(categories);
      const { error } = await supabase.from("restaurants").insert({
        name: regName,
        category: catRow.category,
        categories: catRow.categories,
        address: regAddress,
        lat,
        lng,
        menu,
        price_range,
        description: null,
        is_entertainment: false,
        registered_by: user.id,
        food_type: foodTypes.length ? foodTypes : [],
        atmosphere_tags: tags.length ? tags : []
      });
      if (error) {
        console.error(
          "등록 에러 상세:",
          JSON.stringify(error),
          error?.message,
          error?.code,
          error?.details,
          error?.hint
        );
        setMsg(`저장 실패: ${error.message}`);
        return;
      }
      onSaved();
      onClose();
      reset();
    } catch (err) {
      console.error("등록 예외 상세:", JSON.stringify(err), err);
      setMsg("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const tagBase =
    "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label={step === 2 ? "이전 단계" : "닫기"}
            >
              <IconChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-bold text-blue-600">맛집 등록</h2>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="닫기"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {step === 1 ? (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-slate-900">장소 검색</h3>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void search();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="장소명, 주소, 지역명으로 검색"
                />
                <button
                  type="button"
                  onClick={() => void search()}
                  disabled={searching}
                  className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
                >
                  {searching ? "검색…" : "검색"}
                </button>
              </div>

              {results.length > 0 ? (
                <ul className="max-h-[min(320px,45vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {results.map((doc) => {
                    const selected = pick?.id === doc.id;
                    return (
                      <li key={doc.id} className="border-b border-slate-100 last:border-b-0">
                        <button
                          type="button"
                          className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${
                            selected ? "bg-blue-50" : ""
                          }`}
                          onClick={() => void selectPlace(doc)}
                        >
                          <span className="block text-sm font-bold text-slate-900">{doc.place_name}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{pickDisplayAddress(doc)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {msg ? <p className="text-sm text-rose-600">{msg}</p> : null}
            </div>
          ) : (
            <form id="restaurant-register-form" className="space-y-6" onSubmit={submit}>
              <div>
                <p className="mb-3 text-sm font-bold text-slate-900">카테고리 (다중 선택)</p>
                <div className="flex flex-wrap gap-2">
                  {RESTAURANT_CATEGORY_META.map((c) => {
                    const on = categories.includes(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() =>
                          setCategories((prev) => {
                            const next = toggle(prev, c.key);
                            return next.length === 0 ? prev : next;
                          })
                        }
                        className={
                          on
                            ? `${tagBase} border-blue-600 bg-blue-600 text-white`
                            : `${tagBase} border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200`
                        }
                      >
                        {on ? <span aria-hidden>✓</span> : null}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-bold text-slate-900">음식 종류 (다중 선택)</p>
                <div className="flex flex-wrap gap-2">
                  {FOOD_TYPE_OPTIONS.map((ft) => {
                    const on = foodTypes.includes(ft);
                    return (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setFoodTypes((prev) => toggle(prev, ft))}
                        className={
                          on
                            ? `${tagBase} border-blue-600 bg-blue-600 text-white`
                            : `${tagBase} border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200`
                        }
                      >
                        {on ? <span aria-hidden>✓</span> : null}
                        {ft}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-bold text-slate-900">분위기 · 특징 (다중 선택)</p>
                <div className="flex flex-wrap gap-2">
                  {ATMOSPHERE_TAG_OPTIONS.map((t) => {
                    const on = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTags((prev) => toggle(prev, t))}
                        className={
                          on
                            ? `${tagBase} border-blue-600 bg-blue-600 text-white`
                            : `${tagBase} border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200`
                        }
                      >
                        {on ? <span aria-hidden>✓</span> : null}
                        {atmosphereTagDisplayLabel(t)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-bold text-slate-900">대표 메뉴</p>
                <div className="space-y-3">
                  {menuRows.map((row, index) => (
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
                          disabled={menuRows.length <= 1}
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

              {msg ? <p className="text-sm text-rose-600">{msg}</p> : null}
            </form>
          )}
        </div>

        {step === 2 ? (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => {
                setStep(1);
                setMsg("");
                setIsDuplicatePlace(false);
                setDuplicateCheckPending(false);
              }}
            >
              이전
            </button>
            <button
              type="submit"
              form="restaurant-register-form"
              disabled={!pick || saving || isDuplicatePlace || duplicateCheckPending}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "등록"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
