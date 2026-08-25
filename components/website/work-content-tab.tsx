"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import {
  createSection,
  deleteSection,
  reorderBlocks,
  reorderSections,
  updateSection
} from "@/lib/website/api";
import type { ContentBlock, Loc, WorkDetail, WorkInterview, WorkSection } from "@/lib/website/work-detail";
import { asLoc } from "@/lib/website/work-detail";
import { BlockCard } from "@/components/website/block-card";
import { BlockPicker } from "@/components/website/block-picker";
import {
  AiBtn,
  BilingualField,
  CharKo,
  CharPair,
  FieldLabel,
  GhostBtn,
  Guide,
  Hint,
  locField,
  LunaCallout,
  Req,
  Sep,
  SmallBtn
} from "@/components/website/work-editor-ui";

type Props = {
  work: WorkDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

export function WorkContentTab({ work, siteUrl, onReload }: Props) {
  const sections = [...(work.work_sections ?? [])].sort((a, b) => a.sort - b.sort);
  const interviews = work.work_interview ?? [];
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(sections[0] ? [sections[0].id] : []));
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSection() {
    const res = await createSection(work.id, {
      headline: { ko: "새 섹션", en: "New section" },
      kind: "basic",
      sort: (sections[sections.length - 1]?.sort ?? 0) + 1
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= sections.length) return;
    const order = sections.map((section, i) => ({
      id: section.id,
      sort: i === index ? next : i === next ? index : i
    }));
    const res = await reorderSections(work.id, order);
    if (!res.ok) setError(res.error);
    else await onReload();
  }

  async function removeSection(id: string) {
    if (!confirm("이 섹션과 안의 블록을 삭제할까요?")) return;
    const res = await deleteSection(work.id, id);
    if (!res.ok) setError(res.error);
    else await onReload();
  }

  const pickerSection = sections.find((s) => s.id === pickerFor);
  const pickerSort = Math.max(0, ...(pickerSection?.content_blocks ?? []).map((b) => b.sort)) + 1;

  return (
    <div>
      <LunaCallout>
        블록을 위에서부터 쌓는 순서가 <b className="font-semibold">페이지 왼쪽 앵커 메뉴 순서</b>가 됩니다. 블록
        제목이 곧 메뉴 이름입니다. 이미지를 다 넣으신 뒤 <b className="font-semibold">[AI로 채우기]</b>를 누르면 글
        맥락과 이미지를 함께 읽고 대체 텍스트·캡션 초안을 만듭니다.
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AiBtn disabled>✦ AI로 채우기</AiBtn>
          <AiBtn disabled>✦ 영문 생성</AiBtn>
          <SmallBtn onClick={() => setOpenIds(new Set())}>전체 접기</SmallBtn>
        </div>
      </LunaCallout>

      {sections.length > 8 ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          앵커 메뉴는 8개까지 표시됩니다. 9개째부터 화면에서 넘칩니다.
        </div>
      ) : null}

      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}

      <div className="space-y-2.5">
        {sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            index={index + 1}
            total={sections.length}
            workId={work.id}
            siteUrl={siteUrl}
            interview={interviews.find((i) => i.section_id === section.id) ?? null}
            open={openIds.has(section.id)}
            onToggle={() => toggle(section.id)}
            onMove={(dir) => void moveSection(index, dir)}
            onDelete={() => void removeSection(section.id)}
            onAddBlock={() => setPickerFor(section.id)}
            onReload={onReload}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <GhostBtn onClick={() => void addSection()}>＋ 섹션 추가</GhostBtn>
      </div>
      <Hint>
        Let&apos;s Talk · Company Profile 은 모든 워크에 자동으로 붙는 고정 영역입니다. 여기서 관리하지 않습니다
      </Hint>

      {pickerFor ? (
        <BlockPicker
          open
          sectionId={pickerFor}
          nextSort={pickerSort}
          onClose={() => setPickerFor(null)}
          onPicked={() => void onReload()}
        />
      ) : null}
    </div>
  );
}

function SectionCard({
  section,
  index,
  total,
  workId,
  siteUrl,
  interview,
  open,
  onToggle,
  onMove,
  onDelete,
  onAddBlock,
  onReload
}: {
  section: WorkSection;
  index: number;
  total: number;
  workId: string;
  siteUrl: string;
  interview: WorkInterview | null;
  open: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAddBlock: () => void;
  onReload: () => Promise<void>;
}) {
  const blocks = [...(section.content_blocks ?? [])].sort((a, b) => a.sort - b.sort);
  const imageCount = blocks.reduce((n, b) => n + (b.block_images?.length ?? 0), 0);
  const videoCount = blocks.filter((b) => b.preset.startsWith("video") || b.preset === "embed").length;
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
      <div className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2.5">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold text-white">{index}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{title}</span>
        </button>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            isInterview ? "bg-apollon-50 text-apollon-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {isInterview ? "인터뷰" : "기본"}
        </span>
        {mediaLabel ? <span className="hidden text-xs text-slate-400 sm:inline">{mediaLabel}</span> : null}
        <button
          type="button"
          disabled={index <= 1}
          onClick={() => onMove(-1)}
          className="text-xs text-slate-400 disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={index >= total}
          onClick={() => onMove(1)}
          className="text-xs text-slate-400 disabled:opacity-30"
        >
          ↓
        </button>
        <button type="button" onClick={onDelete} className="text-xs text-rose-600">
          삭제
        </button>
        <button type="button" onClick={onToggle} className="text-slate-400">
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open ? (
        <SectionBody
          section={section}
          workId={workId}
          siteUrl={siteUrl}
          interview={interview}
          isInterview={isInterview}
          blocks={blocks}
          onAddBlock={onAddBlock}
          onReload={onReload}
        />
      ) : null}
    </div>
  );
}

