"use client";

import { useMemo } from "react";
import {
  buildSourcePacks,
  type SourcePackItem,
  type SourcePackView
} from "@/lib/luna/source-pack";
import {
  formatNasFolderPath,
  type LunaNasDriveMode
} from "@/lib/luna/nas-path";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";

function LinkRow({
  kind,
  label,
  href,
  path,
  onCopy
}: {
  kind: "notion" | "file" | "folder";
  label: string;
  href?: string | null;
  path?: string | null;
  onCopy?: (message: string) => void;
}) {
  const lbClass =
    kind === "notion"
      ? "bg-[#EFEFED] text-[#37352F]"
      : "bg-[#E9F1F9] text-[#2E6FA8]";
  const kindLabel =
    kind === "notion" ? "노션" : kind === "file" ? "파일" : "폴더";
  const isPath = kind === "folder";

  const inner = (
    <>
      <span
        className={`shrink-0 rounded-[7px] px-[7px] py-0.5 text-[9.5px] font-bold ${lbClass}`}
      >
        {kindLabel}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${
          isPath
            ? "font-mono text-[10.5px] text-[#6b6f76]"
            : "text-[11.5px] text-[#1c1d21]"
        }`}
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] text-[#9aa0a8]">↗</span>
    </>
  );

  const className =
    "flex cursor-pointer items-center gap-[9px] border-b border-[#eef0f3] px-[15px] py-[9px] text-[11.5px] last:border-b-0 hover:bg-[#F7F6FC]";

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

  return (
    <button
      type="button"
      className={`${className} w-full text-left`}
      onClick={() => {
        if (!path) return;
        void navigator.clipboard.writeText(path).then(() => {
          onCopy?.("경로 복사됨");
        });
      }}
    >
      {inner}
    </button>
  );
}

function ItemPackCard({
  pack,
  mode,
  onCopyToast
}: {
  pack: SourcePackItem;
  mode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
}) {
  const folderCopyPath = pack.folder
    ? formatNasFolderPath(
        pack.folder.drive,
        pack.folder.rawPath,
        mode,
        false
      )
    : null;

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-[#e7e8ec] last:mb-0">
      <div className="flex items-start gap-2.5 border-b border-[#eef0f3] bg-[#FBFBFC] px-[15px] py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#EEEDFE] text-[13px]">
          📁
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold leading-snug text-[#1c1d21]">
            {pack.title}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-[#6b6f76]">
            {pack.subtitle}
          </div>
        </div>
        {pack.badge ? (
          <span className="shrink-0 whitespace-nowrap rounded-lg bg-[#f1f2f5] px-[7px] py-0.5 text-[9.5px] text-[#6b6f76]">
            {pack.badge}
          </span>
        ) : null}
      </div>

      {pack.body ? (
        <div className="px-[15px] py-3 text-[12.5px] leading-[1.8] text-[#2a2c31]">
          {pack.body}
        </div>
      ) : null}

      <div className="border-t border-[#eef0f3] bg-[#FCFCFD]">
        {pack.notion ? (
          <LinkRow
            kind="notion"
            label={pack.notion.title}
            href={pack.notion.url}
          />
        ) : null}
        {pack.files.map((f) => (
          <LinkRow
            key={f.fullPath}
            kind="file"
            label={f.name}
            path={f.fullPath}
            onCopy={onCopyToast}
          />
        ))}
        {pack.filesMore > 0 ? (
          <div className="px-[15px] py-2 text-[11px] text-[#9aa0a8]">
            외 {pack.filesMore}개
          </div>
        ) : null}
        {pack.folder && folderCopyPath ? (
          <LinkRow
            kind="folder"
            label={folderCopyPath.replace(/\\+$/, "")}
            path={folderCopyPath}
            onCopy={onCopyToast}
          />
        ) : null}
      </div>
    </div>
  );
}

function ProjectPackCard({
  view,
  mode,
  onCopyToast
}: {
  view: Extract<SourcePackView, { kind: "project" }>;
  mode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
}) {
  const folderCopyPath = view.folder
    ? formatNasFolderPath(
        view.folder.drive,
        view.folder.rawPath,
        mode,
        false
      )
    : null;

  return (
    <div className="mb-2.5 overflow-hidden rounded-xl border border-[#e7e8ec] last:mb-0">
      <div className="flex items-start gap-2.5 border-b border-[#eef0f3] bg-[#FBFBFC] px-[15px] py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#EEEDFE] text-[13px]">
          📂
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold leading-snug text-[#1c1d21]">
            {view.title}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-[#6b6f76]">
            {view.subtitle}
          </div>
        </div>
        {view.badge ? (
          <span className="shrink-0 whitespace-nowrap rounded-lg bg-[#f1f2f5] px-[7px] py-0.5 text-[9.5px] text-[#6b6f76]">
            {view.badge}
          </span>
        ) : null}
      </div>

      <div className="border-t border-[#eef0f3] bg-[#FCFCFD]">
        {view.notion ? (
          <LinkRow
            kind="notion"
            label="프로젝트 페이지 열기"
            href={view.notion.url}
          />
        ) : null}
        {view.folder && folderCopyPath ? (
          <LinkRow
            kind="folder"
            label={folderCopyPath.replace(/\\+$/, "")}
            path={folderCopyPath}
            onCopy={onCopyToast}
          />
        ) : null}
      </div>

      <div className="border-t border-[#eef0f3]">
        <div className="bg-[#FBFBFC] px-[15px] py-2 text-[10.5px] text-[#9aa0a8]">
          자료 {view.children.length}건
        </div>
        {view.children.map((child, i) => {
          const st = [
            child.notion ? "노션" : null,
            child.files.length > 0 ? "파일" : null
          ]
            .filter(Boolean)
            .join(" · ");
          const href = child.notion?.url;
          const rowClass =
            "flex w-full items-center gap-[9px] border-t border-[#eef0f3] py-2 pl-[26px] pr-[15px] text-left text-[11.5px] hover:bg-[#F7F6FC]";
          const inner = (
            <>
              <span className="w-4 text-[10px] text-[#9aa0a8]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[#1c1d21]">
                {child.title}
              </span>
              {st ? (
                <span className="shrink-0 rounded-[7px] bg-[#f1f2f5] px-1.5 py-px text-[9.5px] text-[#9aa0a8]">
                  {st}
                </span>
              ) : null}
              <span className="shrink-0 text-[11px] text-[#9aa0a8]">↗</span>
            </>
          );
          if (href) {
            return (
              <a
                key={child.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={rowClass}
              >
                {inner}
              </a>
            );
          }
          return (
            <div key={child.id} className={rowClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourcePackList({
  notionSources,
  cards,
  nasDriveMode,
  onCopyToast
}: {
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  nasDriveMode: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
}) {
  const views = useMemo(
    () => buildSourcePacks(notionSources, cards),
    [notionSources, cards]
  );
  if (views.length === 0) return null;

  return (
    <div className="space-y-0">
      {views.map((v) =>
        v.kind === "project" ? (
          <ProjectPackCard
            key={v.id}
            view={v}
            mode={nasDriveMode}
            onCopyToast={onCopyToast}
          />
        ) : (
          <ItemPackCard
            key={v.id}
            pack={v}
            mode={nasDriveMode}
            onCopyToast={onCopyToast}
          />
        )
      )}
    </div>
  );
}
