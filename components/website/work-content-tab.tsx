"use client";

import { useEffect, useRef, useState } from "react";
import {
  createSection,
  deleteSection,
  moveBlock as moveBlockApi,
  reorderBlocks,
  reorderSections,
  updateSection
} from "@/lib/website/api";
import type { ContentBlock, Loc, WorkDetail, WorkInterview, WorkSection } from "@/lib/website/work-detail";
import { asLoc } from "@/lib/website/work-detail";
import { workFolderPrefix } from "@/lib/website/upload-path";
import { InterviewEditor } from "@/components/website/interview-editor";
import { BlockCard } from "@/components/website/block-card";
import { BlockPicker } from "@/components/website/block-picker";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import { TextDupProvider } from "@/components/website/text-dup-context";
import { showToast } from "@/components/website/toast";
import { locField } from "@/components/website/work-editor-ui";
import { Alert, Field } from "@/components/website/ui";
import { GuideTermProvider } from "@/components/website/ui/GuideTerm";
import "./ui/work-admin.css";

type Props = {
  work: WorkDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

const SECTION_COLORS = [
  { id: "c1", hex: "#534AB7" },
  { id: "c2", hex: "#2563a8" },
  { id: "c3", hex: "#0e7490" },
  { id: "c4", hex: "#0f7a45" },
  { id: "c5", hex: "#a35a08" },
  { id: "c6", hex: "#a8437a" }
] as const;

function sectionTitle(section: WorkSection) {
  return section.headline?.ko?.trim() || section.headline?.en?.trim() || "제목 없음";
}

function colorClass(index: number) {
  return SECTION_COLORS[index % SECTION_COLORS.length]!.id;
}

function AiBadge() {
  return (
    <button type="button" className="aib" disabled title="국문으로 영문 생성">
      AI
    </button>
  );
}

function Bi({
  ko,
  en,
  onKo,
  onEn,
  onBlur,
  multiline,
  koPlaceholder,
  enPlaceholder
}: {
  ko: string;
  en: string;
  onKo: (v: string) => void;
  onEn: (v: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  koPlaceholder?: string;
  enPlaceholder?: string;
}) {
  return (
    <div className="two">
      {multiline ? (
        <textarea
          className="i"
          value={ko}
          placeholder={koPlaceholder}
          style={{ minHeight: 44 }}
          onChange={(e) => onKo(e.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          className="i"
          value={ko}
          placeholder={koPlaceholder}
          onChange={(e) => onKo(e.target.value)}
          onBlur={onBlur}
        />
      )}
      <div className="enw">
        {multiline ? (
          <textarea
            className="i"
            value={en}
            placeholder={enPlaceholder}
            style={{ minHeight: 44 }}
            onChange={(e) => onEn(e.target.value)}
            onBlur={onBlur}
          />
        ) : (
          <input
            className="i"
            value={en}
            placeholder={enPlaceholder}
            onChange={(e) => onEn(e.target.value)}
            onBlur={onBlur}
          />
        )}
        <AiBadge />
      </div>
    </div>
  );
}

export function WorkContentTab({ work, siteUrl, onReload }: Props) {
  const sections = [...(work.work_sections ?? [])].sort((a, b) => a.sort - b.sort);
  const interviews = work.work_interview ?? [];
  const allBlockIds = sections.flatMap((section) =>
    (section.content_blocks ?? []).map((block) => block.id)
  );
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(sections[0] ? [sections[0].id] : []));
  const [openBlockIds, setOpenBlockIds] = useState<Set<string>>(() => new Set());
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteSectionId, setDeleteSectionId] = useState<string | null>(null);

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBlock(id: string) {
    setOpenBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function ensureOpen(id: string) {
    setOpenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function collapseAll() {
    setOpenIds(new Set());
    setOpenBlockIds(new Set());
  }

  function expandAll() {
    setOpenIds(new Set(sections.map((section) => section.id)));
    setOpenBlockIds(new Set(allBlockIds));
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

  async function removeSection() {
    if (!deleteSectionId) return;
    const res = await deleteSection(work.id, deleteSectionId);
    setDeleteSectionId(null);
    if (!res.ok) setError(res.error);
    else await onReload();
  }

  async function moveBlockInWork(sectionIndex: number, blockIndex: number, dir: -1 | 1) {
    const section = sections[sectionIndex];
    if (!section) return;
    const blocks = [...(section.content_blocks ?? [])].sort((a, b) => a.sort - b.sort);
    const block = blocks[blockIndex];
    if (!block) return;

    const nextIndex = blockIndex + dir;
    if (nextIndex >= 0 && nextIndex < blocks.length) {
      const order = blocks.map((item, i) => ({
        id: item.id,
        sort: i === blockIndex ? nextIndex : i === nextIndex ? blockIndex : i
      }));
      const res = await reorderBlocks(section.id, order);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
      return;
    }

    const targetSection = sections[sectionIndex + dir];
    if (!targetSection) return;

    const targetBlocks = [...(targetSection.content_blocks ?? [])].sort((a, b) => a.sort - b.sort);
    const toSort = dir === 1 ? 0 : targetBlocks.length;
    const res = await moveBlockApi(work.id, {
      blockId: block.id,
      toSectionId: targetSection.id,
      toSort
    });
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      return;
    }

    ensureOpen(targetSection.id);
    await onReload();
    showToast({
      message: `'${sectionTitle(targetSection)}' 으로 옮겼습니다`,
      tone: "ok",
      durationMs: 2500
    });
    window.setTimeout(() => {
      document.getElementById(`content-block-${block.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 120);
  }

  const pickerSection = sections.find((s) => s.id === pickerFor);
  const pickerSort = Math.max(0, ...(pickerSection?.content_blocks ?? []).map((b) => b.sort)) + 1;

  return (
    <TextDupProvider work={work}>
    <GuideTermProvider>
    <div className="wa">
      <div className="luna">
        <div className="av">L</div>
        <div>
          블록 순서가 페이지 왼쪽 <b>앵커 메뉴</b> 순서가 됩니다. 블록 제목이 곧 메뉴 이름입니다.
          이미지를 다 넣으신 뒤 [AI로 채우기] 를 누르면 글 맥락과 이미지를 함께 읽고 대체
          텍스트·캡션 초안을 만듭니다.
          <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button type="button" className="btn ai sm" disabled>
              ✦ AI로 채우기
            </button>
            <button type="button" className="btn ai sm" disabled>
              ✦ 영문 생성
            </button>
            <button type="button" className="btn sm" onClick={collapseAll}>
              전체 접기
            </button>
            <button type="button" className="btn sm" onClick={expandAll}>
              전체 펼치기
            </button>
          </div>
        </div>
      </div>

      <div className="legend">
        <span style={{ fontSize: 11.5, color: "var(--dim)", fontWeight: 600 }}>섹션 색</span>
        {SECTION_COLORS.map((color, i) => (
          <span className="lg" key={color.id}>
            <i style={{ background: color.hex }} />
            {i + 1}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "var(--faint)" }}>블록은 그 섹션 색의 옅은 버전입니다</span>
      </div>

      {sections.length > 8 ? (
        <Alert tone="w">앵커 메뉴는 8개까지 표시됩니다. 9개째부터 화면에서 넘칩니다.</Alert>
      ) : null}

      {error ? (
        <p style={{ marginBottom: 12, fontSize: 13, color: "var(--err)" }}>{error}</p>
      ) : null}

      {sections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          sectionIndex={index}
          sections={sections}
          index={index + 1}
          total={sections.length}
          color={colorClass(index)}
          workId={work.id}
          uploadRoot={workFolderPrefix(work.slug, work.id)}
          siteUrl={siteUrl}
          interview={interviews.find((i) => i.section_id === section.id) ?? null}
          open={openIds.has(section.id)}
          openBlockIds={openBlockIds}
          onToggle={() => toggle(section.id)}
          onToggleBlock={toggleBlock}
          onMove={(dir) => void moveSection(index, dir)}
          onDelete={() => setDeleteSectionId(section.id)}
          onAddBlock={() => setPickerFor(section.id)}
          onMoveBlock={(blockIndex, dir) => void moveBlockInWork(index, blockIndex, dir)}
          onReload={onReload}
        />
      ))}

      <button type="button" className="adds" onClick={() => void addSection()}>
        ＋ 섹션 추가
      </button>
      <div className="hint">
        Let&apos;s Talk · Company Profile 은 모든 워크에 자동으로 붙는 고정 영역입니다. 여기서 관리하지
        않습니다
      </div>

      {pickerFor ? (
        <BlockPicker
          open
          sectionId={pickerFor}
          nextSort={pickerSort}
          onClose={() => setPickerFor(null)}
          onPicked={(blockId) => {
            setOpenBlockIds((prev) => {
              const next = new Set(prev);
              next.add(blockId);
              return next;
            });
            ensureOpen(pickerFor);
            setPickerFor(null);
            void onReload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteSectionId)}
        title="이 섹션과 안의 블록을 삭제할까요?"
        confirmText="삭제"
        danger
        onConfirm={() => removeSection()}
        onCancel={() => setDeleteSectionId(null)}
      />
    </div>
    </GuideTermProvider>
    </TextDupProvider>
  );
}

function SectionCard({
  section,
  sectionIndex,
  sections,
  index,
  total,
  color,
  workId,
  uploadRoot,
  siteUrl,
  interview,
  open,
  openBlockIds,
  onToggle,
  onToggleBlock,
  onMove,
  onDelete,
  onAddBlock,
  onMoveBlock,
  onReload
}: {
  section: WorkSection;
  sectionIndex: number;
  sections: WorkSection[];
  index: number;
  total: number;
  color: string;
  workId: string;
  uploadRoot: string;
  siteUrl: string;
  interview: WorkInterview | null;
  open: boolean;
  openBlockIds: Set<string>;
  onToggle: () => void;
  onToggleBlock: (id: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAddBlock: () => void;
  onMoveBlock: (blockIndex: number, dir: -1 | 1) => void;
  onReload: () => Promise<void>;
}) {
  const blocks = [...(section.content_blocks ?? [])].sort((a, b) => a.sort - b.sort);
  const imageCount = blocks.reduce((n, b) => n + (b.block_images?.length ?? 0), 0);
  const videoCount = blocks.filter((b) => b.preset.startsWith("video") || b.preset === "embed").length;
  const isInterview = section.kind === "interview";
  const title = sectionTitle(section);
  const summary = [
    `블록 ${blocks.length}개`,
    imageCount ? `이미지 ${imageCount}` : "",
    videoCount ? `영상 ${videoCount}` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`sec ${color}${open ? " on" : ""}`}>
      <div className="sech" onClick={onToggle}>
        <span className="no">{index}</span>
        <span className="nm">{title}</span>
        <span className="mt">{summary}</span>
        <span className="flex-1" />
        <button
          type="button"
          className="ico"
          disabled={index <= 1}
          onClick={(event) => {
            event.stopPropagation();
            onMove(-1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          className="ico"
          disabled={index >= total}
          onClick={(event) => {
            event.stopPropagation();
            onMove(1);
          }}
        >
          ↓
        </button>
        <button
          type="button"
          className="ico"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          ✕
        </button>
        <span className="ar">▾</span>
      </div>
      {open ? (
        <div className="secb">
          <SectionBody
            section={section}
            sectionIndex={sectionIndex}
            sections={sections}
            workId={workId}
            uploadRoot={uploadRoot}
            siteUrl={siteUrl}
            interview={interview}
            isInterview={isInterview}
            blocks={blocks}
            openBlockIds={openBlockIds}
            onToggleBlock={onToggleBlock}
            onAddBlock={onAddBlock}
            onMoveBlock={onMoveBlock}
            onReload={onReload}
          />
        </div>
      ) : null}
    </div>
  );
}

function SectionBody({
  section,
  sectionIndex,
  sections,
  workId,
  uploadRoot,
  siteUrl,
  interview,
  isInterview,
  blocks,
  openBlockIds,
  onToggleBlock,
  onAddBlock,
  onMoveBlock,
  onReload
}: {
  section: WorkSection;
  sectionIndex: number;
  sections: WorkSection[];
  workId: string;
  uploadRoot: string;
  siteUrl: string;
  interview: WorkInterview | null;
  isInterview: boolean;
  blocks: ContentBlock[];
  openBlockIds: Set<string>;
  onToggleBlock: (id: string) => void;
  onAddBlock: () => void;
  onMoveBlock: (blockIndex: number, dir: -1 | 1) => void;
  onReload: () => Promise<void>;
}) {
  const [headline, setHeadline] = useState<Loc>(asLoc(section.headline));
  const [lead, setLead] = useState<Loc>(asLoc(section.lead));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<PartialSaveState>("idle");

  useEffect(() => {
    setHeadline(asLoc(section.headline));
    setLead(asLoc(section.lead));
    setSaveState("idle");
  }, [section]);

  function markDirty() {
    setSaveState((cur) => (cur === "saving" ? cur : "dirty"));
  }

  async function savePartial() {
    setSaveState("saving");
    setError(null);
    const res = await updateSection(workId, section.id, { headline, lead });
    if (!res.ok) {
      setError(res.error);
      setSaveState("dirty");
      return;
    }
    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 2000);
    await onReload();
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <PartialSaveBtn
          state={saveState}
          disabled={saveState !== "dirty"}
          onClick={() => void savePartial()}
        />
      </div>
      {error ? <p className="mb-2 text-[11px] text-rose-600">{error}</p> : null}
      <div className="secf">
        <div className="two">
          <Field
            label="섹션 제목"
            required
            guideAnchorId="text-length"
            counts={[
              { label: "국문", value: headline.ko.length, limit: 16 },
              { label: "영문", value: headline.en.length, limit: 16 }
            ]}
            tip={
              <>
                <b>16자 이내 · 짧을수록 좋습니다</b>
                <br />
                왼쪽 앵커 메뉴에 그대로 들어갑니다. 길면 메뉴에서 잘립니다. 섹션은 8개까지.
                9개째부터 메뉴가 화면에서 넘칩니다.
                <br />
                <span className="ex">
                  자주 쓰는 이름 — Overview · Creative · Space · Synopsis · Pre-Production ·
                  Production · On-site Test · Achievement · Credit
                </span>
              </>
            }
          >
            <Bi
              ko={headline.ko}
              en={headline.en}
              onKo={(v) => {
                const next = locField(headline, "ko", v);
                setHeadline(next);
                markDirty();
              }}
              onEn={(v) => {
                const next = locField(headline, "en", v);
                setHeadline(next);
                markDirty();
              }}
            />
          </Field>
          <Field
            label="기본 설명"
            counts={[
              { label: "국문", value: lead.ko.length, recommend: 60, limit: 120 },
              { label: "영문", value: lead.en.length, recommend: 120, limit: 240 }
            ]}
            tip={
              <>
                <b>국문 60~120자 · 2~3문장</b>
                <br />
                제목 바로 옆 고정 위치라 길이가 들쭉날쭉하면 블록마다 높이가 달라집니다. 이 섹션이
                무엇에 대한 것인지를 먼저 쓰세요.
                <br />
                <b>빈 줄을 넣으면 문단이 나뉩니다.</b>
              </>
            }
          >
            <Bi
              ko={lead.ko}
              en={lead.en}
              multiline
              koPlaceholder="이 섹션이 무엇에 대한 것인지"
              onKo={(v) => {
                const next = locField(lead, "ko", v);
                setLead(next);
                markDirty();
              }}
              onEn={(v) => {
                const next = locField(lead, "en", v);
                setLead(next);
                markDirty();
              }}
            />
          </Field>
        </div>
      </div>

      {isInterview ? (
        <InterviewEditor
          workId={workId}
          sectionId={section.id}
          interview={interview}
          siteUrl={siteUrl}
          onReload={onReload}
        />
      ) : null}

      <div className="blks">
        {blocks.map((block, i) => {
          const canMoveUp = !(sectionIndex === 0 && i === 0);
          const canMoveDown = !(sectionIndex === sections.length - 1 && i === blocks.length - 1);
          return (
            <BlockCard
              key={block.id}
              block={block}
              index={i + 1}
              total={blocks.length}
              sectionId={section.id}
              workId={workId}
              uploadRoot={uploadRoot}
              siteUrl={siteUrl}
              collapsed={!openBlockIds.has(block.id)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              isFirstSection={sectionIndex === 0}
              metaTakenByOther={blocks.some((item) => item.id !== block.id && item.show_meta)}
              onToggle={() => onToggleBlock(block.id)}
              onMove={(dir) => onMoveBlock(i, dir)}
              onReload={onReload}
            />
          );
        })}
        {!isInterview ? (
          <button type="button" className="addb" onClick={onAddBlock}>
            ＋ 블록 추가
          </button>
        ) : null}
      </div>
    </>
  );
}