function SectionBody({
  section,
  workId,
  siteUrl,
  interview,
  isInterview,
  blocks,
  onAddBlock,
  onReload
}: {
  section: WorkSection;
  workId: string;
  siteUrl: string;
  interview: WorkInterview | null;
  isInterview: boolean;
  blocks: ContentBlock[];
  onAddBlock: () => void;
  onReload: () => Promise<void>;
}) {
  const [headline, setHeadline] = useState<Loc>(asLoc(section.headline));
  const [lead, setLead] = useState<Loc>(asLoc(section.lead));
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHeadline(asLoc(section.headline));
    setLead(asLoc(section.lead));
  }, [section]);

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 1500);
  }

  async function persist(patch: Record<string, unknown>) {
    const res = await updateSection(workId, section.id, patch);
    if (!res.ok) setError(res.error);
  }

  async function moveBlock(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= blocks.length) return;
    const order = blocks.map((block, i) => ({
      id: block.id,
      sort: i === index ? next : i === next ? index : i
    }));
    const res = await reorderBlocks(section.id, order);
    if (!res.ok) setError(res.error);
    else await onReload();
  }

  function toggleBlock(id: string) {
    setOpenBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4 p-3.5">
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div>
        <FieldLabel extra={<CharKo n={headline.ko.length} warn={16} limit={16} />}>
          블록 제목
          <Req />
          <span className="font-normal text-slate-400">— 왼쪽 앵커 메뉴에 표시됩니다</span>
        </FieldLabel>
        <BilingualField
          ko={headline.ko}
          en={headline.en}
          onKo={(v) => {
            const next = locField(headline, "ko", v);
            setHeadline(next);
            schedule({ headline: next });
          }}
          onEn={(v) => {
            const next = locField(headline, "en", v);
            setHeadline(next);
            schedule({ headline: next });
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            void persist({ headline });
          }}
        />
        <Guide>
          <b className="font-semibold text-slate-600">16자 이내</b> · 짧을수록 좋습니다
          <Sep />
          왼쪽 앵커 메뉴에 그대로 들어갑니다. 길면 메뉴에서 잘립니다.
          <br />
          자주 쓰는 이름 — Overview · Creative · Space · Synopsis · Pre-Production · Production · On-site Test ·
          Achievement · Credit
          <br />
          <b className="font-semibold text-slate-600">블록은 8개까지</b>. 9개째부터는 앵커 메뉴가 화면에서 넘칩니다.
        </Guide>
      </div>

      <div>
        <FieldLabel
          extra={
            <CharPair
              ko={lead.ko.length}
              en={lead.en.length}
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
          ko={lead.ko}
          en={lead.en}
          multiline
          onKo={(v) => {
            const next = locField(lead, "ko", v);
            setLead(next);
            schedule({ lead: next });
          }}
          onEn={(v) => {
            const next = locField(lead, "en", v);
            setLead(next);
            schedule({ lead: next });
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            void persist({ lead });
          }}
        />
        <Guide>
          <b className="font-semibold text-slate-600">국문 60~120자</b> · 영문 120~240자 ·{" "}
          <b className="font-semibold text-slate-600">2~3문장</b>
          <Sep />
          제목 바로 옆 고정 위치라 길이가 들쭉날쭉하면 블록마다 높이가 달라집니다.
          <br />이 블록이 <b className="font-semibold text-slate-600">무엇에 대한 것인지</b>를 먼저 쓰세요. 본문은 아래
          자유 영역에서 이어 씁니다.
        </Guide>
      </div>

      {isInterview ? <InterviewRead interview={interview} /> : null}

      {blocks.map((block, i) => (
        <BlockCard
          key={block.id}
          block={block}
          index={i + 1}
          total={blocks.length}
          sectionId={section.id}
          workId={workId}
          siteUrl={siteUrl}
          collapsed={!openBlocks.has(block.id)}
          onToggle={() => toggleBlock(block.id)}
          onMove={(dir) => void moveBlock(i, dir)}
          onReload={onReload}
        />
      ))}

      {!isInterview ? (
        <GhostBtn onClick={onAddBlock}>＋ 블록 추가</GhostBtn>
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
        <FieldLabel extra={<CharKo n={(interview?.quote_override?.ko ?? "").length} warn={70} limit={70} />}>
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
        <FieldLabel extra={<CharKo n={(interview?.attribution_override?.ko ?? "").length} warn={24} limit={24} />}>
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
