"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import { FileText, Folder, Image as ImageIcon, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { LunaAttachmentRef } from "@/components/luna/LunaInput";
import { SupplyToast } from "@/components/supplies/toast";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import { supabase } from "@/lib/supabase/client";

export type LunaModelStep = {
  label: string;
  model: string;
  tier: string;
};

export type LunaProgressStep = {
  key: string;
  label: string;
  status: "running" | "done" | "skip";
};

export type LunaClarifyData = {
  question: string;
  options: string[];
};

export type LunaAnalysisTeam = {
  id: string;
  title: string;
  content: string;
  kind?: "perspective" | "role";
};

export type LunaSourceReasons = {
  notion?: string;
  nas?: string;
  web?: string;
};

export type LunaNasDriveMode = "office" | "raidrive";

type LunaMessageProps = {
  id: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  feedback?: "good" | "bad" | null;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode?: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  attachments?: LunaAttachmentRef[] | null;
  isThinking?: boolean;
  searchStatus?: string[];
  modelLabel?: string | null;
  durationMs?: number | null;
  modelSteps?: LunaModelStep[] | null;
  steps?: LunaProgressStep[] | null;
  searchRounds?: number | null;
  clarify?: LunaClarifyData | null;
  mode?: "analysis" | null;
  teams?: LunaAnalysisTeam[] | null;
  onClarifySelect?: (option: string) => void;
};

const CARD_SECTION_ORDER: LunaCard["type"][] = ["notion", "nas", "web", "youtube"];

const CARD_SECTION_META: Record<
  LunaCard["type"],
  { label: string; color: string }
