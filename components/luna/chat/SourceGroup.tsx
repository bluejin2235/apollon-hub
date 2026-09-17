"use client";

import {
  formatNasFolderPath,
  type NasPathSettings
} from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import { LunaImageGrid } from "@/components/luna/LunaImageGrid";
import type { SplitSources } from "@/components/luna/chat/answer-layout";

const GROUP_STYLES = {
  notion: {
    dot: "#6b6f76",
    badgeBg: "#EFEFED",
    badgeInk: "#37352F",
    label: "노션"
  },
  work: {
    dot: "#1D9E75",
    badgeBg: "#E6F5EF",
    badgeInk: "#0F6E56",
    label: "Work서버"
  },
  wiki: {
    dot: "#C97B3F",
    badgeBg: "#FBF0E6",
    badgeInk: "#9A4E12",
    label: "위키"
  },
  image: {
    dot: "#378ADD",
    badgeBg: "#E8F0FA",
    badgeInk: "#2563A8",
    label: "이미지"
  }
} as const;

/** 답 버블에 기본으로 보이는 출처 행 수. 나머지는 「문서 탭 →」 */
export const SOURCE_PREVIEW_LIMIT = 4;

function GroupHeader({
  kind,
  count
}: {
  kind: keyof typeof GROUP_STYLES;
  count: number;
}) {
  const meta = GROUP_STYLES[kind];
  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: meta.dot }}
        aria-hidden
      />
      <span className="text-[13px] font-semibold text-[#1c1d21]">{meta.label}</span>
      <span className="rounded-md bg-[#f1f2f5] px-[7px] py-px text-[11px] text-[#6b6f76]">
        {count}
      </span>
    </div>
  );
}

function MaterialTag({
  label,
  bg,
  ink
}: {
  label: string;
  bg: string;
  ink: string;
}) {
  return (
    <span
      className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold"
      style={{ backgroundColor: bg, color: ink }}
    >
      {label}
    </span>
  );
}

function formatEditedDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function NotionRow({ src }: { src: NotionSource }) {
  const dbOrPath =
    (src.path_titles && src.path_titles.length > 0
      ? src.path_titles.slice(0, 2).join(" › ")
      : null) ||
    src.section ||
    null;
  const edited = formatEditedDate(src.last_edited_time);
  const metaBits = [dbOrPath, edited].filter(Boolean);
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[#1c1d21]">{src.title}</div>
        {metaBits.length > 0 ? (
          <div className="mt-0.5 text-[11px] text-[#9aa0a8]">
            {metaBits.join(" · ")}
          </div>
        ) : null}
      </div>
      <MaterialTag label="노션" bg="#EFEFED" ink="#37352F" />
    </>
  );
  const className =
    "mb-1.5 flex items-start gap-2.5 rounded-[10px] border border-[#e7e8ec] bg-white px-3 py-2.5 hover:bg-[#FBFAFF]";
  if (src.url) {
    return (
      <a href={src.url} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

function WorkRow({
  card,
  nasPathSettings
}: {
  card: LunaCard;
  nasPathSettings: NasPathSettings;
}) {
  const fullPath = card.raw_path
    ? formatNasFolderPath(card.drive, card.raw_path, nasPathSettings, false)
    : card.title;
  const href = card.url;
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[#1c1d21]">{card.title}</div>
        <div className="mt-1 whitespace-pre-wrap break-all font-mono text-[10.5px] leading-[1.55] text-[#6b6f76]">
          {fullPath}
        </div>
      </div>
      <MaterialTag label="워크" bg="#EDEFF2" ink="#5B6472" />
    </>
  );
  const className =
    "mb-1.5 flex items-start gap-2.5 rounded-[10px] border border-[#e7e8ec] bg-white px-3 py-2.5 hover:bg-[#F7FBF9]";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

function WikiRow({ src }: { src: WikiSourceRef }) {
  return (
    <a
      href={src.path}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1.5 flex items-start gap-2.5 rounded-[10px] border border-[#F0E4D8] bg-[#FFFBF7] px-3 py-2.5 hover:bg-[#FFF5EB]"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[#1c1d21]">
          {src.title}
          <span className="font-normal text-[#9aa0a8]"> · {src.section_title}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-[#9aa0a8]">{src.path}</div>
      </div>
      <MaterialTag label="위키" bg="#FBF0E6" ink="#9A4E12" />
    </a>
  );
}

export function WikiCompactCard({ src }: { src: WikiSourceRef }) {
  return <WikiRow src={src} />;
}

export function SourceGroupSections({
  sources,
  nasPathSettings,
  onCopyToast,
  showNotion,
  showWork,
  showWiki,
  showImage,
  imageLimit,
  previewLimit,
  emptyImageHint,
  onImageCellClick,
  favoritePaths
}: {
  sources: SplitSources;
  nasPathSettings: NasPathSettings;
  onCopyToast?: (msg: string) => void;
  showNotion: boolean;
  showWork: boolean;
  showWiki: boolean;
  showImage: boolean;
  imageLimit?: number;
  /** 지정 시 헤더는 전체 건수, 행만 잘라 보여 줌 */
  previewLimit?: number;
  /** 이미지 0건일 때 (사례 모드) */
  emptyImageHint?: string | null;
  onImageCellClick?: (index: number) => void;
  favoritePaths?: Set<string>;
}) {
  const lim = previewLimit;
  const notionRows =
    lim != null ? sources.notion.slice(0, lim) : sources.notion;
  const workRows = lim != null ? sources.work.slice(0, lim) : sources.work;
  const wikiRows = lim != null ? sources.wiki.slice(0, lim) : sources.wiki;

  return (
    <div className="mt-4 space-y-4">
      {showImage && sources.image.length > 0 ? (
        <section>
          <GroupHeader kind="image" count={sources.image.length} />
          <LunaImageGrid
            cards={sources.image}
            nasPathSettings={nasPathSettings}
            onCopyToast={onCopyToast}
            limit={imageLimit}
            favoritePaths={favoritePaths}
            onCellClick={onImageCellClick}
          />
        </section>
      ) : null}
      {showImage && sources.image.length === 0 && emptyImageHint ? (
        <p className="text-[11.5px] leading-relaxed text-[#9aa0a8]">
          {emptyImageHint}
        </p>
      ) : null}
      {showNotion && sources.notion.length > 0 ? (
        <section>
          <GroupHeader kind="notion" count={sources.notion.length} />
          {notionRows.map((s) => (
            <NotionRow key={s.url || s.id || s.title} src={s} />
          ))}
        </section>
      ) : null}
      {showWork && sources.work.length > 0 ? (
        <section>
          <GroupHeader kind="work" count={sources.work.length} />
          {workRows.map((c, i) => (
            <WorkRow
              key={`${c.title}-${c.raw_path ?? i}`}
              card={c}
              nasPathSettings={nasPathSettings}
            />
          ))}
        </section>
      ) : null}
      {showWiki && sources.wiki.length > 0 ? (
        <section>
          <GroupHeader kind="wiki" count={sources.wiki.length} />
          {wikiRows.map((s) => (
            <WikiRow key={`${s.slug}:${s.section_id}`} src={s} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
