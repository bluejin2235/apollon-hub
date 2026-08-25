"use client";

import { useEffect, useMemo, useState } from "react";
import { createBlock, getLibrary, type BlockLibraryItem } from "@/lib/website/api";
import { BlockDiagram, hasBody, pickerTabForPreset } from "@/components/website/block-presets";

type TabId = "all" | "image" | "image-text" | "video" | "embed" | "saved";

type Props = {
  open: boolean;
  sectionId: string;
  nextSort: number;
  onClose: () => void;
  onPicked: () => void;
};

export function BlockPicker({ open, sectionId, nextSort, onClose, onPicked }: Props) {
  const [items, setItems] = useState<BlockLibraryItem[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void getLibrary().then((res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems(res.data.items ?? []);
    });
  }, [open]);

  const saved = items.filter((item) => !item.is_default);
  const tabs: { id: TabId; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "image", label: "이미지" },
    { id: "image-text", label: "이미지+글" },
    { id: "video", label: "영상" },
    { id: "embed", label: "임베드" },
    { id: "saved", label: `우리가 저장한 것 ${saved.length}` }
  ];

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (tab === "all") return true;
      if (tab === "saved") return !item.is_default;
      return pickerTabForPreset(item.preset) === tab;
    });
  }, [items, tab]);

  async function pick(item: BlockLibraryItem) {
    setBusyId(item.id);
    setError(null);
    const body: Record<string, unknown> = { library_id: item.id, sort: nextSort };
    if (hasBody(item.preset)) {
      body.body = { ko: "", en: "" };
    }
    if (item.preset === "video-full" || item.preset === "video-text") {
      body.video_kind = "embed";
      body.video_url = "https://www.youtube.com/watch?v=";
    }
    if (item.preset === "embed") {
      body.embed_provider = "youtube";
      body.embed_url = "https://www.youtube.com/watch?v=";
    }
    const res = await createBlock(sectionId, body);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      return;
    }
    onPicked();
    onClose();
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
          {tabs.map((item) => (
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
              key={item.id}
              type="button"
              disabled={busyId === item.id}
              onClick={() => void pick(item)}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 disabled:opacity-50"
            >
              <BlockDiagram preset={item.preset} />
              <div className="space-y-1 p-2.5">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      item.is_default
                        ? "bg-apollon-50 text-apollon-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {item.is_default ? "추천" : "우리 것"}
                  </span>
                </div>
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
