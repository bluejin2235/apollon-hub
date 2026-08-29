"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createInsight, getMeta } from "@/lib/website/api";
import type { ApiErr, WebsiteCategory } from "@/lib/website/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

const CAT_CHIP: Record<string, string> = {
  "behind-the-work": "bg-[#eef0fb] text-[#4b5bb5]",
  interview: "bg-[#eef4fb] text-[#2563a8]",
  news: "bg-[#f3eefb] text-[#7c3aed]",
  culture: "bg-[#fdf3ee] text-[#a35a08]",
  lab: "bg-[#eaf5f0] text-[#0f7a45]"
};

function formatDetails(details: unknown) {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

const WEBSITE_DOWN_MESSAGE =
  "홈페이지 개발 서버(localhost:3100)가 응답하지 않습니다.\n서버가 떠 있는지 확인한 뒤 다시 시도하세요.";

function isWebsiteDown(result: ApiErr) {
  return (
    result.error === "website_timeout" ||
    result.error === "website_unreachable" ||
    result.error === "network_error"
  );
}

export function NewInsightModal({ open, onClose }: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusyId(null);
    void getMeta().then((res) => {
      if (!res.ok) {
        setError(res.error + (res.details ? `\n${formatDetails(res.details)}` : ""));
        return;
      }
      setCategories(res.data.insightCategories ?? []);
    });
  }, [open]);

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

  async function pickCategory(categoryId: string) {
    if (busyId) return;
    setBusyId(categoryId);
    setError(null);
    try {
      const res = await createInsight({
        slug: `insight-${Date.now()}`,
        category_id: categoryId,
        year: String(new Date().getFullYear()),
        title: { ko: "새 글", en: "New" },
        summary: { ko: "작성 중입니다.", en: "" },
        key_image: "/works/placeholder-wide.svg"
      });
      if (!res.ok) {
        if (isWebsiteDown(res)) {
          setError(WEBSITE_DOWN_MESSAGE);
          return;
        }
        setError(res.error + (res.details ? `\n${formatDetails(res.details)}` : ""));
        return;
      }
      onClose();
      router.push(`/website/insights/${res.data.id}?tab=basic`);
    } catch {
      setError(WEBSITE_DOWN_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">새 글</h2>
            <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
              카테고리를 고르면 편집 화면으로 갑니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 px-5 py-4">
          {categories.map((c) => {
            const chip = CAT_CHIP[c.id] ?? "bg-slate-100 text-slate-600";
            const busy = busyId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void pickCategory(c.id)}
                className="flex w-full items-center gap-3 rounded-[7px] border border-[#dde1e6] px-[11px] py-2 text-left text-xs text-[#3a4049] hover:bg-slate-50 disabled:opacity-60"
              >
                <span className={`rounded-[3px] px-[7px] py-0.5 text-[10px] font-bold ${chip}`}>
                  {c.label?.ko || c.id}
                </span>
                <span className="text-[12.5px] font-medium text-slate-800">{c.label?.en || c.id}</span>
                {busy ? <span className="ml-auto text-[11px] text-slate-400">만드는 중…</span> : null}
              </button>
            );
          })}

          {error ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
