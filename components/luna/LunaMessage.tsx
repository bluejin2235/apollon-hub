"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { Copy, FileText, Image as ImageIcon, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import type { LunaAttachmentRef } from "@/components/luna/LunaInput";
import { LunaMarkdown } from "@/components/luna/LunaMarkdown";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import {
  WorkserverPathCard
} from "@/components/luna/WorkserverPathCard";
import { SupplyToast } from "@/components/supplies/toast";
import type { NotionSource } from "@/lib/luna/notion";
import { groupNasCardsByFolder, type LunaNasDriveMode } from "@/lib/luna/nas-path";
import type { LunaCard } from "@/lib/luna/tavily";
import {
  countSourceBadges,
  parseAssumeMarkers,
  type UsedPromptRef,
  type LunaClassificationMeta
} from "@/lib/luna/chat-response";
import { summarizeUsedPrompts } from "@/lib/luna/used-prompts";
import {
  clipFeedbackNote,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_REASON_IDS,
  FEEDBACK_REASON_LABELS,
  isFeedbackReason,
  type FeedbackReason
} from "@/lib/luna/feedback";
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

export type { LunaNasDriveMode } from "@/lib/luna/nas-path";

export type LunaConnectorRoutingMeta = {
  summary: string;
  nas: boolean;
  notion: boolean;
  web: boolean;
  reasonLabel: string;
};

export type LunaDetailMeta = {
  modelSteps?: LunaModelStep[] | null;
  steps?: LunaProgressStep[] | null;
  wsSearches?: unknown[] | null;
  connectorRouting?: LunaConnectorRoutingMeta | null;
};

