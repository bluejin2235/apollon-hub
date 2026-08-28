"use client";

import { useState } from "react";
import type { CheckWorks } from "@/lib/website/types";
import { CHECK_FLAG_COUNT, PROBLEM_FLAGS, WARN_FLAGS } from "@/lib/website/checks";
import { formatBodyImageTooSmallHint, formatKeyImageSize } from "@/lib/website/spec";
import type { EditorTab, WorkDetail } from "@/lib/website/work-detail";
import { aiUnconfirmedBySection, countAiUnconfirmed } from "@/lib/website/work-detail";
import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";

type ItemKind = "problem" | "warn";

type CheckCopy = {
  flag: (typeof PROBLEM_FLAGS)[number] | (typeof WARN_FLAGS)[number];
  kind: ItemKind;
  tab: EditorTab;
  title: string;
  sub: string;
};

const TAB_LABEL: Record<EditorTab, string> = {
  basic: "기본정보 →",
  content: "본문 →",
  faq: "FAQ →",
  related: "연결 →"
};

function copies(work: WorkDetail, check: CheckWorks): CheckCopy[] {
  const aiCount = countAiUnconfirmed(work);
  const aiSub = aiUnconfirmedBySection(work);
  const all: CheckCopy[] = [
    {
      flag: "missing_summary_en",
      kind: "problem",
      tab: "basic",
      title: "검색 설명(영문)이 비어 있습니다",
      sub: "영어권 검색과 AI에 이 프로젝트가 노출되지 않습니다"
    },
    {
      flag: "missing_key_alt",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 대체 텍스트가 없습니다",
      sub: "모든 이미지에 필수입니다."
    },
    {
      flag: "no_key_image",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지가 없습니다",
      sub: "목록 카드·링크 공유에 쓰는 대표 이미지를 올려 주세요."
    },
    {
      flag: "key_image_size_unknown",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 크기 정보가 없습니다",
      sub: "대표 이미지를 다시 올리면 가로·세로 크기가 함께 저장됩니다."
    },
    {
      flag: "key_image_not_16_9",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 비율이 16:9가 아닙니다",
      sub: "16:9로 다시 만들어 올리세요"
    },
    {
      flag: "key_image_too_small",
      kind: "problem",
      tab: "basic",
      title: "대표 이미지 해상도가 낮습니다",
      sub: `${formatKeyImageSize()} 이상으로 다시 올리세요`
    },
    {
      flag: "no_sections",
      kind: "problem",
      tab: "content",
      title: "본문 섹션이 없습니다",
      sub: "블록을 위에서부터 쌓는 순서가 페이지 왼쪽 앵커 메뉴 순서가 됩니다."
    },
    {
      flag: "missing_image_alt",
      kind: "problem",
      tab: "content",
      title: "이미지 대체 텍스트가 없습니다",
      sub: "대체 텍스트 — 국문 40자 이내. 화면에 안 보입니다. 무엇이 찍혔는지 사실만. 모든 이미지에 필수입니다."
    },
    {
      flag: "ai_unconfirmed",
      kind: "problem",
      tab: "content",
      title: aiCount > 0 ? `AI가 만든 캡션 ${aiCount}개가 확인 전입니다` : "AI가 만든 캡션이 확인 전입니다",
      sub: aiSub || "이미지를 다 넣으신 뒤 [AI로 채우기]를 누르면 대체 텍스트·캡션 초안을 만듭니다."
    },
    {
      flag: "body_image_too_small",
      kind: "warn",
      tab: "content",
      title: "본문 이미지 해상도가 낮습니다",
      sub: formatBodyImageTooSmallHint(check.body_image_too_small_count)
    },
    {
      flag: "empty_blocks",
      kind: "warn",
      tab: "content",
      title: "이미지가 없는 본문 블록이 있습니다",
      sub:
        check.empty_block_count && check.empty_block_count > 0
          ? `이미지가 없는 블록이 ${check.empty_block_count}개 있습니다. 화면에 안 나옵니다`
          : "이미지가 없는 블록이 있습니다. 화면에 안 나옵니다"
    },
    {
      flag: "no_small_loop",
      kind: "warn",
      tab: "basic",
      title: "배경 루프 영상이 없습니다",
      sub: "T-S · 작은 화면용을 올리지 않으면 작은 카드는 영상 없이 대표 이미지만 보입니다."
    },
    {
      flag: "faq_on_but_empty",
      kind: "warn",
      tab: "faq",
      title: "FAQ가 비어 있습니다",
      sub: "필수는 아니지만 AI 인용 가능성이 크게 떨어집니다"
    },
    {
      flag: "too_many_anchors",
      kind: "warn",
      tab: "content",
      title: "목차 앵커가 너무 많습니다",
      sub: "블록은 8개까지. 9개째부터는 앵커 메뉴가 화면에서 넘칩니다."
    },
    {
      flag: "no_tags",
      kind: "warn",
      tab: "basic",
      title: "태그가 없습니다",
      sub: "3~6개 · 태그당 2~10자"
    },
    {
      flag: "no_related",
      kind: "warn",
      tab: "related",
      title: "연결 콘텐츠가 없습니다",
      sub: "화면에는 4개가 나옵니다"
    },
    {
      flag: "no_internal_folder",
      kind: "warn",
      tab: "basic",
      title: "내부 폴더가 없습니다",
      sub: "나중에 루나가 이 워크와 내부 자료를 같은 프로젝트로 인식합니다"
    },
    {
      flag: "summary_too_long",
      kind: "warn",
      tab: "basic",
      title: "요약이 너무 깁니다",
      sub: "구글 검색 결과에서 뒤가 잘립니다."
    },
    {
      flag: "duplicate_captions",
      kind: "warn",
      tab: "content",
      title: `캡션이 중복됩니다 (${check.duplicate_caption_count ?? 0}건)`,
      sub: "같은 문장이 반복되면 AI 가 인용하지 않습니다."
    },
    {
      flag: "duplicate_alts",
      kind: "warn",
      tab: "content",
      title: `대체 텍스트가 중복됩니다 (${check.duplicate_alt_count ?? 0}건)`,
      sub: "같은 문장이 반복되면 AI 가 인용하지 않습니다."
    }
  ];
  return all.filter((item) => check[item.flag]);
}

