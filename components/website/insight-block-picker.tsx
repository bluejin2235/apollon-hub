"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BlockDiagram,
  PRESET_DESCRIPTION,
  PRESET_LABEL,
  PICKER_TABS,
  type PickerTabId
} from "@/components/website/block-presets";
import { createInsightBlock } from "@/lib/website/api";

/** insight_block_preset 열 개. DB 와 같은 목록. */
const ITEMS: {
  preset: string;
  name: string;
  description: string;
  tab: Exclude<PickerTabId, "all">;
  diagram: string;
}[] = [
  {
    preset: "text",
    name: "글",
    description: PRESET_DESCRIPTION["text-only"] ?? "본문 폭 가득",
    tab: "text",
    diagram: "text-only"
  },
  {
    preset: "qa",
    name: "질문 · 답변",
    description: "인터뷰. 질문과 답변이 나뉘어 저장됩니다",
    tab: "text",
    diagram: "text-split"
  },
  {
    preset: "full",
    name: PRESET_LABEL.full,
    description: PRESET_DESCRIPTION.full,
    tab: "image",
    diagram: "full"
  },
  {
    preset: "split",
    name: PRESET_LABEL.split,
    description: PRESET_DESCRIPTION.split,
    tab: "image",
    diagram: "split"
  },
  {
    preset: "triple",
    name: PRESET_LABEL.triple,
    description: PRESET_DESCRIPTION.triple,
    tab: "image",
    diagram: "triple"
  },
  {
    preset: "quint",
    name: PRESET_LABEL.quint,
    description: PRESET_DESCRIPTION.quint,
    tab: "image",
    diagram: "quint"
  },
  {
    preset: "gallery-auto",
    name: PRESET_LABEL["gallery-auto"],
    description: PRESET_DESCRIPTION["gallery-auto"],
    tab: "image",
    diagram: "gallery-auto"
  },
  {
    preset: "stack",
    name: PRESET_LABEL.stack,
    description: PRESET_DESCRIPTION.stack,
    tab: "image",
    diagram: "stack"
  },
  {
    preset: "carousel",
    name: PRESET_LABEL.carousel,
    description: PRESET_DESCRIPTION.carousel,
    tab: "image",
    diagram: "carousel"
  },
  {
    preset: "video-full",
    name: PRESET_LABEL["video-full"],
    description: PRESET_DESCRIPTION["video-full"],
    tab: "video",
    diagram: "video-full"
  },
  {
    preset: "embed",
    name: PRESET_LABEL.embed,
    description: PRESET_DESCRIPTION.embed,
    tab: "embed",
    diagram: "embed"
  }
];

const TABS = PICKER_TABS.filter(
  (tab) =>
    tab.id === "all" ||
    tab.id === "text" ||
    tab.id === "image" ||
    tab.id === "video" ||
    tab.id === "embed"
);

type Props = {
  open: boolean;
  insightId: string;
  sectionId: string;
  nextSort: number;
  onClose: () => void;
  onPicked: (blockId: string) => void;
};

export function InsightBlockPicker({
  open,
  insightId,
  sectionId,
  nextSort,
  onClose,
  onPicked
}: Props) {
  const [tab, setTab] = useState<PickerTabId>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const visible = useMemo(
    () => ITEMS.filter((item) => tab === "all" || item.tab === tab),
    [tab]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  async function pick(preset: string) {
    setBusyId(preset);
    setError(null);
    const body: Record<string, unknown> = { preset, sort: nextSort, section_id: sectionId };
    if (preset === "text") body.body = { ko: "", en: "" };
    if (preset === "qa") {
      body.question = { ko: "", en: "" };
      body.answer = { ko: "", en: "" };
    }
    if (preset === "video-full") {
      body.video_kind = "hosted";
      body.video_url = "";
    }
    if (preset === "embed") {
      body.embed_provider = "youtube";
      body.embed_url = "https://www.youtube.com/watch?v=";
    }
    try {
      const res = await createInsightBlock(insightId, body);
      if (!res.ok) {
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return;
      }
      const blockId =
        typeof (res.data as { id?: unknown } | undefined)?.id === "string"
          ? (res.data as { id: string }).id
          : "";
      onPicked(blockId);
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="flex max-h-[min(88vh,920px)] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">블록 추가</h2>
            <p className="mt-0.5 text-sm text-slate-500">고르면 바로 들어갑니다</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            닫기
          </button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto px-5 pt-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${
                tab === item.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? <p className="shrink-0 px-5 pt-3 text-sm text-rose-600">{error}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3">
            {visible.map((item) => (
              <button
                key={item.preset}
                type="button"
                data-insight-preset={item.preset}
                disabled={busyId === item.preset}
                onClick={() => void pick(item.preset)}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 disabled:opacity-50"
              >
                <BlockDiagram preset={item.diagram} />
                <div className="space-y-1 p-2.5">
                  <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                  <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {item.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
