"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { WorkDetail, WorkFaq } from "@/lib/website/work-detail";
import {
  AiBtn,
  BilingualField,
  CharKo,
  FieldLabel,
  GhostBtn,
  Guide,
  LunaCallout,
  Sep,
  ToggleRow
} from "@/components/website/work-editor-ui";

type Props = {
  work: WorkDetail;
  saving?: boolean;
  onToggleShowFaq: (next: boolean) => void;
};

export function WorkFaqTab({ work, saving, onToggleShowFaq }: Props) {
  const faqs = work.faqs ?? [];

  return (
    <div>
      <div className="mb-5">
        <ToggleRow
          on={work.show_faq}
          disabled={saving}
          onToggle={() => onToggleShowFaq(!work.show_faq)}
          title="이 워크에 FAQ 표시"
          sub="ChatGPT · Perplexity 같은 AI가 인용할 가능성이 높아집니다. 3~5문항 권장"
        />
      </div>

      <LunaCallout>
        본문 · 규모 · 성과수치를 읽고 질문과 답변 초안을 만들어 드립니다. 답변은{" "}
        <b className="font-semibold">2~3문장</b>이 AI 인용에 가장 좋습니다.
        <div className="mt-2">
          <AiBtn disabled>✦ AI로 초안 만들기</AiBtn>
        </div>
      </LunaCallout>

      <div className="space-y-2.5">
        {faqs.map((faq, i) => (
          <FaqCard key={faq.id} faq={faq} index={i + 1} />
        ))}
      </div>

      <div className="mt-3">
        <GhostBtn disabled>＋ 문항 추가</GhostBtn>
      </div>

      <Guide>
        <b className="font-semibold text-slate-600">FAQ는 워크 상세 맨 아래</b>, Credit 다음 · Interview 앞에
        아코디언으로 들어갑니다. 첫 문항만 펼쳐지고 나머지는 접혀 있지만, 접힌 답변도 검색봇과 AI가 읽습니다.
        <br />
        같은 내용이 <b className="font-semibold text-slate-600">FAQPage 구조화 데이터</b>로 자동 생성됩니다.
      </Guide>
    </div>
  );
}

function FaqCard({ faq, index }: { faq: WorkFaq; index: number }) {
  const [open, setOpen] = useState(index === 1);
  const q = faq.question?.ko?.trim() || faq.question?.en?.trim() || "질문 없음";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5 text-left"
      >
        <span className="rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold text-white">{index}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{q}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-3 p-3.5">
          <div>
            <FieldLabel extra={<CharKo n={(faq.question?.ko ?? "").length} warn={45} limit={45} />}>
              질문
            </FieldLabel>
            <BilingualField
              ko={faq.question?.ko ?? ""}
              en={faq.question?.en ?? ""}
              readOnly
            />
            <Guide>
              <b className="font-semibold text-slate-600">국문 15~45자</b> · 반드시{" "}
              <b className="font-semibold text-slate-600">물음표로 끝나는 완전한 문장</b>
              <Sep />
              사람이 검색창이나 AI에 실제로 칠 법한 말로 씁니다.
              <br />
              좋은 예) 리뉴얼 이후 방문객 수는 어떻게 달라졌나요?
              <br />
              나쁜 예) 방문객 <span className="mx-1.5 text-slate-300">·</span> 성과 — 단어만 쓰면 AI가 질문으로
              인식하지 못합니다
            </Guide>
          </div>
          <div>
            <FieldLabel extra={<CharKo n={(faq.answer?.ko ?? "").length} warn={200} limit={200} />}>
              답변
            </FieldLabel>
            <BilingualField
              ko={faq.answer?.ko ?? ""}
              en={faq.answer?.en ?? ""}
              readOnly
              multiline
            />
            <Guide>
              <b className="font-semibold text-slate-600">국문 70~200자</b> ·{" "}
              <b className="font-semibold text-slate-600">2~3문장</b>
              <Sep />
              이 길이가 AI 인용에 가장 좋습니다. 너무 짧으면 인용할 내용이 없고, 너무 길면 통째로 인용되지 않습니다.
              <br />
              <b className="font-semibold text-slate-600">첫 문장에 답을 먼저</b> 쓰고 그다음에 설명합니다. 프로젝트
              이름·숫자·기술 용어를 넣으세요.
            </Guide>
          </div>
        </div>
      ) : null}
    </div>
  );
}
