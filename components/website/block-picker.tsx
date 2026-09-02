"use client";

import { useMemo, useState } from "react";
import { createBlock } from "@/lib/website/api";
import { emptyLoc } from "@/lib/website/work-detail";
import {
  BlockDiagram,
  hasBody,
  pickerItemsForTab,
  PICKER_TABS,
  textColumnCount,
  type PickerTabId
} from "@/components/website/block-presets";

type Props = {
  open: boolean;
  sectionId: string;
  nextSort: number;
  onClose: () => void;
  onPicked: (blockId: string) => void;
};

export function BlockPicker({ open, sectionId, nextSort, onClose, onPicked }: Props) {
  const [tab, setTab] = useState<PickerTabId>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(() => pickerItemsForTab(tab), [tab]);

  async function pick(preset: string) {
    setBusyId(preset);
    setError(null);
    const body: Record<string, unknown> = { preset, sort: nextSort };
    const cols = textColumnCount(preset);
    if (cols > 0) {
      body.body = { columns: Array.from({ length: cols }, () => emptyLoc()) };
    } else if (hasBody(preset)) {
      body.body = { ko: "", en: "" };
    }
    if (preset === "video-full" || preset === "video-text") {
      body.video_kind = "embed";
      body.video_url = "https://www.youtube.com/watch?v=";
    }
    if (preset === "embed") {
      body.embed_provider = "youtube";
      body.embed_url = "https://www.youtube.com/watch?v=";
    }
    try {
      const res = await createBlock(sectionId, body);
      if (!res.ok) {
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return;
      }
      const blockId = (res.data as { id?: string }).id;
      if (!blockId) {
        setError("block_id_missing");
        return;
      }
      onPicked(blockId);
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

        <div className="flex gap-1 overflow-x-auto px-5 pt-3">
          {PICKER_TABS.map((item) => (
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

        {error ? <p className="px-5 pt-3 text-sm text-rose-600">{error}</p> : null}

        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
          {visible.map((item) => (
            <button
              key={item.preset}
              type="button"
              disabled={busyId === item.preset}
              onClick={() => void pick(item.preset)}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 disabled:opacity-50"
            >
              <BlockDiagram preset={item.preset} />
              <div className="space-y-1 p-2.5">
                <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                {item.description ? (
                  <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{item.description}</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
