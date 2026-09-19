"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpenQuestionRow } from "@/lib/luna/open-questions-shared";

/** 블루진 전용 — 우하단 「질문 있어요」 */
export function LunaOpenQuestionsFab() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OpenQuestionRow[]>([]);
  const [count, setCount] = useState(0);
  const [delta, setDelta] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/luna/open-questions", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        setCount(0);
        return;
      }
      const json = (await res.json()) as {
        items?: OpenQuestionRow[];
        open?: number;
        delta?: number;
      };
      setItems(json.items ?? []);
      setCount(json.open ?? json.items?.length ?? 0);
      setDelta(json.delta ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (count === 0 && !open) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {open ? (
        <div className="pointer-events-auto w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-[11px] border border-[#DDD9FB] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#DDD9FB] bg-[#F0EFFE] px-4 py-3">
            <span className="flex-1 text-[12.5px] font-extrabold text-slate-900">
              루나가 묻고 싶은 것 · {count}건
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[15px] text-[#9ca3af]"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto bg-white px-4 py-4">
            <p className="mb-3.5 text-[12px] leading-relaxed text-[#6b7280]">
              대화에서 답을 못 받았거나, 사람마다 말이 달라 제가 정하기 어려운
              것들입니다.
              <br />
              급한 건 없습니다. 시간 나실 때 봐주세요.
            </p>
            {loading ? (
              <p className="text-[12px] text-[#9ca3af]">불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="text-[12px] text-[#9ca3af]">열린 질문이 없습니다.</p>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                      무엇
                    </th>
                    <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-left text-[10px] font-bold text-[#9ca3af]">
                      왜 못 정했나
                    </th>
                    <th className="border-b border-[#e5e7eb] bg-[#FAFAFB] px-2.5 py-2 text-right text-[10px] font-bold text-[#9ca3af]">
                      관련
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 12).map((row) => (
                    <tr key={row.id} className="hover:bg-[#FAFBFC]">
                      <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 align-top">
                        <div className="font-bold text-slate-900">{row.title}</div>
                        {row.preview ? (
                          <div className="mt-0.5 text-[11px] leading-snug text-[#9ca3af]">
                            {row.preview}
                          </div>
                        ) : null}
                      </td>
                      <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 align-top text-[#9ca3af]">
                        {row.why}
                      </td>
                      <td className="border-b border-[#f1f2f4] px-2.5 py-2.5 text-right font-mono text-[11px] align-top">
                        {row.related_count}건
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-3 text-[11px] leading-relaxed text-[#9ca3af]">
              {delta > 0
                ? `지난주보다 ${delta}건 줄었어요`
                : delta < 0
                  ? `지난주보다 ${Math.abs(delta)}건 늘었어요`
                  : "지난주와 비슷해요"}
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        className="pointer-events-auto inline-flex items-center gap-2.5 rounded-xl bg-[#534AB7] px-4 py-3 text-[12.5px] font-bold text-white shadow-md"
      >
        <span aria-hidden>🌙</span>
        <span>질문 있어요</span>
        {count > 0 ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#534AB7]">
            {count}
          </span>
        ) : null}
      </button>
    </div>
  );
}
