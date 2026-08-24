"use client";

import { useState } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import type { ContentBlock, WorkDetail, WorkInterview, WorkSection } from "@/lib/website/work-detail";
import { fileName, mediaUrl } from "@/lib/website/work-detail";
import {
  AiBtn,
  BilingualField,
  CharKo,
  CharPair,
  FieldLabel,
  GhostBtn,
  Guide,
  Hint,
  LunaCallout,
  Req,
  Sep,
  SmallBtn
} from "@/components/website/work-editor-ui";

const LAYOUT_LABEL: Record<string, string> = {
  full: "1단",
  split: "2단 1:1",
  offset: "2단 2:1",
  "offset-reverse": "2단 1:2"
};

type Props = {
  work: WorkDetail;
  siteUrl: string;
};

export function WorkContentTab({ work, siteUrl }: Props) {
  const sections = work.work_sections ?? [];
  const interviews = work.work_interview ?? [];

  return (
    <div>
      <LunaCallout>
        블록을 위에서부터 쌓는 순서가 <b className="font-semibold">페이지 왼쪽 앵커 메뉴 순서</b>가 됩니다. 블록
        제목이 곧 메뉴 이름입니다. 이미지를 다 넣으신 뒤 <b className="font-semibold">[AI로 채우기]</b>를 누르면 글
        맥락과 이미지를 함께 읽고 대체 텍스트·캡션 초안을 만듭니다.
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AiBtn disabled>✦ AI로 채우기</AiBtn>
          <AiBtn disabled>✦ 영문 생성</AiBtn>
          <SmallBtn disabled>전체 접기</SmallBtn>
        </div>
      </LunaCallout>

      <div className="space-y-2.5">
        {sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            index={index + 1}
            siteUrl={siteUrl}
            interview={interviews.find((i) => i.section_id === section.id) ?? null}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <GhostBtn disabled>＋ 기본 블록</GhostBtn>
        <GhostBtn disabled>＋ 인터뷰 블록</GhostBtn>
        <GhostBtn disabled>이미지 라이브러리에서 가져오기</GhostBtn>
      </div>
      <Hint>
        Let&apos;s Talk · Company Profile 은 모든 워크에 자동으로 붙는 고정 영역입니다. 여기서 관리하지 않습니다
      </Hint>
    </div>
  );
}

function SectionCard({
  section,
  index,
  siteUrl,
  interview
}: {
  section: WorkSection;
  index: number;
  siteUrl: string;
  interview: WorkInterview | null;
}) {
  const [open, setOpen] = useState(false);
  const blocks = section.content_blocks ?? [];
  const imageCount = blocks.reduce((n, b) => n + (b.block_images?.length ?? 0), 0);
  const videoCount = blocks.filter((b) => b.type === "video").length;
  const isInterview = section.kind === "interview";
  const title = section.headline?.ko?.trim() || section.headline?.en?.trim() || "제목 없음";
  const mediaLabel = [
    imageCount ? `이미지 ${imageCount}` : "",
    videoCount ? `영상 ${videoCount}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5 text-left"
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        <span className="rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold text-white">{index}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{title}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            isInterview ? "bg-apollon-50 text-apollon-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {isInterview ? "인터뷰" : "기본"}
        </span>
        {mediaLabel ? <span className="hidden text-xs text-slate-400 sm:inline">{mediaLabel}</span> : null}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="space-y-4 p-3.5">
          <div>
            <FieldLabel
              extra={
                <CharKo n={(section.headline?.ko ?? "").length} warn={16} limit={16} />
              }
            >
              블록 제목
              <Req />
              <span className="font-normal text-slate-400">— 왼쪽 앵커 메뉴에 표시됩니다</span>
            </FieldLabel>
            <BilingualField
              ko={section.headline?.ko ?? ""}
              en={section.headline?.en ?? ""}
              readOnly
            />
            <Guide>
              <b className="font-semibold text-slate-600">16자 이내</b> · 짧을수록 좋습니다
              <Sep />
              왼쪽 앵커 메뉴에 그대로 들어갑니다. 길면 메뉴에서 잘립니다.
              <br />
              자주 쓰는 이름 — Overview · Creative · Space · Synopsis · Pre-Production · Production · On-site Test
              · Achievement · Credit
              <br />
              <b className="font-semibold text-slate-600">블록은 8개까지</b>. 9개째부터는 앵커 메뉴가 화면에서
              넘칩니다.
            </Guide>
          </div>

          <div>
            <FieldLabel
              extra={
                <CharPair
                  ko={(section.lead?.ko ?? "").length}
                  en={(section.lead?.en ?? "").length}
                  koWarn={120}
                  enWarn={240}
                  koLimit={120}
                  enLimit={240}
                />
              }
            >
              기본 설명
              <span className="font-normal text-slate-400">— 제목 옆 고정 위치. 모든 블록 공통</span>
            </FieldLabel>
            <BilingualField
              ko={section.lead?.ko ?? ""}
              en={section.lead?.en ?? ""}
              readOnly
              multiline
            />
            <Guide>
              <b className="font-semibold text-slate-600">국문 60~120자</b> · 영문 120~240자 ·{" "}
              <b className="font-semibold text-slate-600">2~3문장</b>
              <Sep />
              제목 바로 옆 고정 위치라 길이가 들쭉날쭉하면 블록마다 높이가 달라집니다.
              <br />이 블록이 <b className="font-semibold text-slate-600">무엇에 대한 것인지</b>를 먼저 쓰세요. 본문은
              아래 자유 영역에서 이어 씁니다.
            </Guide>
          </div>

          {isInterview ? (
            <InterviewRead interview={interview} />
          ) : (
            blocks.map((block) => (
              <BlockRead key={block.id} block={block} siteUrl={siteUrl} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function InterviewRead({ interview }: { interview: WorkInterview | null }) {
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>
          연결할 인사이트
          <Req />
        </FieldLabel>
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400">
          {interview?.insight_id ? `인사이트 ${interview.insight_id}` : "＋ 인사이트에서 고르기"}
        </div>
        <Guide>
          인터뷰는 별도 데이터가 아니라 <b className="font-semibold text-slate-600">인사이트에 등록된 글 하나</b>를
          연결하는 블록입니다. 화면에서 [Learn more]를 누르면 <b className="font-semibold text-slate-600">팝업</b>으로
          열리고, 팝업 안 「원문보기」로 인사이트 페이지로 이동합니다.
        </Guide>
      </div>
      <div>
        <FieldLabel
          extra={
            <CharKo n={(interview?.quote_override?.ko ?? "").length} warn={70} limit={70} />
          }
        >
          화면에 보일 인용문
          <Req />
        </FieldLabel>
        <BilingualField
          ko={interview?.quote_override?.ko ?? ""}
          en={interview?.quote_override?.en ?? ""}
          readOnly
          multiline
        />
        <Guide>
          <b className="font-semibold text-slate-600">국문 40~70자</b> ·{" "}
          <b className="font-semibold text-slate-600">세 줄까지</b>
          <Sep />
          팝업을 열기 전 카드에 크게 보이는 문장입니다. 70자를 넘으면 네 줄이 되어 카드가 흐트러집니다.
          <br />
          인사이트 본문에서 <b className="font-semibold text-slate-600">가장 강한 한 문장</b>을 골라 넣으세요.
        </Guide>
      </div>
      <div>
        <FieldLabel
          extra={
            <CharKo n={(interview?.attribution_override?.ko ?? "").length} warn={24} limit={24} />
          }
        >
          이름 · 직함
          <Req />
        </FieldLabel>
        <BilingualField
          ko={interview?.attribution_override?.ko ?? ""}
          en={interview?.attribution_override?.en ?? ""}
          readOnly
        />
        <Guide>
          <b className="font-semibold text-slate-600">국문 24자 이내</b> · 형식은{" "}
          <b className="font-semibold text-slate-600">이름 - 직함</b>
          <Sep />
          프로필 이미지는 정사각형 <b className="font-semibold text-slate-600">600 × 600</b> · JPG · 300KB 이하
        </Guide>
      </div>
    </div>
  );
}

function BlockRead({ block, siteUrl }: { block: ContentBlock; siteUrl: string }) {
  if (block.type === "images") {
    const images = block.block_images ?? [];
    const layout = block.layout ?? "full";
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">이미지 · {images.length}장</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {LAYOUT_LABEL[layout] ?? layout}
          </span>
        </div>
        <Guide>
          <b className="font-semibold text-slate-600">JPG</b> · 긴 변{" "}
          <b className="font-semibold text-slate-600">2560px</b> ·{" "}
          <b className="font-semibold text-slate-600">2MB 이하</b> ·{" "}
          <b className="font-semibold text-slate-600">비율 자유</b>
          <Sep />
          본문 이미지는 가로·세로·정사각형 아무거나 됩니다. 올린 비율 그대로 들어갑니다.
          <br />
          <b className="font-semibold text-slate-600">2단 2:1 · 1:2 배치의 작은 쪽은 세로형(3:4)</b>이 어울립니다. 가로
          사진을 넣으면 좌우가 잘립니다.
        </Guide>
        <div className="mt-3 space-y-3">
          {images.map((img) => (
            <div key={img.id} className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr]">
              <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-[10px] text-slate-400">
                {mediaUrl(siteUrl, img.src) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(siteUrl, img.src) ?? ""} alt="" className="h-full w-full object-cover" />
                ) : (
                  fileName(img.src)
                )}
              </div>
              <div className="space-y-1.5 text-xs text-slate-600">
                <p>
                  <span className="inline-block w-12 font-semibold text-slate-500">대체</span>
                  {img.alt?.ko || img.alt?.en || "—"}
                </p>
                <p>
                  <span className="inline-block w-12 font-semibold text-slate-500">캡션</span>
                  {img.caption?.ko || img.caption?.en || "캡션 없음"}
                </p>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500">화면에 캡션 표시</span>
                  <span className={img.caption_visible ? "text-emerald-600" : "text-slate-400"}>
                    {img.caption_visible ? "켜짐" : "꺼짐"}
                  </span>
                  {img.ai_generated ? (
                    <span className="text-apollon-700">
                      ✦ {img.ai_confirmed ? "AI 확인됨" : "확인 전"}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          ))}
        </div>
        <Guide>
          <b className="font-semibold text-slate-600">대체 텍스트</b> — 국문 40자 이내. 화면에 안 보입니다. 무엇이
          찍혔는지 사실만. 모든 이미지에 필수입니다.
          <br />
          <b className="font-semibold text-slate-600">캡션</b> — 국문 40~90자, 1~2문장.{" "}
          <b className="font-semibold text-slate-600">화면에 보입니다.</b> AI가 인용하는 것도 이쪽입니다. 말할 것이
          있는 이미지에만 켜세요. 워크 하나에 <b className="font-semibold text-slate-600">5~8장</b>이 적당합니다.
          <br />
          캡션에는 <b className="font-semibold text-slate-600">프로젝트 이름·기술·숫자</b>를 넣으세요. 좋은 예) 폭
          23.5m 미디어월. 15분마다 웰컴쇼가 재생됩니다. 나쁜 예) 아름다운 공간의 모습
        </Guide>
      </div>
    );
  }

  if (block.type === "video") {
    return (
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 text-xs font-bold text-slate-500">영상</div>
        <p className="rounded-md bg-slate-100 px-3 py-6 text-center text-sm text-slate-500">
          ▶ {block.video_url || "영상 없음"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          대체 {block.video_alt?.ko || block.video_alt?.en || "—"}
        </p>
        <Guide>
          <b className="font-semibold text-slate-600">임베드</b> — 유튜브·Behance 주소를 그대로 붙여넣으세요. 재생
          버튼을 누르기 전까지는 이미지 한 장만 보이므로 페이지가 무거워지지 않습니다.
          <br />
          <b className="font-semibold text-slate-600">배경 루프</b> — MP4(H.264) · 1280×720 · 4~6초 · 24fps · 소리
          없음 · <b className="font-semibold text-slate-600">1.5MB 이하</b>. 마우스를 올리면 재생되고, 모바일에서는
          정지 이미지로 대체됩니다.
          <br />
          <b className="font-semibold text-slate-600">본편 영상</b> — 9월 예정. 유튜브에 올리지 않을 고화질 영상을 우리
          서버에서 재생합니다.
        </Guide>
      </div>
    );
  }

  const body = block.body?.ko || block.body?.en;
  if (!body) return null;
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{body}</p>
  );
}
