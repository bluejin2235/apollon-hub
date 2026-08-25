"use client";

import { Eye, Monitor, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getPreviewUrl } from "@/lib/website/api";
import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";

type Locale = "ko" | "en";
type Device = "pc" | "mobile";

type Props = {
  workId: string;
  sectionId?: string;
  blockId?: string;
  title: string;
  onClose: () => void;
};

function SegBtn({
  on,
  onClick,
  children
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-semibold ${
        on ? "bg-slate-900 text-white" : "bg-white text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

export function PreviewMiniBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-apollon-200 bg-apollon-50 px-2 py-0.5 text-[11px] font-semibold text-apollon-700 hover:bg-apollon-100"
    >
      <Eye className="h-3 w-3" />
      미리보기
    </button>
  );
}

export function PreviewModal({ workId, sectionId, blockId, title, onClose }: Props) {
  const [locale, setLocale] = useState<Locale>("ko");
  const [device, setDevice] = useState<Device>("pc");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    void (async () => {
      try {
        const res = await getPreviewUrl({ workId, sectionId, blockId, locale });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
          return;
        }
        setUrl(res.data.url);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId, sectionId, blockId, locale]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4">
      <div className="flex h-[min(900px,calc(100vh-2rem))] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <span className="text-sm font-bold text-slate-900">미리보기 — {title}</span>
          <span className="text-[11.5px] text-slate-400">저장된 내용이 보입니다</span>
          <span className="flex-1" />
          <span className="inline-flex overflow-hidden rounded-md border border-slate-200">
            <SegBtn on={locale === "ko"} onClick={() => setLocale("ko")}>
              국문
            </SegBtn>
            <span className="w-px bg-slate-200" />
            <SegBtn on={locale === "en"} onClick={() => setLocale("en")}>
              영문
            </SegBtn>
          </span>
          <span className="inline-flex overflow-hidden rounded-md border border-slate-200">
            <SegBtn on={device === "pc"} onClick={() => setDevice("pc")}>
              PC
            </SegBtn>
            <span className="w-px bg-slate-200" />
            <SegBtn on={device === "mobile"} onClick={() => setDevice("mobile")}>
              모바일
            </SegBtn>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={`min-h-0 flex-1 ${device === "mobile" ? "flex justify-center bg-slate-300 py-4" : "bg-white"}`}
        >
          {loading ? (
            <p className="grid h-full place-items-center text-sm text-slate-500">불러오는 중...</p>
          ) : null}
          {error ? (
            <p className="grid h-full place-items-center px-6 text-sm text-rose-600">{error}</p>
          ) : null}
          {url ? (
            <iframe
              title={`미리보기 — ${title}`}
              src={url}
              sandbox="allow-scripts allow-same-origin allow-popups"
              className={
                device === "mobile"
                  ? "h-full w-[390px] border-0 bg-white shadow-lg"
                  : "h-full w-full border-0 bg-white"
              }
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-slate-500">ESC 로도 닫힙니다</p>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              전체 페이지로 보기 ↗
            </a>
          ) : (
            <GhostBtn disabled>전체 페이지로 보기 ↗</GhostBtn>
          )}
          <PrimaryBtn onClick={onClose}>닫기</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

export function PreviewBarBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Monitor className="h-4 w-4" />
      미리보기 ↗
    </button>
  );
}
