"use client";

import { useEffect, useRef, useState } from "react";
import {
  createInsightSection,
  moveInsightBlock,
  reorderInsightBlocks
} from "@/lib/website/api";
import type { InsightBlock, InsightDetail, InsightSection } from "@/lib/website/insight-detail";
import { workFolderPrefix } from "@/lib/website/upload-path";
import { InsightBlockCard } from "@/components/website/insight-block-card";
import { InsightBlockPicker } from "@/components/website/insight-block-picker";
import { GuideTermProvider } from "@/components/website/ui/GuideTerm";
import { showToast } from "@/components/website/toast";
import "./ui/work-admin.css";

type Props = {
  insight: InsightDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

export function InsightContentTab({ insight, siteUrl, onReload }: Props) {
  const sections = [...(insight.insight_sections ?? [])].sort((a, b) => a.sort - b.sort);
  const homeSection = sections[0] ?? null;
  const allBlocks = flattenBlocks(sections, insight.insight_blocks ?? []);
  const [openBlockIds, setOpenBlockIds] = useState<Set<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ensuringRef = useRef(false);

  useEffect(() => {
    if (homeSection || ensuringRef.current) return;
    ensuringRef.current = true;
    void createInsightSection(insight.id, {
      headline: { ko: "본문", en: "Body" },
      sort: 0
    }).then(async (res) => {
      if (!res.ok) {
        setError(res.error);
        ensuringRef.current = false;
        return;
      }
      await onReload();
      ensuringRef.current = false;
    });
  }, [homeSection, insight.id, onReload]);

  function toggleBlock(id: string) {
    setOpenBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveBlock(index: number, dir: -1 | 1) {
    const item = allBlocks[index];
    const target = allBlocks[index + dir];
    if (!item || !target) return;

    if (item.section.id === target.section.id) {
      const inSection = allBlocks.filter((entry) => entry.section.id === item.section.id);
      const from = inSection.findIndex((entry) => entry.block.id === item.block.id);
      const to = from + dir;
      if (from < 0 || to < 0 || to >= inSection.length) return;
      const order = inSection.map((entry, i) => ({
        id: entry.block.id,
        sort: i === from ? to : i === to ? from : i
      }));
      const res = await reorderInsightBlocks(insight.id, order);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
      return;
    }

    const targetBlocks = allBlocks.filter((entry) => entry.section.id === target.section.id);
    const toSort = dir === 1 ? 0 : targetBlocks.length;
    const res = await moveInsightBlock(insight.id, {
      blockId: item.block.id,
      toSectionId: target.section.id,
      toSort
    });
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      return;
    }
    await onReload();
    showToast({
      message: "블록을 옮겼습니다",
      tone: "ok",
      durationMs: 2000
    });
  }

  const pickerSort =
    Math.max(0, ...allBlocks.filter((entry) => entry.section.id === homeSection?.id).map((entry) => entry.block.sort)) +
    1;

  return (
    <GuideTermProvider>
      <div className="wa">
        {error ? <p className="mb-3 text-[13px] text-rose-600">{error}</p> : null}

        <div className="blks insight-blks">
          {allBlocks.map((entry, i) => (
            <InsightBlockCard
              key={entry.block.id}
              block={entry.block}
              index={i + 1}
              insightId={insight.id}
              uploadRoot={workFolderPrefix(insight.slug, insight.id)}
              siteUrl={siteUrl}
              collapsed={!openBlockIds.has(entry.block.id)}
              canMoveUp={i > 0}
              canMoveDown={i < allBlocks.length - 1}
              onToggle={() => toggleBlock(entry.block.id)}
              onMove={(dir) => void moveBlock(i, dir)}
              onReload={onReload}
              portrait={insight.portrait ?? ""}
              pressPerson={insight.press_person ?? ""}
              pressRole={insight.press_role ?? ""}
            />
          ))}
          <button
            type="button"
            className="addb"
            disabled={!homeSection}
            onClick={() => {
              if (!homeSection) return;
              setPickerOpen(true);
            }}
          >
            ＋ 블록 추가
          </button>
        </div>

        <div className="hint">
          글 · 질문답변 · 전폭 · 2단 · 3단 · 자동 갤러리 · 위아래 두 장 · 가로 스크롤 · 영상 · 임베드
          <br />
          인터뷰의 인물 사진·이름·직함은 「질문·답변」 블록 안에서 넣습니다.
        </div>

        {pickerOpen && homeSection ? (
          <InsightBlockPicker
            open
            insightId={insight.id}
            sectionId={homeSection.id}
            nextSort={pickerSort}
            onClose={() => setPickerOpen(false)}
            onPicked={(blockId) => {
              setOpenBlockIds((prev) => {
                const next = new Set(prev);
                next.add(blockId);
                return next;
              });
              setPickerOpen(false);
              void onReload();
            }}
          />
        ) : null}
      </div>
    </GuideTermProvider>
  );
}

function flattenBlocks(
  sections: InsightSection[],
  blocks: InsightBlock[]
): { section: InsightSection; block: InsightBlock }[] {
  const bySection = new Map<string, InsightBlock[]>();
  for (const block of [...blocks].sort((a, b) => a.sort - b.sort)) {
    const key = block.section_id ?? "";
    const list = bySection.get(key) ?? [];
    list.push(block);
    bySection.set(key, list);
  }
  const out: { section: InsightSection; block: InsightBlock }[] = [];
  for (const section of sections) {
    for (const block of bySection.get(section.id) ?? []) {
      out.push({ section, block });
    }
  }
  const known = new Set(sections.map((section) => section.id));
  for (const block of blocks) {
    if (block.section_id && known.has(block.section_id)) continue;
    const fallback = sections[0];
    if (!fallback) continue;
    out.push({ section: fallback, block });
  }
  return out;
}