> = {
  notion: { label: "노션", color: "#534AB7" },
  nas: { label: "Work서버", color: "#1D9E75" },
  web: { label: "웹", color: "#378ADD" },
  youtube: { label: "YouTube", color: "#E24B4A" }
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function faviconUrl(url: string): string | null {
  const host = domainOf(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
}

function MediaThumb({ card }: { card: LunaCard }) {
  const [failed, setFailed] = useState(false);
  const url = card.url ?? "";
  const domain = domainOf(url);
  const initial = (domain || card.title || "?").charAt(0).toUpperCase();
  const src = !failed && url ? card.thumbnail || faviconUrl(url) : null;

  if (!src) {
    return (
      <div className="flex h-9 w-[52px] shrink-0 items-center justify-center rounded bg-slate-200 text-xs font-semibold text-slate-500">
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-9 w-[52px] shrink-0 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function ThinkingDotsText() {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDots((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return <span className="break-all">{"생각 중" + ".".repeat(dots)}</span>;
}

function normalizeNasDriveLetter(drive?: string): string {
  return (drive ?? "").trim().replace(/:$/, "").toUpperCase();
}

function nasDrivePrefix(drive: string | undefined, mode: LunaNasDriveMode): string {
  const letter = normalizeNasDriveLetter(drive);
  if (mode === "raidrive") {
    if (letter === "P") return "Z:\\Partners\\";
    return "Z:\\Work\\";
  }
  if (letter === "P") return "P:\\";
  if (letter === "T") return "T:\\";
  return letter ? `${letter}:\\` : "";
}

function normalizeRawNasPath(rawPath: string): string {
  return rawPath.replace(/\//g, "\\").replace(/^\\+/, "").replace(/\\+$/, "");
}

/** 표시·복사 공통: 접두사 + 폴더 경로 + 끝 백슬래시 (파일명이면 제거) */
function formatNasFolderPath(
  drive: string | undefined,
  rawPath: string,
  mode: LunaNasDriveMode,
  isFile: boolean
): string {
  let path = normalizeRawNasPath(rawPath);
  if (!path) {
    const prefix = nasDrivePrefix(drive, mode);
    return prefix.endsWith("\\") ? prefix : prefix ? `${prefix}\\` : "";
  }
  if (isFile) {
    const idx = path.lastIndexOf("\\");
    path = idx >= 0 ? path.slice(0, idx) : "";
  }
  const prefix = nasDrivePrefix(drive, mode);
  if (!path) return prefix.endsWith("\\") ? prefix : prefix ? `${prefix}\\` : "";
  return `${prefix}${path}\\`;
}

function nasDescriptionRest(card: LunaCard): string {
  let desc = card.description ?? "";
  if (desc.startsWith("★ ")) desc = desc.slice(2);
  const raw = card.raw_path?.trim() || "";
  if (raw && desc.startsWith(raw)) {
    return desc.slice(raw.length).replace(/^ · /, "");
  }
  if (desc.includes(" · ")) {
    return desc.split(" · ").slice(1).join(" · ");
  }
  return "";
}

function NasPathDescription({
  card,
  nasDriveMode
}: {
  card: LunaCard;
  nasDriveMode: LunaNasDriveMode;
}) {
  const rawPath =
    card.raw_path?.trim() ||
    (() => {
      let desc = card.description ?? "";
      if (desc.startsWith("★ ")) desc = desc.slice(2);
      return desc.split(" · ")[0] || "";
    })();
  const rest = nasDescriptionRest(card);
  const isFile =
    card.is_file === true ||
    (card.is_file !== false &&
      /\.[a-z0-9]{1,8}$/i.test(rawPath.split(/[\\/]/).pop() || ""));
  const folderPath = rawPath
    ? formatNasFolderPath(card.drive, rawPath, nasDriveMode, isFile)
    : "";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!folderPath && !rest) return null;

  const copyPath = () => {
    if (!folderPath) return;
    void navigator.clipboard.writeText(folderPath).then(
      () => setCopied(true),
      () => {
        /* ignore */
      }
    );
  };

  const onCopyClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copyPath();
  };

  const onCopyKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    copyPath();
  };

  return (
    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 max-md:breakall">
      {copied ? (
        <span style={{ color: "#0F6E56" }}>경로가 복사되었어요</span>
      ) : folderPath ? (
        <span
          role="button"
          tabIndex={0}
          title="클릭하면 경로 복사"
          onClick={onCopyClick}
          onKeyDown={onCopyKeyDown}
          className="breakall cursor-pointer border-b border-transparent hover:border-dashed hover:border-gray-700 hover:text-gray-700"
        >
          {folderPath}
        </span>
      ) : null}
      {!copied && rest ? (
        <span>
          {folderPath ? " · " : ""}
          {rest}
        </span>
      ) : null}
    </p>
  );
}

function NasDriveModeToggles({
  mode,
  onChange
}: {
  mode: LunaNasDriveMode;
  onChange?: (mode: LunaNasDriveMode) => void;
}) {
  const btn = (value: LunaNasDriveMode, label: string) => {
    const selected = mode === value;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onChange?.(value);
        }}
        className="shrink-0 text-[10px]"
        style={{
          padding: "2px 7px",
          borderRadius: 10,
          backgroundColor: selected ? "#E1F5EE" : "transparent",
          border: selected ? "1px solid #0F6E56" : "1px solid #D3D1C7",
          color: selected ? "#04342C" : "#6B7280"
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {btn("office", "사무실")}
      {btn("raidrive", "RaiDrive")}
    </div>
  );
}

function CardRow({
  card,
  nasDriveMode
}: {
  card: LunaCard;
  nasDriveMode: LunaNasDriveMode;
}) {
  const isLink = Boolean(card.url);
  const isTextIcon = card.type === "notion" || card.type === "nas";
  const Icon = card.type === "nas" ? Folder : FileText;
  const isImportantNas =
    card.type === "nas" && (card.description ?? "").startsWith("★ ");
  const descriptionText = isImportantNas
    ? (card.description ?? "").slice(2)
    : card.description;

  const inner = (
    <>
      {isTextIcon ? (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" strokeWidth={1.75} aria-hidden />
      ) : (
        <MediaThumb card={card} />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium text-slate-900">
          <span className="truncate">{card.title}</span>
          {isImportantNas ? (
            <span
              className="shrink-0 rounded-[3px] px-[5px] py-px text-[9px] font-medium"
              style={{ backgroundColor: "#FAEEDA", color: "#412402" }}
            >
              주요
            </span>
          ) : null}
        </p>
        {card.type === "nas" ? (
          <NasPathDescription card={card} nasDriveMode={nasDriveMode} />
        ) : descriptionText ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
            {descriptionText}
          </p>
        ) : null}
      </div>
    </>
  );

  const className =
    "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-slate-100";

  if (isLink && card.url) {
    return (
      <a
        href={card.url}
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

function SourceSections({
  cards,
  sourceReasons = null,
  nasDriveMode = "office",
  onNasDriveModeChange
}: {
  cards: LunaCard[];
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode?: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<LunaCard["type"], LunaCard[]>();
    for (const card of cards) {
      const list = map.get(card.type) ?? [];
      list.push(card);
      map.set(card.type, list);
    }
    return CARD_SECTION_ORDER.map((type) => ({
      type,
      items: map.get(type) ?? []
    })).filter((g) => g.items.length > 0);
  }, [cards]);

  if (groups.length === 0) return null;

  return (
    <div className="mt-3 space-y-4">
      {groups.map((group) => {
        const meta = CARD_SECTION_META[group.type];
        const reasonKey =
          group.type === "notion" || group.type === "nas" || group.type === "web"
            ? group.type
            : null;
        const reason =
          reasonKey && sourceReasons
            ? sourceReasons[reasonKey]?.trim() || ""
            : "";
        return (
          <section key={group.type} className="mb-4 last:mb-0">
            <div className={`flex items-center gap-2 ${reason ? "" : "mb-1.5"}`}>
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color }}
                aria-hidden
              />
              <span className="text-[13px] font-medium text-slate-800 max-md:text-[14px]">
                {meta.label}
              </span>
              <span className="rounded-lg bg-slate-100 px-[7px] py-px text-[11px] text-slate-500">
                {group.items.length}
              </span>
              {group.type === "nas" ? (
                <div className="ml-auto flex min-w-0 items-center gap-1.5">
                  <span className="hidden truncate text-[10px] text-gray-400 min-[520px]:inline">
                    경로 클릭하면 복사
                  </span>
                  <NasDriveModeToggles
                    mode={nasDriveMode}
                    onChange={onNasDriveModeChange}
                  />
                </div>
              ) : null}
            </div>
            {reason ? (
              <p
                className="text-[11px] text-gray-500"
                style={{ margin: "3px 0 5px" }}
              >
                {reason}
              </p>
            ) : null}
            {group.type === "web" ? (
              <>
                <div className="hscroll mt-1 md:hidden">
                  {group.items.map((card, index) => {
                    const href = card.url || "#";
                    const thumb = card.thumbnail || (card.url ? faviconUrl(card.url) : "");
                    return (
                      <a
                        key={`m-web-${card.title}-${card.url ?? index}`}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-[132px] flex-col overflow-hidden rounded-[12px] border border-[#E4E2DA] bg-white"
                      >
                        <div className="h-[72px] w-full overflow-hidden bg-slate-100">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="line-clamp-2 px-2 py-1.5 text-[11.5px] leading-snug text-slate-800">
                          {card.title}
                        </p>
                      </a>
                    );
                  })}
                </div>
                <div className="hidden flex-col md:flex">
                  {group.items.map((card, index) => (
                    <CardRow
                      key={`${card.type}-${card.title}-${card.url ?? card.raw_path ?? index}`}
                      card={card}
                      nasDriveMode={nasDriveMode}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col">
                {group.items.map((card, index) => (
                  <CardRow
                    key={`${card.type}-${card.title}-${card.url ?? card.raw_path ?? index}`}
                    card={card}
                    nasDriveMode={nasDriveMode}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function OpinionBlock({ content }: { content: string }) {
  return (
    <div className="mt-3 rounded-lg bg-[#EEEDFE] px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#3C3489]">
        <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        LUNA 종합 의견
      </div>
      <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-[#26215C]">
        {content}
      </div>
    </div>
  );
}

function renderMarkdownLine(line: string, lineKey: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|(`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      nodes.push(line.slice(last, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${lineKey}-${tokenIndex++}`} className="font-semibold">
          {match[1]}
        </strong>
      );
    } else if (match[2]) {
      nodes.push(
        <code
          key={`${lineKey}-${tokenIndex++}`}
          className="rounded bg-slate-200/70 px-1 py-px text-[12px]"
        >
          {match[2].slice(1, -1)}
        </code>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

function MarkdownText({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
      {lines.map((line, lineIndex) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const level = heading[1].length;
          const cls =
            level === 1
              ? "text-[15px] font-semibold"
              : level === 2
                ? "text-[14px] font-semibold"
                : "text-[13px] font-semibold";
          return (
            <p key={lineIndex} className={`${cls} text-slate-900`}>
              {renderMarkdownLine(heading[2], lineIndex)}
            </p>
          );
        }
        return (
          <Fragment key={lineIndex}>
            {renderMarkdownLine(line, lineIndex)}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function AnalysisReport({
  content,
  teams,
  cards,
  sourceReasons,
  nasDriveMode,
  onNasDriveModeChange,
  isThinking
}: {
  content: string;
  teams: LunaAnalysisTeam[];
  cards: LunaCard[];
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  isThinking: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>("summary");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const activeTeam =
    activeTab === "summary"
      ? null
      : teams.find((t) => t.id === activeTab) ?? null;

  return (
    <div className="rounded-[12px_12px_12px_2px] bg-slate-100 px-3.5 py-2.5">
      <div className="mb-2.5 flex flex-wrap gap-0.5 border-b border-[#E4E2DA]">
        {teams.map((team) => {
          const selected = activeTab === team.id;
          const running = !team.content;
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => setActiveTab(team.id)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px]"
              style={{
                color: selected ? "#534AB7" : running ? "#BA7517" : "#6B6A64",
                borderBottom: selected ? "2px solid #534AB7" : "2px solid transparent",
                fontWeight: selected ? 600 : 400
              }}
            >
              {team.kind === "role" ? (
                <span
                  className="inline-block shrink-0 rounded-full"
                  style={{
                    width: 4,
                    height: 4,
                    backgroundColor: "#1268B3"
                  }}
                  aria-hidden
                />
              ) : null}
              {team.title}
              {running ? " ···" : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setActiveTab("summary")}
          className="px-2 py-1 text-[10.5px]"
          style={{
            color: activeTab === "summary" ? "#534AB7" : "#6B6A64",
            borderBottom:
              activeTab === "summary" ? "2px solid #534AB7" : "2px solid transparent",
            fontWeight: activeTab === "summary" ? 600 : 400
          }}
        >
          종합
          {isThinking && !content ? " ···" : ""}
        </button>
      </div>

      <div className="min-h-[2.5rem]">
        {activeTab === "summary" ? (
          content ? (
            <MarkdownText content={content} />
          ) : isThinking ? (
            <p className="text-[12px] text-[#BA7517]">통합 리포트 작성 중···</p>
          ) : (
            <p className="text-[12px] text-slate-500">리포트가 없습니다.</p>
          )
        ) : activeTeam?.content ? (
          <MarkdownText content={activeTeam.content} />
        ) : (
          <p className="text-[12px] text-[#BA7517]">분석 중···</p>
        )}
      </div>

      {activeTab === "summary" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setToast("준비 중")}
            className="rounded-md border border-[#D3D1C7] bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-[#534AB7]"
          >
            노션에 저장
          </button>
          <button
            type="button"
            onClick={() => setToast("준비 중")}
            className="rounded-md border border-[#D3D1C7] bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-[#534AB7]"
          >
            프로젝트에 붙이기
          </button>
        </div>
      ) : null}

      {activeTab === "summary" && cards.length > 0 ? (
        <div className="mt-3 border-t border-[#E4E2DA] pt-2">
          <button
            type="button"
            onClick={() => setSourcesOpen((v) => !v)}
            className="text-[11px] text-slate-600 hover:text-[#534AB7]"
          >
            참고한 자료 {cards.length}건
          </button>
          {sourcesOpen ? (
            <div className="mt-2">
              <SourceSections
                cards={cards}
                sourceReasons={sourceReasons}
                nasDriveMode={nasDriveMode}
                onNasDriveModeChange={onNasDriveModeChange}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function formatDuration(ms: number): string {
  const sec = ms / 1000;
  return `${sec.toFixed(1)}초`;
}

function ModelMetaFooter({
  modelLabel,
  durationMs,
  modelSteps
}: {
  modelLabel: string;
  durationMs: number | null;
  modelSteps: LunaModelStep[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div
        className="mb-2 ml-[25px] mt-1 flex items-center gap-[5px] text-[9px] text-[#6B6A64]"
      >
        <span className="rounded border border-solid border-[#E4E2DA] bg-[#F5F3EE] px-1.5 py-px font-mono text-[8.5px]">
          {modelLabel}
        </span>
        {durationMs != null ? (
          <>
            <span>·</span>
            <span>{formatDuration(durationMs)}</span>
          </>
        ) : null}
        {modelSteps.length > 0 ? (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="cursor-pointer text-[#534AB7]"
            >
              자세히
            </button>
          </>
        ) : null}
      </div>
      {open && modelSteps.length > 0 ? (
        <div className="mb-2 ml-[25px] rounded-lg border border-solid border-[#E4E2DA] bg-white px-[11px] py-[9px]">
          {modelSteps.map((step, index) => {
            const isLast = index === modelSteps.length - 1;
            return (
              <div
                key={`${step.label}-${index}`}
                className={`flex gap-2 text-[10.5px] ${
                  isLast
                    ? "mt-1 border-t border-solid border-[#E4E2DA] pt-1.5"
                    : "py-[3px]"
                }`}
              >
                <span className="w-[110px] shrink-0 text-[#6B6A64]">{step.label}</span>
                <span className="min-w-0 font-mono text-[10px] text-slate-800">{step.model}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-[#6B6A64]">
                  {step.tier}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ProgressStepsPanel({
  steps,
  searchRounds,
  collapsedDefault
}: {
  steps: LunaProgressStep[];
  searchRounds?: number | null;
  collapsedDefault: boolean;
}) {
  const visible = steps.filter((s) => s.status !== "skip");
  const [expanded, setExpanded] = useState(!collapsedDefault);
  // 완료·스트리밍 공통: skip 제외 전체 단계 수 (running 포함)
  const stepCount = visible.length;
  const rounds = typeof searchRounds === "number" ? searchRounds : 0;
  const summary = `검색 ${rounds}회 · ${stepCount}단계`;

  if (visible.length === 0) return null;

  if (!expanded && collapsedDefault) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-2 rounded-lg border border-solid border-[#E4E2DA] bg-[#F5F3EE] px-[9px] py-[7px] text-left text-[10.5px] text-gray-600"
      >
        {summary}
      </button>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-solid border-[#E4E2DA] bg-[#F5F3EE] px-[9px] py-[7px]">
      {collapsedDefault ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mb-1.5 block text-[10.5px] text-gray-500"
        >
          {summary} ⌃
        </button>
      ) : null}
      <div className="space-y-1">
        {visible.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[10.5px] text-gray-600">
            <span
              className={`inline-block h-[5px] w-[5px] shrink-0 rounded-full ${
                s.status === "done"
                  ? "bg-[#0F6E56]"
                  : "animate-pulse bg-[#BA7517]"
              }`}
              aria-hidden
            />
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LunaMessage({
  id,
  role,
  content,
  engine,
  feedback: initialFeedback = null,
  notionSources = null,
  cards = null,
  sourceReasons = null,
  nasDriveMode = "office",
  onNasDriveModeChange,
  attachments = null,
  isThinking = false,
  searchStatus = [],
  modelLabel = null,
  durationMs = null,
  modelSteps = null,
  steps = null,
  searchRounds = null,
  clarify = null,
  mode = null,
  teams = null,
  onClarifySelect
}: LunaMessageProps) {
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(initialFeedback);
  const [busy, setBusy] = useState(false);
  const canFeedback =
    role === "assistant" && Boolean(id) && !id.startsWith("temp-") && !isThinking;
  const sources = notionSources?.filter((s) => s.title && s.url) ?? [];
  const cardList = (cards ?? []).filter((c) => c.title);
  const hasCards = cardList.length > 0;
  const teamList = teams ?? [];
  const isAnalysis = mode === "analysis" || teamList.length > 0;

  async function sendFeedback(next: "good" | "bad") {
    if (!canFeedback || busy) return;
    setBusy(true);
    setFeedback(next);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/luna/messages", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message_id: id, feedback: next })
      });
      if (!res.ok) {
        console.error("[luna] feedback", await res.text());
        setFeedback(initialFeedback);
      }
    } catch (err) {
      console.error("[luna] feedback", err);
      setFeedback(initialFeedback);
    } finally {
      setBusy(false);
    }
  }

  if (role === "user") {
    const attachmentList = (attachments ?? []).filter((a) => a.file_name);
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div className="max-w-[82%] md:max-w-[85%]">
          {attachmentList.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1">
              {attachmentList.map((att) => {
                const isPdf = att.mime_type === "application/pdf";
                const Icon = isPdf ? FileText : ImageIcon;
                return (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                  >
                    <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="max-w-[160px] truncate">{att.file_name}</span>
                  </span>
                );
              })}
            </div>
          ) : null}
          {content ? (
            <div className="whitespace-pre-wrap break-words rounded-[14px_14px_4px_14px] bg-[#EEEDFE] px-[13px] py-[11px] text-[13.5px] leading-[1.65] text-slate-900 md:rounded-[12px_12px_2px_12px] md:px-3.5 md:py-2.5 md:text-sm md:leading-relaxed">
              {content}
              {engine ? (
                <div className="mt-1.5 text-[10px] text-gray-500 opacity-70">{engine}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const stepList = steps ?? [];
  const hasSteps = stepList.some((s) => s.status !== "skip");
  const hasAnswerBody = Boolean(content) || hasCards || isAnalysis;

  let body: ReactNode;
  if (clarify) {
    body = (
      <div className="rounded-[14px_14px_14px_4px] bg-slate-100 px-[13px] py-[11px] text-[13.5px] leading-[1.65] text-slate-900 md:rounded-[12px_12px_12px_2px] md:px-3.5 md:py-2.5 md:text-sm md:leading-relaxed">
        <p className="whitespace-pre-wrap break-words">{clarify.question || content}</p>
        <div className="mt-2.5">
          {clarify.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={busy || !onClarifySelect}
              onClick={() => onClarifySelect?.(opt)}
              className="mb-1 block w-full rounded-lg border border-solid border-[#D3D1C7] px-[9px] py-[5px] text-left text-[11px] text-slate-800 transition hover:border-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-gray-500">직접 입력해도 됩니다</p>
      </div>
    );
  } else if (isAnalysis) {
    body = (
      <AnalysisReport
        content={content}
        teams={teamList}
        cards={cardList}
        sourceReasons={sourceReasons}
        nasDriveMode={nasDriveMode}
        onNasDriveModeChange={onNasDriveModeChange}
        isThinking={isThinking}
      />
    );
  } else if (isThinking) {
    body = hasSteps ? null : (
      <div className="rounded-[14px_14px_14px_4px] bg-slate-100 px-[13px] py-[11px] text-[13.5px] leading-[1.65] text-slate-900 md:rounded-[12px_12px_12px_2px] md:px-3.5 md:py-2.5 md:text-sm md:leading-relaxed">
        <ThinkingDotsText />
      </div>
    );
  } else if (hasCards) {
    body = (
      <>
        <SourceSections
          cards={cardList}
          sourceReasons={sourceReasons}
          nasDriveMode={nasDriveMode}
          onNasDriveModeChange={onNasDriveModeChange}
        />
        {content ? <OpinionBlock content={content} /> : null}
      </>
    );
  } else if (content) {
    body = (
      <div className="whitespace-pre-wrap break-words rounded-[14px_14px_14px_4px] bg-slate-100 px-[13px] py-[11px] text-[13.5px] leading-[1.65] text-slate-900 md:rounded-[12px_12px_12px_2px] md:px-3.5 md:py-2.5 md:text-sm md:leading-relaxed">
        {content}
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div className="group flex items-start gap-2.5 px-4 py-1.5">
      <img
        src="/luna/luna-face.png"
        alt="LUNA"
        width={22}
        height={22}
        draggable={false}
        className="mt-0.5"
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          display: "block"
        }}
      />
      <div className="min-w-0 max-w-[82%] flex-1 md:max-w-[85%]">
        {hasSteps ? (
          <ProgressStepsPanel
            steps={stepList}
            searchRounds={searchRounds}
            collapsedDefault={!isThinking && hasAnswerBody}
          />
        ) : null}
        {isThinking && !hasSteps && searchStatus.length > 0 ? (
          <div className="mb-1.5 space-y-0.5">
            {searchStatus.map((label) => (
              <p key={label} className="animate-pulse text-[11px] text-gray-500">
                {label}
              </p>
            ))}
          </div>
        ) : null}
        {body}
        {!isThinking && !clarify && modelLabel ? (
          <ModelMetaFooter
            modelLabel={modelLabel}
            durationMs={durationMs}
            modelSteps={modelSteps ?? []}
          />
        ) : null}
        {!isThinking && !hasCards && sources.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {sources.map((s) => (
              <a
                key={`${s.url}-${s.title}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-slate-600 underline-offset-2 hover:text-[#534AB7] hover:underline"
              >
                📄 {s.title}
              </a>
            ))}
          </div>
        ) : null}
        {canFeedback && !clarify ? (
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="좋아요"
              disabled={busy}
              onClick={() => void sendFeedback("good")}
              className={`rounded p-0.5 hover:bg-slate-200 ${
                feedback === "good" ? "text-[#534AB7] opacity-100" : "text-gray-500"
              }`}
            >
              <ThumbsUp className="h-3 w-3" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="싫어요"
              disabled={busy}
              onClick={() => void sendFeedback("bad")}
              className={`rounded p-0.5 hover:bg-slate-200 ${
                feedback === "bad" ? "text-[#534AB7] opacity-100" : "text-gray-500"
              }`}
            >
              <ThumbsDown className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