type Props = {
  work: WorkDetail;
  check: CheckWorks;
  canPublish: boolean;
  publishing?: boolean;
  onClose: () => void;
  onGoTab: (tab: EditorTab) => void;
  onPublish: () => void;
};

export function PublishCheckPanel({
  work,
  check,
  canPublish,
  publishing,
  onClose,
  onGoTab,
  onPublish
}: Props) {
  const items = copies(work, check);
  const problems = items.filter((i) => i.kind === "problem");
  const warns = items.filter((i) => i.kind === "warn");
  const passCount = Math.max(0, CHECK_FLAG_COUNT - problems.length - warns.length);
  const [passOpen, setPassOpen] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-check-title"
      onClick={onClose}
    >
      <div
        className="apollon-card w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="publish-check-title" className="text-sm font-bold text-slate-900">
            공개 전 점검
          </h2>
          <span className="text-xs text-slate-500">
            문제 {problems.length} · 확인 필요 {warns.length} · 통과 {passCount}
          </span>
          <button type="button" className="ml-auto text-slate-400" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {problems.map((item) => (
            <CheckRow key={item.flag} item={item} tone="problem" onGo={() => onGoTab(item.tab)} />
          ))}
          {warns.map((item) => (
            <CheckRow key={item.flag} item={item} tone="warn" onGo={() => onGoTab(item.tab)} />
          ))}
          <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">통과한 검사 {passCount}개</p>
              <p className="mt-0.5 text-xs text-slate-500">
                제목 국·영문 · 대표 이미지 규격 · 요약 · 카테고리 · 태그 · 대체 텍스트 · 연결 · 내부 폴더
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-apollon-700"
              onClick={() => setPassOpen((v) => !v)}
            >
              {passOpen ? "접기" : "펼치기"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-rose-600">
            {problems.length > 0
              ? `문제 ${problems.length}건을 해결해야 등록할 수 있습니다`
              : null}
          </p>
          <GhostBtn onClick={onClose}>닫기</GhostBtn>
          <PrimaryBtn disabled={!canPublish || publishing} onClick={onPublish}>
            등록하기
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  item,
  tone,
  onGo
}: {
  item: CheckCopy;
  tone: ItemKind;
  onGo: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
          tone === "problem" ? "bg-rose-500" : "bg-amber-500"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{item.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{item.sub}</p>
      </div>
      <button type="button" className="shrink-0 text-xs font-medium text-apollon-700" onClick={onGo}>
        {TAB_LABEL[item.tab]}
      </button>
    </div>
  );
}
