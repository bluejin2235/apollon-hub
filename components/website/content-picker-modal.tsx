"use client";

import { useEffect, useMemo, useState } from "react";
import { searchContent, type SearchHit } from "@/lib/website/api";
import { mediaUrl } from "@/lib/website/work-detail";
import { TextInput } from "@/components/website/work-editor-ui";

export type ContentType = SearchHit["type"];

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

type Props = {
  open: boolean;
  types: ContentType[];
  excludeKeys: Set<string>;
  siteUrl?: string;
  title?: string;
  emptyHint?: string;
  onSelect: (hit: SearchHit) => void;
  onClose: () => void;
};

export function ContentPickerModal({
  open,
  types,
  excludeKeys,
  siteUrl = "",
  title = "콘텐츠 고르기",
  emptyHint,
  onSelect,
  onClose
}: Props) {
  const [tab, setTab] = useState<ContentType>(types[0] ?? "work");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(types[0] ?? "work");
    setQ("");
    setHits([]);
    setError(null);
  }, [open, types]);

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
          const res = await searchContent(q, tab, 20);
          if (cancelled) return;
          if (!res.ok) {
            setError(res.error);
            setHits([]);
            return;
          }
          setError(null);
          setHits(res.data ?? []);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, q, tab]);

  const showTabs = types.length > 1;
  const emptyMessage = useMemo(() => {
    if (loading || error) return null;
    if (hits.length > 0) return null;
    if (tab === "insight" && !q.trim()) return emptyHint ?? "인사이트를 먼저 등록해야 합니다";
    return "검색 결과가 없습니다";
  }, [loading, error, hits.length, tab, q, emptyHint]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
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
              {types.map((type) => {
                const on = tab === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTab(type)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      on
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {TYPE_LABEL[type]}
                  </button>
                );
              })}
            </div>
          ) : null}
          <TextInput value={q} onChange={setQ} placeholder="검색" />
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
                    onClick={() => onSelect(hit)}
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
                      <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">{hitTitle(hit)}</p>
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
}
