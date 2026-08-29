"use client";

import { useMemo, useState } from "react";
import { BlockDiagram } from "@/components/website/block-presets";
import { createInsightBlock } from "@/lib/website/api";

type TabId = "all" | "text" | "image";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "text", label: "글" },
  { id: "image", label: "이미지" }
];

/** DB enum 은 그대로. 공개 화면에 나오는 것만 모달에 둔다. */
const ITEMS: { preset: string; name: string; description: string; tab: Exclude<TabId, "all">; diagram?: string }[] = [
  { preset: "text", name: "글", description: "여러 문단 + 소제목 + 굵게 + 목록 + 링크를 한 블록에", tab: "text", diagram: "text-only" },
  { preset: "qa", name: "질문 · 답변", description: "인터뷰. 질문과 답변이 나뉘어 저장됩니다", tab: "text", diagram: "text-split" },
  { preset: "full", name: "전폭 이미지", description: "본문 폭 가득. 가로 사진", tab: "image" }
];

type Props = {
  open: boolean;
  insightId: string;
  nextSort: number;
  onClose: () => void;
  onPicked: () => void;
};

export function InsightBlockPicker({ open, insightId, nextSort, onClose, onPicked }: Props) {
  const [tab, setTab] = useState<TabId>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visible = useMemo(() => ITEMS.filter((item) => tab === "all" || item.tab === tab), [tab]);

  async function pick(preset: string) {
    setBusyId(preset);
    setError(null);
    const body: Record<string, unknown> = { preset, sort: nextSort };
    if (preset === "text") body.body = { ko: "", en: "" };
    if (preset === "qa") {
      body.question = { ko: "", en: "" };
      body.answer = { ko: "", en: "" };
    }
    try {
      const res = await createInsightBlock(insightId, body);
      if (!res.ok) {
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return;
      }
      onPicked();
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">블록 추가</h2>
            <p className="mt-0.5 text-sm text-slate-500">지금 화면에 나오는 블록만 고를 수 있습니다</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            닫기
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto px-5 pt-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                tab === item.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? <p className="px-5 pt-3 text-sm text-rose-600">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3">
          {visible.map((item) => (
            <button
              key={item.preset}
              type="button"
              disabled={busyId === item.preset}
              onClick={() => void pick(item.preset)}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 disabled:opacity-50"
            >
              <BlockDiagram preset={item.diagram ?? item.preset} />
              <div className="space-y-1 p-2.5">
                <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{item.description}</p>
              </div>
            </button>
          ))}
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          영상 · 임베드 · 여러 장 배치는 디자인 확정 후 열립니다
        </p>
      </div>
    </div>
  );
}
