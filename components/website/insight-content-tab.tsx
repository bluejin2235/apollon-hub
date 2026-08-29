"use client";

import { useState } from "react";
import { InsightBlockCard } from "@/components/website/insight-block-card";
import { InsightBlockPicker } from "@/components/website/insight-block-picker";
import { reorderInsightBlocks } from "@/lib/website/api";
import type { InsightDetail } from "@/lib/website/insight-detail";
import { workFolderPrefix } from "@/lib/website/upload-path";
import "./ui/work-admin.css";

type Props = {
  insight: InsightDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

export function InsightContentTab({ insight, siteUrl, onReload }: Props) {
  const blocks = [...(insight.insight_blocks ?? [])].sort((a, b) => a.sort - b.sort);
  const [picker, setPicker] = useState(false);
  const [locale, setLocale] = useState<"ko" | "en">("ko");
  const [error, setError] = useState<string | null>(null);
  const uploadRoot = workFolderPrefix(insight.slug, insight.id);

  async function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    const res = await reorderInsightBlocks(
      insight.id,
      next.map((item, i) => ({ id: item.id, sort: i }))
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  return (
    <div className="wa">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLocale("ko")}
          className={`rounded-[7px] border px-2.5 py-1 text-[11.5px] ${
            locale === "ko" ? "border-slate-900 bg-white font-semibold" : "border-transparent bg-[#f8f9fb] text-slate-500"
          }`}
        >
          국문
        </button>
        <button
          type="button"
          onClick={() => setLocale("en")}
          className={`rounded-[7px] border px-2.5 py-1 text-[11.5px] ${
            locale === "en" ? "border-slate-900 bg-white font-semibold" : "border-transparent bg-[#f8f9fb] text-slate-500"
          }`}
        >
          영문
        </button>
      </div>

      {error ? <p className="mb-2 text-xs text-rose-600">{error}</p> : null}

      <div className="blks">
        {blocks.map((block, i) => (
          <InsightBlockCard
            key={block.id}
            block={block}
            insightId={insight.id}
            uploadRoot={uploadRoot}
            siteUrl={siteUrl}
            locale={locale}
            canMoveUp={i > 0}
            canMoveDown={i < blocks.length - 1}
            onMove={(dir) => void move(i, dir)}
            onReload={onReload}
          />
        ))}
        <button type="button" className="addb" onClick={() => setPicker(true)}>
          ＋ 블록 추가
        </button>
      </div>

      <InsightBlockPicker
        open={picker}
        insightId={insight.id}
        nextSort={blocks.length}
        onClose={() => setPicker(false)}
        onPicked={() => void onReload()}
      />
    </div>
  );
}
