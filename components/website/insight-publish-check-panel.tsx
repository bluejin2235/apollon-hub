"use client";

import type { CheckInsights } from "@/lib/website/types";
import {
  INSIGHT_CHECK_LABEL,
  INSIGHT_PROBLEM_FLAGS,
  INSIGHT_WARN_FLAGS
} from "@/lib/website/checks";
import {
  countInsightAiUnconfirmed,
  type InsightDetail,
  type InsightEditorTab
} from "@/lib/website/insight-detail";
import { asLoc } from "@/lib/website/work-detail";

export type InsightCheckItemKind = "problem" | "warn";

export type InsightCheckItem = {
  flag: (typeof INSIGHT_PROBLEM_FLAGS)[number] | (typeof INSIGHT_WARN_FLAGS)[number];
  kind: InsightCheckItemKind;
  tab: InsightEditorTab;
  title: string;
  where: string;
  /** 본문 탭에서 펼칠 블록 */
  blockId?: string;
};

const TAB_NAME: Record<InsightEditorTab, string> = {
  basic: "기본정보",
  content: "본문",
  related: "연결",
  history: "이력"
};

const FLAG_TAB: Record<InsightCheckItem["flag"], InsightEditorTab> = {
  missing_summary_en: "basic",
  missing_key_alt: "basic",
  no_key_image: "basic",
  key_image_size_unknown: "basic",
  key_image_too_small: "basic",
  no_tags: "basic",
  stale_draft: "basic",
  no_blocks: "content",
  missing_body_en: "content",
  missing_qa_en: "content",
  empty_blocks: "content",
  missing_image_alt: "content",
  ai_unconfirmed: "content",
  body_image_too_small: "content",
  no_related: "related"
};

const FLAG_SUB: Record<InsightCheckItem["flag"], string> = {
  missing_summary_en: "영어권 검색과 AI에 이 글이 노출되지 않습니다",
  missing_key_alt: "모든 이미지에 필수입니다.",
  no_key_image: "목록 카드·링크 공유에 쓰는 대표 이미지를 올려 주세요.",
  key_image_size_unknown: "대표 이미지를 다시 올리면 가로·세로 크기가 함께 저장됩니다.",
  key_image_too_small: "긴 변이 800 이상이어야 합니다.",
  no_blocks: "본문 탭에서 블록을 쌓아 주세요. 섹션은 없습니다.",
  missing_image_alt: "대체 텍스트를 채워 주세요. 화면에 안 보입니다.",
  ai_unconfirmed: "AI가 만든 캡션을 확인해야 공개할 수 있습니다.",
  missing_body_en: "글 블록의 영문을 채워 주세요.",
  missing_qa_en: "질문·답변 블록의 영문을 채워 주세요.",
  empty_blocks: "비어 있는 블록은 화면에 안 나옵니다.",
  body_image_too_small: "본문 이미지 긴 변이 1600 미만입니다.",
  no_tags: "3~6개",
  no_related: "화면에는 4개가 나옵니다",
  stale_draft: "초안이 오래되었습니다. 내용을 확인하고 저장하세요."
};

export type MissingImageAltSpot = {
  blockId: string;
  blockIndex: number;
  imageIndex: number;
  label: string;
};

/** 국문 대체 텍스트가 비어 있는 본문 이미지 위치 */
export function findMissingInsightImageAlts(insight: InsightDetail): MissingImageAltSpot[] {
  const sections = [...(insight.insight_sections ?? [])].sort((a, b) => a.sort - b.sort);
  const sectionIds = new Set(sections.map((s) => s.id));
  const blocks = [...(insight.insight_blocks ?? [])].sort((a, b) => a.sort - b.sort);
  const ordered = [
    ...sections.flatMap((section) => blocks.filter((b) => b.section_id === section.id)),
    ...blocks.filter((b) => !b.section_id || !sectionIds.has(b.section_id))
  ];
  // 중복 제거 (section 없는 블록이 두 번 잡히지 않게)
  const seen = new Set<string>();
  const unique = ordered.filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  const spots: MissingImageAltSpot[] = [];
  unique.forEach((block, blockIndex) => {
    const images = [...(block.insight_images ?? [])].sort((a, b) => a.sort - b.sort);
    images.forEach((image, imageIndex) => {
      const alt = asLoc(image.alt);
      if (alt.ko.trim()) return;
      spots.push({
        blockId: block.id,
        blockIndex: blockIndex + 1,
        imageIndex: imageIndex + 1,
        label: `본문 ${blockIndex + 1}번째 블록 · 이미지 ${imageIndex + 1}장`
      });
    });
  });
  return spots;
}

function whereLine(tab: InsightEditorTab, detail: string) {
  return `${TAB_NAME[tab]} · ${detail}`;
}

function flagOn(check: CheckInsights, flag: InsightCheckItem["flag"]): boolean {
  const value = check[flag];
  if (flag === "empty_blocks") return Number(value) > 0;
  return Boolean(value);
}

export function buildInsightCheckItems(
  insight: InsightDetail,
  check: CheckInsights
): InsightCheckItem[] {
  const aiCount = countInsightAiUnconfirmed(insight);
  const missingAlts = findMissingInsightImageAlts(insight);
  const all: InsightCheckItem[] = [
    ...INSIGHT_PROBLEM_FLAGS.map((flag) => {
      let title = INSIGHT_CHECK_LABEL[flag];
      let where = whereLine(FLAG_TAB[flag], FLAG_SUB[flag]);
      let blockId: string | undefined;

      if (flag === "ai_unconfirmed" && aiCount > 0) {
        title = `AI가 만든 캡션 ${aiCount}개가 확인 전입니다`;
      }

      if (flag === "missing_image_alt" && missingAlts.length > 0) {
        const first = missingAlts[0]!;
        title =
          missingAlts.length === 1
            ? `${first.label}에 대체 텍스트가 없습니다`
            : `${first.label}에 대체 텍스트가 없습니다 · 외 ${missingAlts.length - 1}곳`;
        where = whereLine(
          "content",
          missingAlts.length === 1
            ? "대체 텍스트를 채워 주세요. 화면에 안 보입니다."
            : missingAlts.map((s) => s.label).join(" · ")
        );
        blockId = first.blockId;
      }

      return {
        flag,
        kind: "problem" as const,
        tab: FLAG_TAB[flag],
        title,
        where,
        blockId
      };
    }),
    ...INSIGHT_WARN_FLAGS.map((flag) => ({
      flag,
      kind: "warn" as const,
      tab: FLAG_TAB[flag],
      title:
        flag === "empty_blocks" && Number(check.empty_blocks) > 0
          ? `비어 있는 블록이 ${Number(check.empty_blocks)}개 있습니다`
          : INSIGHT_CHECK_LABEL[flag],
      where: whereLine(FLAG_TAB[flag], FLAG_SUB[flag])
    }))
  ];
  return all.filter((item) => flagOn(check, item.flag));
}

export function InsightPublishCheckList({
  items,
  onGo,
  overlay = false
}: {
  items: InsightCheckItem[];
  onGo: (item: InsightCheckItem) => void;
  overlay?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className={overlay ? "pt-1" : "mt-3.5 border-t border-slate-200 pt-1"}>
      {items.map((item) => (
        <div
          key={item.flag}
          className="flex items-start gap-2.5 border-t border-slate-100 py-2 first:border-t-0"
        >
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
              item.kind === "problem"
                ? "bg-red-100 text-red-600"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {item.kind === "problem" ? "필수" : "권장"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-slate-900">{item.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{item.where}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => onGo(item)}
          >
            가기
          </button>
        </div>
      ))}
    </div>
  );
}
