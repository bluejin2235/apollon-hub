"use client";

import type { CheckWorks } from "@/lib/website/types";
import { PROBLEM_FLAGS, WARN_FLAGS } from "@/lib/website/checks";
import { formatBodyImageTooSmallHint } from "@/lib/website/spec";
import { isLongEdgeTooSmall } from "@/lib/website/image-long-edge";
import type { EditorTab, WorkDetail } from "@/lib/website/work-detail";
import { aiUnconfirmedBySection, countAiUnconfirmed } from "@/lib/website/work-detail";

export type CheckItemKind = "problem" | "warn";

export type WorkCheckItem = {
  flag: (typeof PROBLEM_FLAGS)[number] | (typeof WARN_FLAGS)[number] | `video:${string}`;
  kind: CheckItemKind;
  tab: EditorTab;
  title: string;
  where: string;
};

const TAB_NAME: Record<EditorTab, string> = {
  basic: "기본정보",
  content: "본문",
  interview: "인터뷰",
  credits: "크레딧",
  faq: "FAQ",
  related: "연결",
  history: "이력"
};

function whereLine(tab: EditorTab, detail: string) {
  return `${TAB_NAME[tab]} · ${detail}`;
}

/** 공개 전 점검 — 빠진 항목만. 플래그 집합은 바꾸지 않는다. */
export function buildWorkCheckItems(
  work: WorkDetail,
  check: CheckWorks,
  opts?: { hasCardImage?: boolean }
): WorkCheckItem[] {
  const aiCount = countAiUnconfirmed(work);
  const aiSub = aiUnconfirmedBySection(work);
  const hasCard =
    opts?.hasCardImage !== undefined ? opts.hasCardImage : Boolean(work.card_image?.trim());
  const keyTooSmall = isLongEdgeTooSmall(work.key_image_width, work.key_image_height);
  let bodySmallCount = 0;
  for (const section of work.work_sections ?? []) {
    for (const block of section.content_blocks ?? []) {
      for (const image of block.block_images ?? []) {
        if (isLongEdgeTooSmall(image.width, image.height)) bodySmallCount += 1;
      }
    }
  }

  const all: WorkCheckItem[] = [
    {
      flag: "missing_summary_en",
      kind: "problem",
      tab: "basic",
      title: "검색 설명(영문)이 비어 있습니다",
      where: whereLine("basic", "영어권 검색과 AI에 이 프로젝트가 노출되지 않습니다")
    },
    {
      flag: "missing_key_alt",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 대체 텍스트가 없습니다",
      where: whereLine("basic", "모든 이미지에 필수입니다")
    },
    {
      flag: "no_key_image",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지가 없습니다",
      where: whereLine("basic", "목록 카드·링크 공유에 쓰는 대표 이미지를 올려 주세요")
    },
    {
      flag: "key_image_size_unknown",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 크기 정보가 없습니다",
      where: whereLine("basic", "대표 이미지를 다시 올리면 가로·세로 크기가 함께 저장됩니다")
    },
    {
      flag: "key_image_too_small",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 긴 변이 1600 미만입니다",
      where: whereLine("basic", "긴 변이 1600 이상이어야 합니다")
    },
    {
      flag: "no_card_image",
      kind: "problem",
      tab: "basic",
      title: "썸네일에 쓸 이미지가 없습니다",
      where: whereLine("basic", "목록 카드와 링크 공유에 쓸 이미지를 고르세요")
    },
    {
      flag: "no_sections",
      kind: "problem",
      tab: "content",
      title: "본문 섹션이 없습니다",
      where: whereLine("content", "블록을 위에서부터 쌓는 순서가 페이지 왼쪽 앵커 메뉴 순서가 됩니다")
    },
    {
      flag: "missing_image_alt",
      kind: "problem",
      tab: "content",
      title: "본문 이미지에 대체 텍스트가 없습니다",
      where: whereLine("content", "대체 텍스트 — 국문 40자 이내. 화면에 안 보입니다")
    },
    {
      flag: "ai_unconfirmed",
      kind: "problem",
      tab: "content",
      title:
        aiCount > 0 ? `AI가 만든 캡션 ${aiCount}개가 확인 전입니다` : "AI가 만든 캡션이 확인 전입니다",
      where: whereLine(
        "content",
        aiSub || "이미지를 다 넣으신 뒤 [AI로 채우기]를 누르면 대체 텍스트·캡션 초안을 만듭니다"
      )
    },
    {
      flag: "body_image_too_small",
      kind: "warn",
      tab: "content",
      title: "본문 이미지 해상도가 낮습니다",
      where: whereLine("content", formatBodyImageTooSmallHint(bodySmallCount || check.body_image_too_small_count))
    },
    {
      flag: "empty_blocks",
      kind: "warn",
      tab: "content",
      title: "이미지가 없는 본문 블록이 있습니다",
      where: whereLine(
        "content",
        check.empty_block_count && check.empty_block_count > 0
          ? `이미지가 없는 블록이 ${check.empty_block_count}개 있습니다. 화면에 안 나옵니다`
          : "이미지가 없는 블록이 있습니다. 화면에 안 나옵니다"
      )
    },
    {
      flag: "no_small_loop",
      kind: "warn",
      tab: "basic",
      title: "배경 루프 영상이 없습니다",
      where: whereLine(
        "basic",
        "T-S · 작은 화면용을 올리지 않으면 작은 카드는 영상 없이 대표 이미지만 보입니다"
      )
    },
    {
      flag: "faq_on_but_empty",
      kind: "warn",
      tab: "faq",
      title: "FAQ가 비어 있습니다",
      where: whereLine("faq", "필수는 아니지만 AI 인용 가능성이 크게 떨어집니다")
    },
    {
      flag: "too_many_anchors",
      kind: "warn",
      tab: "content",
      title: "목차 앵커가 너무 많습니다",
      where: whereLine("content", "블록은 8개까지. 9개째부터는 앵커 메뉴가 화면에서 넘칩니다")
    },
    {
      flag: "no_tags",
      kind: "warn",
      tab: "basic",
      title: "태그가 없습니다",
      where: whereLine("basic", "목록 필터에서 찾을 수 없습니다")
    },
    {
      flag: "no_related",
      kind: "warn",
      tab: "related",
      title: "관련 워크가 연결되지 않았습니다",
      where: whereLine("related", "상세 하단에서 갈 곳이 없습니다")
    },
    {
      flag: "no_internal_folder",
      kind: "warn",
      tab: "basic",
      title: "내부 폴더가 없습니다",
      where: whereLine("basic", "나중에 루나가 이 워크와 내부 자료를 같은 프로젝트로 인식합니다")
    },
    {
      flag: "summary_too_long",
      kind: "warn",
      tab: "basic",
      title: "요약이 너무 깁니다",
      where: whereLine("basic", "구글 검색 결과에서 뒤가 잘립니다")
    },
    {
      flag: "duplicate_captions",
      kind: "warn",
      tab: "content",
      title: `캡션이 중복됩니다 (${check.duplicate_caption_count ?? 0}건)`,
      where: whereLine("content", "같은 문장이 반복되면 AI 가 인용하지 않습니다")
    },
    {
      flag: "duplicate_alts",
      kind: "warn",
      tab: "content",
      title: `대체 텍스트가 중복됩니다 (${check.duplicate_alt_count ?? 0}건)`,
      where: whereLine("content", "같은 문장이 반복되면 AI 가 인용하지 않습니다")
    }
  ];

  return all.filter((item) => {
    if (item.flag === "no_card_image") return !hasCard;
    if (item.flag === "key_image_too_small") return keyTooSmall;
    if (item.flag === "body_image_too_small") return bodySmallCount > 0;
    return Boolean(check[item.flag as keyof CheckWorks]);
  });
}

export function WorkPublishCheckList({
  items,
  onGoTab,
  overlay = false
}: {
  items: WorkCheckItem[];
  onGoTab: (tab: EditorTab) => void;
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
            onClick={() => onGoTab(item.tab)}
          >
            가기
          </button>
        </div>
      ))}
    </div>
  );
}
