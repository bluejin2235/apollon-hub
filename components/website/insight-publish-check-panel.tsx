"use client";

import { useState } from "react";
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
import { GhostBtn, PrimaryBtn } from "@/components/website/work-editor-ui";

type ItemKind = "problem" | "warn";

type CheckCopy = {
  flag: (typeof INSIGHT_PROBLEM_FLAGS)[number] | (typeof INSIGHT_WARN_FLAGS)[number];
  kind: ItemKind;
  tab: InsightEditorTab;
  title: string;
  sub: string;
};

const TAB_LABEL: Record<InsightEditorTab, string> = {
  basic: "기본정보 →",
  content: "본문 →",
  related: "연결 →"
};

const FLAG_TAB: Record<CheckCopy["flag"], InsightEditorTab> = {
  missing_summary_en: "basic",
  missing_key_alt: "basic",
  no_key_image: "basic",
  key_image_size_unknown: "basic",
  key_image_too_small: "basic",
  no_tags: "basic",
  summary_too_long: "basic",
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

const FLAG_SUB: Record<CheckCopy["flag"], string> = {
  missing_summary_en: "영어권 검색과 AI에 이 글이 노출되지 않습니다",
  missing_key_alt: "모든 이미지에 필수입니다.",
  no_key_image: "목록 카드·링크 공유에 쓰는 대표 이미지를 올려 주세요.",
  key_image_size_unknown: "대표 이미지를 다시 올리면 가로·세로 크기가 함께 저장됩니다.",
  key_image_too_small: "긴 변 2000px 이상을 권장합니다. 작으면 경고만 납니다.",
  no_blocks: "본문 탭에서 블록을 쌓아 주세요. 섹션은 없습니다.",
  missing_image_alt: "대체 텍스트 — 국문 40자 이내. 화면에 안 보입니다.",
  ai_unconfirmed: "AI가 만든 캡션을 확인해야 공개할 수 있습니다.",
  missing_body_en: "글 블록의 영문을 채워 주세요.",
  missing_qa_en: "질문·답변 블록의 영문을 채워 주세요.",
  empty_blocks: "비어 있는 블록은 화면에 안 나옵니다.",
  body_image_too_small: "본문 이미지 긴 변 2000px 이상을 권장합니다.",
  no_tags: "3~6개 · 태그당 2~10자",
  no_related: "화면에는 4개가 나옵니다",
  summary_too_long: "구글 검색 결과에서 뒤가 잘립니다.",
  stale_draft: "초안이 오래되었습니다. 내용을 확인하고 저장하세요."
};

function flagOn(check: CheckInsights, flag: CheckCopy["flag"]): boolean {
  const value = check[flag];
  if (flag === "empty_blocks") return Number(value) > 0;
  return Boolean(value);
}

function copies(insight: InsightDetail, check: CheckInsights): CheckCopy[] {
  const aiCount = countInsightAiUnconfirmed(insight);
  const all: CheckCopy[] = [
    ...INSIGHT_PROBLEM_FLAGS.map((flag) => ({
      flag,
      kind: "problem" as const,
      tab: FLAG_TAB[flag],
      title:
        flag === "ai_unconfirmed" && aiCount > 0
          ? `AI가 만든 캡션 ${aiCount}개가 확인 전입니다`
          : INSIGHT_CHECK_LABEL[flag],
      sub: FLAG_SUB[flag]
    })),
    ...INSIGHT_WARN_FLAGS.map((flag) => ({
      flag,
      kind: "warn" as const,
      tab: FLAG_TAB[flag],
      title:
        flag === "empty_blocks" && Number(check.empty_blocks) > 0
          ? `비어 있는 블록이 ${Number(check.empty_blocks)}개 있습니다`
          : INSIGHT_CHECK_LABEL[flag],
      sub: FLAG_SUB[flag]
    }))
  ];
  return all.filter((item) => flagOn(check, item.flag));
}

const CHECK_FLAG_COUNT = INSIGHT_PROBLEM_FLAGS.length + INSIGHT_WARN_FLAGS.length;

type Props = {
  insight: InsightDetail;
  check: CheckInsights;
  canPublish: boolean;
  publishing?: boolean;
  onClose: () => void;
  onGoTab: (tab: InsightEditorTab) => void;
  onPublish: () => void;
};

export function InsightPublishCheckPanel({
  insight,
  check,
  canPublish,
  publishing,
  onClose,
  onGoTab,
  onPublish
}: Props) {
  const items = copies(insight, check);
  const problems = items.filter((i) => i.kind === "problem");
  const warns = items.filter((i) => i.kind === "warn");
  const passCount = Math.max(0, CHECK_FLAG_COUNT - problems.length - warns.length);
  const [passOpen, setPassOpen] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-publish-check-title"
      onClick={onClose}
    >
      <div className="apollon-card w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="insight-publish-check-title" className="text-sm font-bold text-slate-900">
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
                제목 국·영문 · 대표 이미지 · 요약 · 카테고리 · 태그 · 본문 블록 · 대체 텍스트 · 연결
              </p>
              {passOpen ? (
                <p className="mt-2 text-xs text-slate-400">
                  워크와 달리 16:9 · 섹션 · FAQ 검사는 없습니다.
                </p>
              ) : null}
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
            {problems.length > 0 ? `문제 ${problems.length}건을 해결해야 등록할 수 있습니다` : null}
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
