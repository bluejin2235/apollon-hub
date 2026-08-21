"use client";

import { useMemo, useState } from "react";
import {
  buildSourcePacks,
  tierSourcePacks,
  type SourcePackItem
} from "@/lib/luna/source-pack";
import {
  formatNasFolderPath,
  type LunaNasDriveMode
} from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";

function SourceTags({ item }: { item: SourcePackItem }) {
  return (
    <div className="flex shrink-0 gap-1">
      {item.notion ? (
        <span className="rounded-md bg-[#EFEFED] px-[7px] py-0.5 text-[9px] font-bold text-[#37352F]">
          노션
        </span>
      ) : null}
      {item.files.length > 0 || item.folder ? (
        <span className="rounded-md bg-[#EDEFF2] px-[7px] py-0.5 text-[9px] font-bold text-[#5B6472]">
          워크
        </span>
      ) : null}
    </div>
  );
}

function WorkLinkRows({
  item,
  mode,
  onCopyToast
}: {
  item: SourcePackItem;
  mode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
}) {
  const folderPath = item.folder
    ? formatNasFolderPath(
        item.folder.drive,
        item.folder.rawPath,
        mode,
        false
      ).replace(/\\+$/, "")
    : null;
  const files = item.files.length > 0 ? item.files : [];

  if (files.length === 0 && !folderPath) return null;

  const rows =
    files.length > 0
      ? files.map((f) => ({
          path: folderPath || f.fullPath.replace(/\\[^\\]+$/, ""),
          name: f.name,
          copy: f.fullPath
        }))
      : folderPath
        ? [{ path: folderPath, name: null as string | null, copy: folderPath }]
        : [];

  return (
    <>
      {rows.map((row) => (
        <button
          key={`${row.path}-${row.name ?? "folder"}`}
          type="button"
          className="flex w-full cursor-pointer items-start gap-[9px] border-b border-[#eef0f3] px-[15px] py-[9px] text-left last:border-b-0 hover:bg-[#FBFAFF]"
          onClick={() => {
            void navigator.clipboard.writeText(row.copy).then(() => {
              onCopyToast?.("경로 복사됨");
            });
          }}
        >
          <span className="mt-0.5 shrink-0 rounded-md bg-[#EDEFF2] px-[7px] py-0.5 text-[9px] font-bold text-[#5B6472]">
            워크
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-mono text-[10px] text-[#9aa0a8]"
              title={row.path}
            >
              {row.path}
            </div>
            {row.name ? (
              <div className="mt-0.5 truncate text-[11.5px] text-[#1c1d21]">
                {row.name}
              </div>
            ) : null}
          </div>
          <span className="shrink-0 text-[11px] text-[#9aa0a8]">↗</span>
        </button>
      ))}
      {item.filesMore > 0 ? (
        <div className="px-[15px] py-2 text-[11px] text-[#9aa0a8]">
          외 {item.filesMore}개
        </div>
      ) : null}
    </>
  );
}

function RecommendedCard({
  item,
  mode,
  onCopyToast
}: {
  item: SourcePackItem;
  mode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
}) {
  return (
    <div className="mb-2 overflow-hidden rounded-xl border-[1.5px] border-[#0F6E56]">
      <div className="flex items-center gap-2 bg-[#E6F5EF] px-[15px] py-2.5">
        <span className="text-[10px] font-extrabold tracking-wide text-[#0F6E56]">
          추천 자료
        </span>
        <span className="flex-1" />
        <span className="text-[10px] text-[#0F6E56] opacity-70">
          {typeof item.displayScore === "number" && item.displayScore > 0
            ? item.displayScore.toFixed(2)
            : "—"}
        </span>
      </div>
      <div className="px-[15px] py-3.5">
        <div className="mb-1 text-[14.5px] font-bold leading-snug text-[#1c1d21]">
          {item.title}
        </div>
        <div className="mb-2 text-[11px] text-[#9aa0a8]">{item.subtitle}</div>
        {item.body ? (
          <div className="text-[12.5px] leading-[1.8] text-[#2a2c31]">
            {item.body}
          </div>
        ) : null}
        {item.onlySide === "nas" ? (
          <div className="mt-2 text-[11px] text-[#B0782B]">
            노션 기록 없음 — 파일만 확인됩니다
          </div>
        ) : null}
        {item.onlySide === "notion" ? (
          <div className="mt-2 text-[11px] text-[#B0782B]">
            Work서버 폴더 없음 — 아직 자료가 만들어지지 않았습니다
          </div>
        ) : null}
      </div>
      <div className="border-t border-[#eef0f3]">
        {item.notion ? (
          <a
            href={item.notion.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-[9px] border-b border-[#eef0f3] px-[15px] py-2 text-[11.5px] hover:bg-[#FBFAFF]"
          >
            <span className="shrink-0 rounded-md bg-[#EFEFED] px-[7px] py-0.5 text-[9px] font-bold text-[#37352F]">
              노션
            </span>
            <span className="min-w-0 flex-1 truncate">{item.notion.title}</span>
            <span className="text-[#9aa0a8]">↗</span>
          </a>
        ) : null}
        <WorkLinkRows item={item} mode={mode} onCopyToast={onCopyToast} />
      </div>
    </div>
  );
}

function MidCard({
  item
}: {
  item: SourcePackItem;
}) {
  const href = item.notion?.url;
  const inner = (
    <>
      <span className="text-[13px] opacity-60">
        {item.files.length || item.folder ? "📂" : "📄"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold leading-snug text-[#1c1d21]">
          {item.title}
        </div>
        <div className="mt-0.5 truncate text-[10.5px] text-[#9aa0a8]">
          {item.subtitle}
        </div>
      </div>
      <SourceTags item={item} />
    </>
  );
  const className =
    "mb-1.5 flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#e7e8ec] px-3.5 py-2.5 hover:border-[#D9D4EE] hover:bg-[#FBFAFF]";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    );
  }
  return <div className={className}>{inner}</div>;
}

function WeakFold({ items }: { items: SourcePackItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mt-2 overflow-hidden rounded-[10px] border border-[#e7e8ec]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 bg-[#FBFBFC] px-3.5 py-2.5 text-left text-[11.5px] text-[#6b6f76]"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>관련이 약한 자료</span>
        <span className="ml-auto text-[10.5px] text-[#9aa0a8]">
          {items.length}건
        </span>
      </button>
      {open ? (
        <div className="border-t border-[#eef0f3]">
          {items.map((item) => {
            const href = item.notion?.url;
            const row = (
              <>
                <SourceTags item={item} />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </>
            );
            const className =
              "flex items-center gap-2 border-b border-[#eef0f3] px-3.5 py-2 text-[11.5px] text-[#6b6f76] last:border-b-0 hover:bg-[#FBFAFF]";
            if (href) {
              return (
                <a
                  key={item.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {row}
                </a>
              );
            }
            return (
              <div key={item.id} className={className}>
                {row}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SourcePackList({
  notionSources,
  cards,
  nasDriveMode,
  onCopyToast,
  queryHint
}: {
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  nasDriveMode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
  /** 낮은 점수 안내문에 쓸 핵심어 (선택) */
  queryHint?: string | null;
}) {
  const tiers = useMemo(() => {
    const views = buildSourcePacks(notionSources, cards);
    return tierSourcePacks(views);
  }, [notionSources, cards]);

  if (
    !tiers.recommended &&
    tiers.mid.length === 0 &&
    tiers.weak.length === 0
  ) {
    return null;
  }

  const hintTerm = (queryHint || "").trim().slice(0, 24);

  return (
    <div>
      {tiers.lowConfidence ? (
        <p className="mb-3 text-[13.5px] leading-[1.85] text-[#2a2c31]">
          {hintTerm
            ? `「${hintTerm}」로는 확실한 자료를 못 찾았어요. 비슷한 것들을 모아봤는데 맞는지 봐주세요.`
            : "확실한 자료를 못 찾았어요. 비슷한 것들을 모아봤는데 맞는지 봐주세요."}
        </p>
      ) : null}
      {tiers.recommended ? (
        <RecommendedCard
          item={tiers.recommended}
          mode={nasDriveMode}
          onCopyToast={onCopyToast}
        />
      ) : null}
      {tiers.mid.map((item) => (
        <MidCard key={item.id} item={item} />
      ))}
      <WeakFold items={tiers.weak} />
    </div>
  );
}