type LunaMessageProps = {
  id: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  feedback?: "good" | "bad" | null;
  feedbackReason?: FeedbackReason | null;
  feedbackNote?: string | null;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode?: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  attachments?: LunaAttachmentRef[] | null;
  isThinking?: boolean;
  modelLabel?: string | null;
  durationMs?: number | null;
  modelSteps?: LunaModelStep[] | null;
  steps?: LunaProgressStep[] | null;
  searchRounds?: number | null;
  clarify?: LunaClarifyData | null;
  mode?: "analysis" | null;
  teams?: LunaAnalysisTeam[] | null;
  onClarifySelect?: (option: string) => void;
  /** 선택지는 입력창 위 패널로만 — 말풍선 버튼 숨김 */
  hideInlineClarifyOptions?: boolean;
  memoryCount?: number | null;
  correctionCandidateIds?: string[] | null;
  onCorrectionCancel?: (candidateId: string) => void;
  usedPrompts?: UsedPromptRef[] | null;
  classification?: LunaClassificationMeta | null;
  detailMeta?: LunaDetailMeta | null;
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


function CardRow({ card }: { card: LunaCard }) {
  const isLink = Boolean(card.url);
  const isTextIcon = card.type === "notion";
  const Icon = FileText;

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
        </p>
        {card.description ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
            {card.description}
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
  onCopyToast
}: {
  cards: LunaCard[];
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode?: LunaNasDriveMode;
  onCopyToast?: (message: string) => void;
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
            </div>
            {reason ? (
              <p
                className="text-[11px] text-gray-500"
                style={{ margin: "3px 0 5px" }}
              >
                {reason}
              </p>
            ) : null}
            {group.type === "nas" ? (
              <div className="mt-1 space-y-2">
                {groupNasCardsByFolder(group.items).map((pathGroup, index) => (
                  <WorkserverPathCard
                    key={`${pathGroup.drive}-${pathGroup.folderRawPath}-${index}`}
                    group={pathGroup}
                    mode={nasDriveMode}
                    onCopyToast={onCopyToast}
                  />
                ))}
              </div>
            ) : group.type === "web" ? (
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
  const { body, assumptions } = parseAssumeMarkers(content);
  return (
    <div className="mt-3 rounded-lg bg-[#EEEDFE] px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#3C3489]">
        <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        LUNA 종합 의견
      </div>
      {body ? (
        <SafeMarkdown
          content={body}
          compact
          className="text-[13px] leading-[1.65] text-[#26215C]"
        />
      ) : null}
      {assumptions.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {assumptions.map((a, i) => (
            <div
              key={`${i}-${a.slice(0, 24)}`}
              className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] leading-snug text-amber-950"
            >
              <span className="font-medium text-amber-800">가정 · </span>
              {a}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const LUNA_BUBBLE_CLASS =
  "rounded-[6px_18px_18px_18px] border border-[#E8E5F4] bg-[#F7F6FC] px-5 py-[18px] text-[14.5px] leading-[1.7] text-[#1c1d21] max-md:px-4 max-md:py-4 max-md:text-[13.5px] max-md:leading-[1.7]";

function LunaAvatar() {
  return (
    <div
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-[12px] font-bold text-[#EEEDFE] max-md:h-6 max-md:w-6 max-md:text-[10.5px]"
      aria-hidden
    >
      L
    </div>
  );
}

function InlineThinkingProgress({
  steps,
  content,
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  notionSources,
  cards
}: {
  steps: LunaProgressStep[];
  content: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
}) {
  const visible = steps.filter((s) => s.status !== "skip");
  const running = visible.find((s) => s.status === "running");
  const done = visible.filter((s) => s.status === "done");

  if (!running && done.length === 0 && !content.trim()) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#534AB7]" aria-hidden />
        <span className="text-[13px] text-[#6b6f76]">생각 중…</span>
      </div>
    );
  }

  return (
    <>
      {running ? (
        <div className="mb-2 flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#534AB7]" aria-hidden />
          <span className="text-[13px] text-[#6b6f76]">{running.label}</span>
        </div>
      ) : null}
      {done.length > 0 ? (
        <div className="mb-2 pl-3.5 text-[12.5px] leading-[1.9] text-[#9aa0a8]">
          {done.map((s) => (
            <div key={s.key}>{s.label} — 완료</div>
          ))}
        </div>
      ) : null}
      {content.trim() ? (
        <div className="text-[14.5px] leading-[1.75] max-md:text-[13.5px] max-md:leading-[1.7]">
          <LunaMarkdown
            content={content}
            className="text-[14.5px] max-md:text-[13.5px]"
            nasDriveMode={nasDriveMode}
            onNasDriveModeChange={onNasDriveModeChange}
            onCopyToast={onCopyToast}
            notionSources={notionSources}
            cards={cards}
            source="stream"
          />
          <span
            className="ml-0.5 inline-block h-[15px] w-[7px] animate-pulse bg-[#1c1d21] align-text-bottom"
            aria-hidden
          />
        </div>
      ) : null}
    </>
  );
}

function SourceBadgeRow({
  cards,
  notionSources,
  memoryCount
}: {
  cards: LunaCard[];
  notionSources: NotionSource[];
  memoryCount: number;
}) {
  const counts = countSourceBadges({ cards, notionSources, memoryCount });
  const items: { label: string; n: number }[] = [];
  if (counts.nas > 0) items.push({ label: "Work서버", n: counts.nas });
  if (counts.memory > 0) items.push({ label: "기억", n: counts.memory });
  if (counts.notion > 0) items.push({ label: "노션", n: counts.notion });
  if (counts.web > 0) items.push({ label: "웹", n: counts.web });
  if (items.length === 0) return null;
  return (
    <>
      {items.map((it) => (
        <span
          key={it.label}
          className="rounded-[10px] border border-[#e7e8ec] bg-[#f5f6f8] px-2 py-px text-[10.5px] text-[#6b6f76]"
        >
          {it.label} {it.n}건
        </span>
      ))}
    </>
  );
}

function AssistantTextBubble({
  content,
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  source = "complete",
  notionSources,
  cards
}: {
  content: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
  source?: string;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
}) {
  return (
    <LunaMarkdown
      content={content}
      className="text-[14.5px] max-md:text-[13.5px]"
      nasDriveMode={nasDriveMode}
      onNasDriveModeChange={onNasDriveModeChange}
      onCopyToast={onCopyToast}
      notionSources={notionSources}
      cards={cards}
      source={source}
    />
  );
}

function MarkdownText({
  content,
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  notionSources,
  cards
}: {
  content: string;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
  notionSources?: NotionSource[] | null;
  cards?: LunaCard[] | null;
}) {
  return (
    <LunaMarkdown
      content={content}
      className="text-sm leading-relaxed text-slate-900"
      nasDriveMode={nasDriveMode}
      onNasDriveModeChange={onNasDriveModeChange}
      onCopyToast={onCopyToast}
      notionSources={notionSources}
      cards={cards}
      source="analysis"
    />
  );
}

function AnalysisReport({
  content,
  teams,
  cards,
  sourceReasons,
  nasDriveMode,
  onNasDriveModeChange,
  onCopyToast,
  isThinking
}: {
  content: string;
  teams: LunaAnalysisTeam[];
  cards: LunaCard[];
  sourceReasons?: LunaSourceReasons | null;
  nasDriveMode: LunaNasDriveMode;
  onNasDriveModeChange?: (mode: LunaNasDriveMode) => void;
  onCopyToast?: (message: string) => void;
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
            <MarkdownText
              content={content}
              nasDriveMode={nasDriveMode}
              onNasDriveModeChange={onNasDriveModeChange}
              onCopyToast={onCopyToast}
              cards={cards}
            />
          ) : isThinking ? (
            <p className="text-[12px] text-[#BA7517]">통합 리포트 작성 중···</p>
          ) : (
            <p className="text-[12px] text-slate-500">리포트가 없습니다.</p>
          )
        ) : activeTeam?.content ? (
          <MarkdownText
            content={activeTeam.content}
            nasDriveMode={nasDriveMode}
            onNasDriveModeChange={onNasDriveModeChange}
            onCopyToast={onCopyToast}
            cards={cards}
          />
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
                onCopyToast={onCopyToast}
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

function DetailMetaFooter({
  modelLabel,
  durationMs,
  detailMeta
}: {
  modelLabel: string;
  durationMs: number | null;
  detailMeta?: LunaDetailMeta | null;
}) {
  const [open, setOpen] = useState(false);
  const modelSteps = detailMeta?.modelSteps ?? [];
  const steps = detailMeta?.steps ?? [];
  const wsSearches = detailMeta?.wsSearches ?? [];
  const connectorRouting = detailMeta?.connectorRouting ?? null;
  const hasDetail =
    modelSteps.length > 0 ||
    steps.length > 0 ||
    wsSearches.length > 0 ||
    Boolean(connectorRouting?.summary);

  return (
    <>
      <div className="mt-0.5 text-[10.5px] text-[#9aa0a8]">
        {modelLabel}
        {durationMs != null ? ` · ${formatDuration(durationMs)}` : ""}
        {hasDetail ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-[#534AB7] hover:underline"
            >
              자세히
            </button>
          </>
        ) : null}
      </div>
      {open && hasDetail ? (
        <div className="mt-1.5 rounded-lg border border-[#E3E0F5] bg-white px-[11px] py-[9px]">
          {connectorRouting?.summary ? (
            <div className="mb-2 space-y-0.5">
              <p className="text-[10px] font-medium text-[#6b6f76]">커넥터</p>
              <p className="text-[10.5px] text-[#6b6f76]">{connectorRouting.summary}</p>
            </div>
          ) : null}
          {steps.length > 0 ? (
            <div className="mb-2 space-y-1">
              <p className="text-[10px] font-medium text-[#6b6f76]">진행 단계</p>
              {steps
                .filter((s) => s.status !== "skip")
                .map((s) => (
                  <div key={s.key} className="text-[10.5px] text-[#6b6f76]">
                    {s.label}
                  </div>
                ))}
            </div>
          ) : null}
          {modelSteps.length > 0 ? (
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium text-[#6b6f76]">모델</p>
              {modelSteps.map((step, index) => (
                <div key={`${step.label}-${index}`} className="flex gap-2 text-[10.5px]">
                  <span className="w-[100px] shrink-0 text-[#6b6f76]">{step.label}</span>
                  <span className="min-w-0 font-mono text-[10px]">{step.model}</span>
                  {step.tier ? (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-[#9aa0a8]">
                      {step.tier}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {wsSearches.length > 0 ? (
            <div className="mt-2 space-y-0.5 border-t border-[#eef0f3] pt-2">
              <p className="text-[10px] font-medium text-[#6b6f76]">Work서버 검색</p>
              {wsSearches.map((row, i) => (
                <div key={i} className="text-[10.5px] text-[#6b6f76]">
                  {typeof row === "string"
                    ? row
                    : typeof row === "object" && row && "query" in row
                      ? String((row as { query?: unknown }).query ?? "")
                      : JSON.stringify(row)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function UsedPromptsFooter({
  usedPrompts,
  classification
}: {
  usedPrompts: UsedPromptRef[];
  classification?: LunaClassificationMeta | null;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeUsedPrompts(usedPrompts);
  const typeLabel =
    classification?.labels?.length
      ? classification.labels.join("+")
      : classification?.types?.length
        ? classification.types.join("+")
        : "";
  if (summary.length === 0 && usedPrompts.length === 0 && !typeLabel) return null;

  const desktopParts = summary.map((p) =>
    p.number ? `${p.number} ${p.title}` : p.title
  );
  const mobileParts = summary.map((p) => p.title);

  const byStep = new Map<string, UsedPromptRef[]>();
  for (const item of usedPrompts) {
    const step = item.step || "기타";
    const list = byStep.get(step) ?? [];
    list.push(item);
    byStep.set(step, list);
  }

  return (
    <div className="mt-1.5 text-[10.5px] leading-[1.6] text-[#9aa0a8] max-md:text-[10px]">
      {typeLabel ? <span>{typeLabel}</span> : null}
      {typeLabel && (summary.length > 0 || usedPrompts.length > 0) ? (
        <span> · </span>
      ) : null}
      {summary.length > 0 ? (
        <>
          <span>사용한 판단 · </span>
          <span className="max-md:hidden">{desktopParts.join(" · ")}</span>
          <span className="hidden max-md:inline">{mobileParts.join(" · ")}</span>
        </>
      ) : usedPrompts.length > 0 || typeLabel ? (
        typeLabel ? null : <span>사용한 판단 · 정체성</span>
      ) : (
        <span>사용한 판단 · 정체성</span>
      )}
      <button
        type="button"
        className="ml-1.5 underline-offset-2 hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "접기" : "자세히"}
      </button>
      {open ? (
        <div className="mt-1.5 space-y-1 rounded-md border border-[#ececec] bg-[#fafafa] px-2 py-1.5 text-[10.5px] text-[#6b7178]">
          {classification ? (
            <div>
              <div className="font-medium text-[#5c6168]">유형 판정</div>
              <ul className="mt-0.5 list-disc pl-4">
                <li>
                  유형: {typeLabel || "(없음)"}
                  {classification.types.length > 0
                    ? ` (${classification.types.join(", ")})`
                    : ""}
                </li>
                {classification.reason ? (
                  <li>근거: {classification.reason}</li>
                ) : null}
                <li>신뢰: {classification.confidence}</li>
                <li>
                  전환:{" "}
                  {classification.switched
                    ? classification.switch_reason || "있음"
                    : "없음"}
                </li>
              </ul>
            </div>
          ) : null}
          {Array.from(byStep.entries()).map(([step, items]) => (
            <div key={step}>
              <div className="font-medium text-[#5c6168]">{step}</div>
              <ul className="mt-0.5 list-disc pl-4">
                {items.map((item) => (
                  <li key={`${item.step}::${item.key}`}>
                    {item.number ? `${item.number} ` : ""}
                    {item.title}
                    <span className="ml-1 text-[#9aa0a8]">{item.key}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageActionsRow({
  content,
  cards,
  notionSources,
  memoryCount,
  canFeedback,
  feedback,
  busy,
  onCopy,
  onFeedback
}: {
  content: string;
  cards: LunaCard[];
  notionSources: NotionSource[];
  memoryCount: number;
  canFeedback: boolean;
  feedback: "good" | "bad" | null;
  busy: boolean;
  onCopy: () => void;
  onFeedback: (next: "good" | "bad") => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-[7px]">
      <SourceBadgeRow
        cards={cards}
        notionSources={notionSources}
        memoryCount={memoryCount}
      />
      {content ? (
        <button
          type="button"
          aria-label="복사"
          onClick={onCopy}
          className="ml-[3px] text-[#9aa0a8] hover:text-[#6b6f76]"
        >
          <Copy className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </button>
      ) : null}
      {canFeedback ? (
        <>
          <button
            type="button"
            aria-label="좋아요"
            aria-pressed={feedback === "good"}
            disabled={busy}
            onClick={() => onFeedback("good")}
            className={`text-[15px] leading-none ${
              feedback === "good" ? "text-[#534AB7]" : "text-[#9aa0a8]"
            }`}
          >
            <ThumbsUp
              className="h-[15px] w-[15px]"
              strokeWidth={1.75}
              fill={feedback === "good" ? "currentColor" : "none"}
            />
          </button>
          <button
            type="button"
            aria-label="싫어요"
            aria-pressed={feedback === "bad"}
            disabled={busy}
            onClick={() => onFeedback("bad")}
            className={`text-[15px] leading-none ${
              feedback === "bad" ? "text-[#534AB7]" : "text-[#9aa0a8]"
            }`}
          >
            <ThumbsDown
              className="h-[15px] w-[15px]"
              strokeWidth={1.75}
              fill={feedback === "bad" ? "currentColor" : "none"}
            />
          </button>
        </>
      ) : null}
    </div>
  );
}

export function LunaMessage({
  id,
  role,
  content,
  engine,
  feedback: initialFeedback = null,
  feedbackReason: initialReason = null,
  feedbackNote: initialNote = null,
  notionSources = null,
  cards = null,
  sourceReasons = null,
  nasDriveMode = "office",
  onNasDriveModeChange,
  attachments = null,
  isThinking = false,
  modelLabel = null,
  durationMs = null,
  modelSteps = null,
  steps = null,
  clarify = null,
  mode = null,
  teams = null,
  onClarifySelect,
  hideInlineClarifyOptions = false,
  memoryCount = null,
  correctionCandidateIds = null,
  onCorrectionCancel,
  usedPrompts = null,
  classification = null,
  detailMeta = null
}: LunaMessageProps) {
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(initialFeedback);
  const [feedbackReason, setFeedbackReason] = useState<FeedbackReason | null>(
    initialReason
  );
  const [feedbackNote, setFeedbackNote] = useState<string | null>(
    clipFeedbackNote(initialNote)
  );
  const [noteDraft, setNoteDraft] = useState(
    () => clipFeedbackNote(initialNote) ?? ""
  );
  const [reasonPanelCollapsed, setReasonPanelCollapsed] = useState(
    () => Boolean(clipFeedbackNote(initialNote))
  );
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [dismissedChips, setDismissedChips] = useState<string[]>([]);
  const canFeedback =
    role === "assistant" && Boolean(id) && !id.startsWith("temp-") && !isThinking;
  const sources = useMemo(
    () => notionSources?.filter((s) => s.title && s.url) ?? [],
    [notionSources]
  );
  const cardList = useMemo(
    () => (cards ?? []).filter((c) => c.title),
    [cards]
  );
  const teamList = teams ?? [];
  const isAnalysis = mode === "analysis" || teamList.length > 0;
  const visibleCorrectionIds = (correctionCandidateIds ?? []).filter(
    (cid) => !dismissedChips.includes(cid)
  );

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(null), 2000);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  const handleCopyToast = (message: string) => setCopyToast(message);

  const mergedDetailMeta: LunaDetailMeta = {
    modelSteps: detailMeta?.modelSteps ?? modelSteps,
    steps: detailMeta?.steps ?? steps,
    wsSearches: detailMeta?.wsSearches ?? null,
    connectorRouting: detailMeta?.connectorRouting ?? null
  };

  function copyContent() {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(
      () => setCopied(true),
      () => {
        /* ignore */
      }
    );
  }

  async function cancelCorrection(candidateId: string) {
    setDismissedChips((prev) => [...prev, candidateId]);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/luna/candidates/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: candidateId, action: "reject" })
      });
      if (!res.ok) {
        console.error("[luna] cancel correction", await res.text());
      }
      onCorrectionCancel?.(candidateId);
    } catch (err) {
      console.error("[luna] cancel correction", err);
    }
  }

  // 같은 메시지에서 대화 리로드가 방금 저장한 로컬 평가를 덮어쓰지 않게, id 변경 시에만 동기화
  useEffect(() => {
    const note = clipFeedbackNote(initialNote);
    setFeedback(initialFeedback);
    setFeedbackReason(initialReason);
    setFeedbackNote(note);
    setNoteDraft(note ?? "");
    setReasonPanelCollapsed(Boolean(note));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- message identity only
  }, [id]);

  async function sendFeedback(
    next: "good" | "bad" | null,
    opts?: { reason?: FeedbackReason | null; note?: string; collapse?: boolean }
  ) {
    if (!canFeedback || busy) return;
    const prev = feedback;
    const prevReason = feedbackReason;
    const prevNote = feedbackNote;
    const prevDraft = noteDraft;
    const prevCollapsed = reasonPanelCollapsed;
    const reason = opts?.reason;
    const noteToSend =
      opts && Object.prototype.hasOwnProperty.call(opts, "note")
        ? clipFeedbackNote(opts.note)
        : undefined;
    setBusy(true);
    setFeedbackError(null);
    setFeedback(next);
    if (next !== "bad") {
      setFeedbackReason(null);
      setFeedbackNote(null);
      setNoteDraft("");
      setReasonPanelCollapsed(false);
    } else {
      if (reason) setFeedbackReason(reason);
      if (noteToSend !== undefined) setFeedbackNote(noteToSend);
    }
    try {
      let token = await getAccessToken();
      if (!token) {
        const refreshed = await supabase.auth.refreshSession();
        token = refreshed.data.session?.access_token ?? null;
      }
      if (!token) {
        setFeedback(prev);
        setFeedbackReason(prevReason);
        setFeedbackNote(prevNote);
        setNoteDraft(prevDraft);
        setReasonPanelCollapsed(prevCollapsed);
        setFeedbackError("로그인이 필요합니다. 다시 로그인한 뒤 눌러 주세요.");
        return;
      }
      const res = await fetch("/api/luna/messages", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message_id: id,
          feedback: next,
          ...(next === "bad" && reason ? { reason } : {}),
          ...(next === "bad" && noteToSend !== undefined ? { note: noteToSend ?? "" } : {})
        })
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[luna] feedback", text);
        setFeedback(prev);
        setFeedbackReason(prevReason);
        setFeedbackNote(prevNote);
        setNoteDraft(prevDraft);
        setReasonPanelCollapsed(prevCollapsed);
        setFeedbackError(
          res.status === 401
            ? "로그인이 만료되었습니다. 다시 로그인해 주세요."
            : "평가를 저장하지 못했습니다. 다시 눌러 주세요."
        );
        return;
      }
      const json = (await res.json()) as {
        feedback?: "good" | "bad" | null;
        reason?: unknown;
        note?: unknown;
      };
      setFeedback(json.feedback === "good" || json.feedback === "bad" ? json.feedback : null);
      setFeedbackReason(isFeedbackReason(json.reason) ? json.reason : null);
      const savedNote = clipFeedbackNote(json.note);
      setFeedbackNote(savedNote);
      if (noteToSend !== undefined) setNoteDraft(savedNote ?? "");
      if (opts?.collapse) setReasonPanelCollapsed(true);
    } catch (err) {
      console.error("[luna] feedback", err);
      setFeedback(prev);
      setFeedbackReason(prevReason);
      setFeedbackNote(prevNote);
      setNoteDraft(prevDraft);
      setReasonPanelCollapsed(prevCollapsed);
      setFeedbackError("네트워크 오류로 평가를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (role === "user") {
    const attachmentList = (attachments ?? []).filter((a) => a.file_name);
    return (
      <div className="mb-[22px] flex justify-end px-4 max-md:mb-3">
        <div className="max-w-[75%] max-md:max-w-[80%]">
          {attachmentList.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1">
              {attachmentList.map((att) => {
                const isPdf = att.mime_type === "application/pdf";
                const Icon = isPdf ? FileText : ImageIcon;
                return (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] text-white/90"
                  >
                    <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="max-w-[160px] truncate">{att.file_name}</span>
                  </span>
                );
              })}
            </div>
          ) : null}
          {content ? (
            <div className="whitespace-pre-wrap break-words rounded-[16px_16px_5px_16px] bg-[#534AB7] px-[15px] py-[11px] text-[14px] leading-[1.6] text-white max-md:px-[13px] max-md:py-[9px] max-md:text-[13.5px]">
              {content}
              {engine ? (
                <div className="mt-1.5 text-[10px] text-white/70">{engine}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const stepList = steps ?? [];

  let bubbleInner: ReactNode;
  if (clarify) {
    const q = clarify.question || content;
    bubbleInner = (
      <>
        {q ? (
          <LunaMarkdown
            content={q}
            nasDriveMode={nasDriveMode}
            onNasDriveModeChange={onNasDriveModeChange}
            onCopyToast={handleCopyToast}
            notionSources={sources}
            cards={cardList}
            source="clarify"
          />
        ) : null}
        {!hideInlineClarifyOptions ? (
          <>
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
          </>
        ) : null}
      </>
    );
  } else if (isAnalysis) {
    bubbleInner = (
      <AnalysisReport
        content={content}
        teams={teamList}
        cards={cardList}
        sourceReasons={sourceReasons}
        nasDriveMode={nasDriveMode}
        onNasDriveModeChange={onNasDriveModeChange}
        onCopyToast={handleCopyToast}
        isThinking={isThinking}
      />
    );
  } else if (isThinking) {
    bubbleInner = (
      <InlineThinkingProgress
        steps={stepList}
        content={content}
        nasDriveMode={nasDriveMode}
        onNasDriveModeChange={onNasDriveModeChange}
        onCopyToast={handleCopyToast}
        notionSources={sources}
        cards={cardList}
      />
    );
  } else if (content) {
    bubbleInner = (
      <AssistantTextBubble
        content={content}
        nasDriveMode={nasDriveMode}
        onNasDriveModeChange={onNasDriveModeChange}
        onCopyToast={handleCopyToast}
        source={id.startsWith("temp-") ? "complete-stream" : "complete-db"}
        notionSources={sources}
        cards={cardList}
      />
    );
  } else {
    bubbleInner = null;
  }

  const showBubble = bubbleInner != null;
  const wrapAnalysis = isAnalysis && !isThinking;

  return (
    <div className="group mb-[22px] flex items-start gap-2.5 px-4 max-md:mb-4">
      <LunaAvatar />
      <div className="min-w-0 flex-1">
        {showBubble ? (
          wrapAnalysis ? (
            bubbleInner
          ) : (
            <div className={LUNA_BUBBLE_CLASS}>{bubbleInner}</div>
          )
        ) : null}

        {!isThinking ? (
          <>
            <MessageActionsRow
              content={content}
              cards={cardList}
              notionSources={sources}
              memoryCount={memoryCount ?? 0}
              canFeedback={canFeedback}
              feedback={feedback}
              busy={busy}
              onCopy={copyContent}
              onFeedback={(next) => {
                if (feedback === next) void sendFeedback(null);
                else void sendFeedback(next);
              }}
            />
            {canFeedback && feedback === "bad" ? (
              reasonPanelCollapsed ? (
                <div className="mt-1.5 rounded-md bg-[#f3f4f6] px-2.5 py-1.5">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    {feedbackReason ? (
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#534AB7]">
                        {FEEDBACK_REASON_LABELS[feedbackReason]}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto text-[11px] text-[#6b6f76] underline-offset-2 hover:underline"
                      onClick={() => setReasonPanelCollapsed(false)}
                    >
                      다시 적기
                    </button>
                  </div>
                  {feedbackNote ? (
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.45] text-[#33363c]">
                      {feedbackNote}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-1.5">
                  <p className="mb-1 text-[10.5px] text-[#9aa0a8]">
                    무엇이 아쉬웠나요?
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {FEEDBACK_REASON_IDS.map((rid) => (
                      <button
                        key={rid}
                        type="button"
                        disabled={busy}
                        onClick={() => void sendFeedback("bad", { reason: rid })}
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          feedbackReason === rid
                            ? "bg-[#534AB7] text-white"
                            : "bg-[#f3f4f6] text-[#6b6f76]"
                        }`}
                      >
                        {FEEDBACK_REASON_LABELS[rid]}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={noteDraft}
                    maxLength={FEEDBACK_NOTE_MAX}
                    disabled={busy}
                    placeholder="직접 적어주세요 (선택)"
                    onChange={(e) => setNoteDraft(e.target.value.slice(0, FEEDBACK_NOTE_MAX))}
                    className="mt-1.5 w-full resize-none rounded-md border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px] leading-[1.45] text-[#33363c] outline-none placeholder:text-[#9aa0a8] focus:border-[#c4bff0]"
                    rows={2}
                  />
                  <div className="mt-1 flex items-center justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void sendFeedback("bad", {
                          reason: feedbackReason,
                          note: noteDraft,
                          collapse: true
                        })
                      }
                      className="rounded-md bg-[#534AB7] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
                    >
                      남기기
                    </button>
                  </div>
                </div>
              )
            ) : null}
            {feedbackError ? (
              <p className="mt-1 text-[11px] text-[#c23b3b]">{feedbackError}</p>
            ) : null}
          </>
        ) : null}

        {copied ? (
          <p className="mt-1 text-[10px] text-[#0F6E56]">복사했어요</p>
        ) : null}

        {visibleCorrectionIds.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {visibleCorrectionIds.map((cid) => (
              <div
                key={cid}
                className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-900"
              >
                <span>🌱 방금 정정을 배움 후보로 올렸어요</span>
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:underline"
                  onClick={() => void cancelCorrection(cid)}
                >
                  · 취소
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {!isThinking &&
        ((usedPrompts && usedPrompts.length > 0) || classification) ? (
          <UsedPromptsFooter
            usedPrompts={usedPrompts ?? []}
            classification={classification}
          />
        ) : null}

        {!isThinking && !clarify && modelLabel ? (
          <DetailMetaFooter
            modelLabel={modelLabel}
            durationMs={durationMs}
            detailMeta={mergedDetailMeta}
          />
        ) : null}
      </div>
      <SupplyToast message={copyToast} onClose={() => setCopyToast(null)} />
    </div>
  );
}
