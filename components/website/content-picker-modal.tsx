"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchContent, type SearchHit } from "@/lib/website/api";
import { mediaUrl } from "@/lib/website/work-detail";
import { TextInput } from "@/components/website/work-editor-ui";

export type ContentType = SearchHit["type"];
export type PickerTab = "all" | ContentType;

const TYPE_LABEL: Record<ContentType, string> = {
  work: "워크",
  insight: "인사이트",
  page: "페이지"
};

export function hitTitle(hit: SearchHit): string {
  if (typeof hit.title === "string" && hit.title.trim()) return hit.title;
  if (hit.title && typeof hit.title === "object") {
    return hit.title.ko?.trim() || hit.title.en?.trim() || hit.slug || hit.id;
  }
  return hit.slug || hit.id;
}

export function hitKey(hit: Pick<SearchHit, "type" | "id">): string {
  return `${hit.type}:${hit.id}`;
}

function formatHitDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}`;
}

function hitSubtitle(hit: SearchHit): string {
  const kind = TYPE_LABEL[hit.type];
  if (hit.type === "page") return kind;
  const extra =
    hit.type === "work"
      ? hit.year?.trim() || null
      : formatHitDate(hit.published_at) || hit.year?.trim() || null;
  const parts = [kind, hit.category?.trim() || null, extra].filter(Boolean);
  return parts.join(" · ");
}

type Props = {
  open: boolean;
  types: ContentType[];
  includeAllTab?: boolean;
  publishedOnly?: boolean;
  excludeKeys: Set<string>;
  selectedHits?: SearchHit[];
  maxSelected?: number;
  confirmMode?: boolean;
  siteUrl?: string;
  title?: string;
  searchPlaceholder?: string;
  emptyHint?: string;
  onSelect?: (hit: SearchHit) => void;
  onConfirm?: (hits: SearchHit[]) => void;
  onClose: () => void;
};

export function ContentPickerModal({
  open,
  types,
  includeAllTab = false,
  publishedOnly = false,
  excludeKeys,
  selectedHits,
  maxSelected = 4,
  confirmMode = false,
  siteUrl = "",
  title = "콘텐츠 고르기",
  searchPlaceholder,
  emptyHint,
  onSelect,
  onConfirm,
  onClose
}: Props) {
  const tabs = useMemo<PickerTab[]>(
    () => (includeAllTab ? ["all", ...types] : types),
    [includeAllTab, types]
  );
  const [tab, setTab] = useState<PickerTab>(tabs[0] ?? "work");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchHit[]>([]);
  const [mounted, setMounted] = useState(false);
  const selectedHitsRef = useRef(selectedHits);
  selectedHitsRef.current = selectedHits;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab(tabs[0] ?? "work");
    setQ("");
    setHits([]);
    setError(null);
  }, [open, tabs]);

  useEffect(() => {
    if (!open || !confirmMode) return;
    setPicked(selectedHitsRef.current ?? []);
  }, [open, confirmMode]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const fetchTypes: ContentType[] =
            tab === "all" ? types.filter((type) => type !== "page") : [tab];
          const results = await Promise.all(
            fetchTypes.map((type) =>
              searchContent(q, type, 20, publishedOnly ? { published: true } : undefined)
            )
          );
          if (cancelled) return;
          const next: SearchHit[] = [];
          const seen = new Set<string>();
          let firstError: string | null = null;
          for (const res of results) {
            if (!res.ok) {
              firstError = firstError ?? res.error;
              continue;
            }
            for (const hit of res.data ?? []) {
              const key = hitKey(hit);
              if (seen.has(key) || excludeKeys.has(key)) continue;
              seen.add(key);
              next.push(hit);
            }
          }
          if (next.length === 0 && firstError) {
            setError(firstError);
            setHits([]);
            return;
          }
          setError(null);
          setHits(next);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, q, tab, types, publishedOnly, excludeKeys, confirmMode]);

  const pickedKeys = useMemo(() => new Set(picked.map(hitKey)), [picked]);
  const selectedCount = picked.length;

  function isChosen(hit: SearchHit): boolean {
    return pickedKeys.has(hitKey(hit));
  }

  function toggle(hit: SearchHit) {
    const key = hitKey(hit);
    setPicked((prev) => {
      if (prev.some((item) => hitKey(item) === key)) {
        return prev.filter((item) => hitKey(item) !== key);
      }
      if (prev.length >= maxSelected) return prev;
      return [...prev, hit];
    });
  }

  function confirm() {
    onConfirm?.(picked.slice(0, maxSelected));
  }

  const showTabs = tabs.length > 1;
  const emptyMessage = useMemo(() => {
    if (loading || error) return null;
    if (hits.length > 0) return null;
    if (!publishedOnly && tab === "insight" && !q.trim()) {
      return emptyHint ?? "인사이트를 먼저 등록해야 합니다";
    }
    return "검색 결과가 없습니다";
  }, [loading, error, hits.length, tab, q, emptyHint, publishedOnly]);

  if (!open || !mounted) return null;

  const modal = confirmMode ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-6">
      <div className="w-full max-w-[560px] rounded-xl bg-white p-[18px_20px] shadow-xl">
        <div className="mb-2.5 flex items-center justify-between">
          <b className="text-[15px] font-semibold text-slate-900">{title}</b>
          <button
            type="button"
            onClick={onClose}
            className="border-0 bg-transparent p-0 text-base text-slate-400"
          >
            ×
          </button>
        </div>
        {showTabs ? (
          <div className="mb-2.5 inline-flex overflow-hidden rounded-lg border border-slate-200">
            {tabs.map((item) => {
              const on = tab === item;
              const label = item === "all" ? "전체" : TYPE_LABEL[item];
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`border-0 border-r border-slate-200 px-3 py-1.5 text-xs last:border-r-0 ${
                    on ? "bg-slate-900 text-white" : "bg-white text-slate-600"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
        <TextInput value={q} onChange={setQ} placeholder={searchPlaceholder ?? "제목으로 찾기"} />
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        {loading ? <p className="mt-2 text-sm text-slate-400">검색 중…</p> : null}
        {emptyMessage ? <p className="mt-2 text-sm text-slate-500">{emptyMessage}</p> : null}
        <div className="mt-2.5 max-h-[290px] overflow-auto rounded-lg border border-slate-200">
          {hits.map((hit) => {
            const on = isChosen(hit);
            const src = mediaUrl(siteUrl, hit.key_image);
            const full = !on && selectedCount >= maxSelected;
            return (
              <button
                key={hitKey(hit)}
                type="button"
                disabled={full}
                onClick={() => toggle(hit)}
                className="flex w-full items-center gap-2.5 border-0 border-b border-slate-100 bg-white px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
              >
                <span className="h-8 w-14 shrink-0 overflow-hidden rounded bg-slate-100">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-900">
                    {hitTitle(hit)}
                  </span>
                  <span className="mt-px block text-[11px] text-slate-400">{hitSubtitle(hit)}</span>
                </span>
                {on ? <span className="text-[11px] text-indigo-600">✓</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {selectedCount} / {maxSelected} 골랐습니다
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600"
            >
              취소
            </button>
            <button
              type="button"
              onClick={confirm}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-600"
            >
              넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {showTabs ? (
            <div className="flex gap-1">
              {tabs.map((item) => {
                if (item === "all") return null;
                const on = tab === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTab(item)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      on
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {TYPE_LABEL[item]}
                  </button>
                );
              })}
            </div>
          ) : null}
          <TextInput value={q} onChange={setQ} placeholder={searchPlaceholder ?? "검색"} />
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          {loading ? <p className="text-sm text-slate-400">검색 중…</p> : null}
          {emptyMessage ? <p className="text-sm text-slate-500">{emptyMessage}</p> : null}
          <ul className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {hits.map((hit) => {
              const blocked = excludeKeys.has(hitKey(hit));
              const src = mediaUrl(siteUrl, hit.key_image);
              return (
                <li key={hitKey(hit)}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => onSelect?.(hit)}
                    className={`w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left ${
                      blocked ? "cursor-not-allowed opacity-40" : "hover:border-slate-400"
                    }`}
                  >
                    <div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-[10px] text-slate-400">
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      ) : (
                        "—"
                      )}
                    </div>
                    <div className="p-2.5">
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                        {TYPE_LABEL[hit.type]}
                      </span>
                      <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">
                        {hitTitle(hit)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
