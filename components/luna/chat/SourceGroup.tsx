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
    label: "Notion"
  },
  work: {
    dot: "#1D9E75",
    badgeBg: "#E6F5EF",
    badgeInk: "#0F6E56",
    label: "Work"
  },
  wiki: {
    dot: "#C97B3F",
    badgeBg: "#FBF0E6",
    badgeInk: "#9A4E12",
    label: "Wiki"
  },
  image: {
    dot: "#378ADD",
    badgeBg: "#E8F0FA",
    badgeInk: "#2563A8",
    label: "Image"
  }
} as const;

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

function NotionRow({ src }: { src: NotionSource }) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[#1c1d21]">{src.title}</div>
        {src.section ? (
          <div className="mt-0.5 text-[11px] text-[#9aa0a8]">{src.section}</div>
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
  onImageCellClick?: (index: number) => void;
  favoritePaths?: Set<string>;
}) {
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
      {showNotion && sources.notion.length > 0 ? (
        <section>
          <GroupHeader kind="notion" count={sources.notion.length} />
          {sources.notion.map((s) => (
            <NotionRow key={s.url || s.id || s.title} src={s} />
          ))}
        </section>
      ) : null}
      {showWork && sources.work.length > 0 ? (
        <section>
          <GroupHeader kind="work" count={sources.work.length} />
          {sources.work.map((c, i) => (
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
          {sources.wiki.map((s) => (
            <WikiRow key={`${s.slug}:${s.section_id}`} src={s} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
