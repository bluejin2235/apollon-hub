"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KakaoKeywordPlace, KakaoKeywordSearchResponse } from "@/lib/kakao/local-keyword";
import { pickDisplayAddress } from "@/lib/kakao/local-keyword";
import { formatDistance, useGeolocation } from "@/lib/geo";
import { CrosshairIcon } from "@/components/icons/crosshair-icon";
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

/** 검색 1페이지 당 결과 수. 카카오 size 와 동일하게 유지. */
const SEARCH_PAGE_SIZE = 5;
/** 카카오 로컬 API page 파라미터의 최대값. */
const KAKAO_MAX_PAGE = 45;

export function RestaurantFormModal({ open, onClose, onSaved }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  /** 현재 표시 중인 결과를 만들어낸 검색어. 페이지 이동 시 이 값으로 재요청. */
  const [activeQuery, setActiveQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<KakaoKeywordPlace[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [pageableCount, setPageableCount] = useState(0);
  const [isEnd, setIsEnd] = useState(true);
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
  const searchGen = useRef(0);
  const { state: geoState, request: requestGeo, clear: clearGeo } = useGeolocation();

  const reset = useCallback(() => {
    duplicateCheckGen.current += 1;
    searchGen.current += 1;
    setStep(1);
    setQuery("");
    setActiveQuery("");
    setResults([]);
    setSearchPage(1);
    setPageableCount(0);
    setIsEnd(true);
    setPick(null);
    setIsDuplicatePlace(false);
    setDuplicateCheckPending(false);
    setCategories(["성수점심"]);
    setFoodTypes([]);
    setTags([]);
    setMenuRows([{ name: "", price: "" }]);
    setMsg("");
    clearGeo();
  }, [clearGeo]);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const runSearch = useCallback(
    async (q: string, page: number) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const gen = ++searchGen.current;
      setSearching(true);
      setMsg("");
      try {
        const params = new URLSearchParams();
        params.set("query", trimmed);
        params.set("page", String(page));
        params.set("size", String(SEARCH_PAGE_SIZE));
        if (geoState.coords) {
          // 카카오 로컬: x=경도, y=위도. distance 정렬은 서버 라우트에서 좌표 동반 시 자동 적용.
          params.set("x", String(geoState.coords.lng));
          params.set("y", String(geoState.coords.lat));
        }
        const res = await fetch(`/api/kakao/search?${params.toString()}`, { cache: "no-store" });
        const raw = await res.text();
        if (gen !== searchGen.current) return;

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
          setPageableCount(0);
          setIsEnd(true);
          console.error("[restaurant-form] /api/kakao/search non-JSON body", res.status, raw.slice(0, 300));
          return;
        }
        if (!res.ok) {
          const base = body?.error ?? "검색 실패";
          const extra = body?.detail ? ` — ${body.detail.slice(0, 180)}` : "";
          setMsg(base + extra);
          setResults([]);
          setPageableCount(0);
          setIsEnd(true);
          return;
        }
        setResults(body?.documents ?? []);
        setPageableCount(body?.meta?.pageable_count ?? body?.meta?.total_count ?? 0);
        setIsEnd(body?.meta?.is_end ?? true);
        setActiveQuery(trimmed);
        setSearchPage(page);
      } catch (e) {
        if (gen !== searchGen.current) return;
        console.error(e);
        setMsg("검색 요청에 실패했습니다. 네트워크를 확인하거나 잠시 후 다시 시도해주세요.");
        setResults([]);
        setPageableCount(0);
        setIsEnd(true);
      } finally {
        if (gen === searchGen.current) {
          setSearching(false);
        }
      }
    },
    [geoState.coords]
  );

  const search = useCallback(() => {
    void runSearch(query, 1);
  }, [runSearch, query]);

  /** 페이지 버튼에서 사용. 활성 검색어 기준 페이지 이동. */
  const goToSearchPage = useCallback(
    (page: number) => {
      if (page < 1 || page > KAKAO_MAX_PAGE) return;
      if (!activeQuery) return;
      void runSearch(activeQuery, page);
    },
    [runSearch, activeQuery]
  );

  /** 페이지네이션 표시용: 카카오는 size*page <= pageable_count 인 페이지까지만 유효. */
  const totalSearchPages = useMemo(() => {
    if (!pageableCount || pageableCount <= 0) return 0;
    return Math.min(KAKAO_MAX_PAGE, Math.ceil(pageableCount / SEARCH_PAGE_SIZE));
  }, [pageableCount]);

  /** 현재 페이지 기준 ±2 윈도우. 1·끝 페이지는 항상 표시. */
  const pageWindow = useMemo(() => {
    if (totalSearchPages <= 0) return [] as number[];
    const span = 2;
    const start = Math.max(1, searchPage - span);
    const end = Math.min(totalSearchPages, searchPage + span);
    const out: number[] = [];
    for (let p = start; p <= end; p += 1) out.push(p);
    return out;
  }, [totalSearchPages, searchPage]);

  /** 내 위치 토글: 활성/비활성. 활성 상태에서 검색어가 있다면 즉시 1페이지로 재검색. */
  const toggleGeo = useCallback(() => {
    if (geoState.coords) {
      clearGeo();
      if (activeQuery) void runSearch(activeQuery, 1);
    } else {
      requestGeo();
    }
  }, [geoState.coords, clearGeo, requestGeo, activeQuery, runSearch]);

  // 위치 새로 획득 시 활성 검색어가 있으면 자동으로 distance 기반 재검색
  useEffect(() => {
    if (!geoState.coords) return;
    if (!activeQuery) return;
    void runSearch(activeQuery, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoState.coords]);

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
                      search();
                    }
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="장소명, 주소, 지역명으로 검색"
                />
                <button
                  type="button"
                  onClick={() => search()}
                  disabled={searching}
                  className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
                >
                  {searching ? "검색…" : "검색"}
                </button>
                <button
                  type="button"
                  onClick={toggleGeo}
                  disabled={geoState.status === "loading"}
                  aria-pressed={Boolean(geoState.coords)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    geoState.coords
                      ? "border-blue-600 bg-blue-50 text-blue-600 hover:bg-blue-100"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  title={
                    geoState.coords
                      ? "내 위치 기반 정렬 해제"
                      : "내 위치 기반으로 가까운 순 검색"
                  }
                >
                  <CrosshairIcon className="h-4 w-4" />
                  <span>내 위치</span>
                </button>
              </div>

              {geoState.status === "loading" ? (
                <p className="text-xs text-slate-500">현재 위치 확인 중…</p>
              ) : geoState.errorMessage ? (
                <p className="text-xs text-rose-600">{geoState.errorMessage}</p>
              ) : geoState.coords ? (
                <p className="text-xs text-blue-700">📍 내 위치 기준 가까운 순으로 검색합니다.</p>
              ) : null}

              {results.length > 0 ? (
                <ul className="max-h-[min(320px,45vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {results.map((doc) => {
                    const selected = pick?.id === doc.id;
                    const distMeters = doc.distance ? Number.parseInt(doc.distance, 10) : NaN;
                    return (
                      <li key={doc.id} className="border-b border-slate-100 last:border-b-0">
                        <button
                          type="button"
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                            selected ? "bg-blue-50" : ""
                          }`}
                          onClick={() => void selectPlace(doc)}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-slate-900">{doc.place_name}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">{pickDisplayAddress(doc)}</span>
                          </div>
                          {Number.isFinite(distMeters) ? (
                            <span className="shrink-0 self-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              {formatDistance(distMeters)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {totalSearchPages > 1 ? (
                <nav
                  className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600"
                  aria-label="검색 결과 페이지"
                >
                  <button
                    type="button"
                    onClick={() => goToSearchPage(searchPage - 1)}
                    disabled={searching || searchPage <= 1}
                    className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="이전 페이지"
                  >
                    {"<"}
                  </button>
                  {pageWindow.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => goToSearchPage(p)}
                      disabled={searching}
                      className={`min-w-[1.25rem] px-0.5 py-0.5 tabular-nums ${
                        p === searchPage
                          ? "font-bold text-slate-900 underline decoration-slate-900 decoration-2 underline-offset-4"
                          : "font-normal hover:text-slate-900"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => goToSearchPage(searchPage + 1)}
                    disabled={searching || searchPage >= totalSearchPages || isEnd}
                    className="px-1 py-0.5 font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="다음 페이지"
                  >
                    {">"}
                  </button>
                </nav>
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
