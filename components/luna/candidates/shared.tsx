"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  KnowledgeShell,
  LoadingLine,
  Meta
} from "@/components/luna/knowledge/ui";
import {
  candidateMetaLine,
  dialogueTurnLabel,
  getCandidateCardKind,
  glossaryCardTitle,
  parseGlossaryMeta,
  scopeBadgeLabel,
  selfstudyQuestion,
  type GlossaryEditDraft
} from "@/lib/luna/candidate-format";
import { clipText, K, sourceLabel } from "@/lib/luna/knowledge-format";
import type { CandidateSource } from "@/lib/luna/candidates";
import type { ThreadTurn } from "@/lib/luna/candidates";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

export type CandidateRow = {
  id: string;
  content: string;
  category: string;
  source: CandidateSource;
  evidence: string | null;
  scope_suggestion: string | null;
  thread: ThreadTurn[];
  author_name: string | null;
  assigned_to: string | null;
  source_conversation_id: string | null;
  source_id: string | null;
  source_title: string | null;
  created_at: string | null;
  meta: Record<string, unknown> | null;
  is_glossary: boolean;
  is_my_turn: boolean;
};

export async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function SourceBadge({
  source,
  glossary,
  myTurn,
  sourceId,
  sourceTitle
}: {
  source: CandidateSource;
  glossary?: boolean;
  myTurn?: boolean;
  sourceId?: string | null;
  sourceTitle?: string | null;
}) {
  const router = useRouter();
  const titleBit =
    source === "interview" && sourceTitle
      ? ` · ${clipText(sourceTitle, 28)}`
      : "";

  function goToSource(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!sourceId) return;
    router.push(
      buildLunaSettingsUrl("talk", "sources", { source: sourceId })
    );
  }

  if (glossary) {
    const src = sourceLabel(source);
    const label = `용어 · ${src !== "—" ? src : "대화에서"}${titleBit}`;
    if (source === "interview" && sourceId) {
      return (
        <button
          type="button"
          onClick={goToSource}
          className="cursor-pointer text-left"
          title="구술·문서에서 보기"
        >
          <Badge kind="org">{label}</Badge>
        </button>
      );
    }
    return <Badge kind="org">{label}</Badge>;
  }
  if (myTurn && source === "question") {
    return <Badge kind="warn">루나의 질문 · 내 차례</Badge>;
  }
  if (source === "chat") return <Badge kind="me">대화에서</Badge>;
  if (source === "selfstudy") return <Badge kind="org">자습에서</Badge>;
  if (source === "question") return <Badge kind="warn">루나의 질문</Badge>;
  if (source === "interview") {
    const label = `구술·문서${titleBit}`;
    if (sourceId) {
      return (
        <button
          type="button"
          onClick={goToSource}
          className="cursor-pointer text-left"
          title="구술·문서에서 보기"
        >
          <Badge kind="org">{label}</Badge>
        </button>
      );
    }
    return <Badge kind="org">{label}</Badge>;
  }
  return <Badge kind="src">알려주기</Badge>;
}

export function ScopeBadge({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <Badge kind="src" className="ml-auto">
      {label}
    </Badge>
  );
}

export function FilterChip({
  on,
  children,
  onClick
}: {
  on: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[20px] border px-[13px] py-[5px] text-[12px]"
      style={{
        background: on ? K.luna : K.panel,
        color: on ? "#fff" : K.sub,
        borderColor: on ? K.luna : K.line,
        fontWeight: on ? 700 : 400
      }}
    >
      {children}
    </button>
  );
}

export function CandidateCardShell({
  highlight,
  children
}: {
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className="mb-2.5 rounded-[12px] px-4 py-3.5"
      style={{
        background: K.panel,
        border: highlight ? "2px solid #d9cdf7" : `1px solid ${K.line}`
      }}
    >
      {children}
    </article>
  );
}

export function ThreadBlock({ thread }: { thread: ThreadTurn[] }) {
  return (
    <div
      className="my-2.5 border-l-2 pl-2.5"
      style={{ borderColor: K.line }}
    >
      {thread.map((t, i) => (
        <p
          key={`${t.at}-${i}`}
          className="mb-1.5 text-[13px] leading-relaxed"
          style={{ color: t.role === "human" ? K.ink : K.sub }}
        >
          {t.role === "human" ? "나: " : "루나: "}
          {t.text}
        </p>
      ))}
    </div>
  );
}

export function ReplyRow({
  value,
  onChange,
  onSend,
  busy,
  placeholder = "답을 입력하면 루나가 이해를 다듬어 다시 확인해요"
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="mt-2.5 flex gap-2">
      <FieldInput
        className="flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <Btn primary disabled={busy || !value.trim()} onClick={onSend}>
        보내기
      </Btn>
    </div>
  );
}

export function GlossaryCardBody({
  meta,
  content,
  evidence
}: {
  meta: Record<string, unknown> | null;
  content: string;
  evidence: string | null;
}) {
  const draft = parseGlossaryMeta(meta, content);
  const { title, missingTerm } = glossaryCardTitle(draft);
  const displayKo = missingTerm ? "—" : draft.term_ko;
  const displayDef =
    missingTerm && draft.term_ko.trim()
      ? draft.definition.trim() || draft.term_ko
      : draft.definition;

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <div className="text-[17px] font-extrabold">{title}</div>
        {missingTerm ? (
          <span
            className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
            style={{ background: K.candSoft, color: K.candInk }}
          >
            용어명 없음
          </span>
        ) : null}
      </div>
      <div className="my-2.5 grid grid-cols-1 gap-2 min-[901px]:grid-cols-3">
        {[
          ["한국어", displayKo, null as string | null],
          ["English", draft.term_en, null],
          ["中文", draft.term_zh, draft.term_zh_pron]
        ].map(([label, val, pron]) => (
          <div
            key={String(label)}
            className="rounded-[9px] border px-2.5 py-2"
            style={{ borderColor: K.line }}
          >
            <div
              className="text-[10px] font-semibold uppercase"
              style={{ color: K.faint }}
            >
              {label}
            </div>
            <div
              className={`mt-0.5 text-[13px] ${
                label === "中文" && val ? "font-bold" : val && val !== "—" ? "font-bold" : ""
              }`}
              style={{ color: val && val !== "—" ? K.ink : K.faint }}
            >
              {val || "—"}
              {pron ? (
                <small
                  className="ml-1.5 text-[11px] font-normal"
                  style={{ color: K.sub }}
                >
                  {pron}
                </small>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div
        className="rounded-[9px] border px-3 py-2.5"
        style={{ borderColor: K.line }}
      >
        <div
          className="mb-1 text-[10px] font-semibold uppercase"
          style={{ color: K.faint }}
        >
          정의 초안
        </div>
        <p className="text-[13px] leading-[1.7]">{displayDef || "—"}</p>
      </div>
      {evidence ? (
        <div className="mt-2 text-[12px]" style={{ color: K.sub }}>
          근거: {evidence.replace(/^근거:\s*/, "")}
        </div>
      ) : null}
    </>
  );
}

export function GlossaryEditForm({
  draft,
  onChange,
  evidence
}: {
  draft: GlossaryEditDraft;
  onChange: (next: GlossaryEditDraft) => void;
  evidence: string | null;
}) {
  const fieldLabel = "mb-1 text-[10px] font-semibold";
  const labelColor = { color: K.faint };
  const termMissing = !draft.term_ko.trim();
  const termBorder = termMissing ? "#D85A30" : K.line;
  const showTitleBanner = termMissing && draft.movedFromTitle;

  return (
    <div className="mt-3">
      {showTitleBanner ? (
        <div
          className="mb-2.5 rounded-[9px] px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "#FAECE7", color: "#993C1D" }}
        >
          정의 문장이 용어명 자리에 들어와 있어요. 용어명을 채워 주세요.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 min-[901px]:grid-cols-4">
        <div>
          <div className={fieldLabel} style={labelColor}>
            한국어
          </div>
          <input
            className="w-full rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
            style={{
              borderColor: termBorder,
              background: K.panel,
              color: K.ink
            }}
            value={draft.term_ko}
            onChange={(e) => onChange({ ...draft, term_ko: e.target.value })}
            placeholder="용어명"
          />
        </div>
        <div>
          <div className={fieldLabel} style={labelColor}>
            ENGLISH
          </div>
          <FieldInput
            className="w-full"
            value={draft.term_en ?? ""}
            onChange={(e) =>
              onChange({ ...draft, term_en: e.target.value || null })
            }
            placeholder="English"
          />
        </div>
        <div>
          <div className={fieldLabel} style={labelColor}>
            中文
          </div>
          <FieldInput
            className="w-full font-bold"
            value={draft.term_zh ?? ""}
            onChange={(e) =>
              onChange({ ...draft, term_zh: e.target.value || null })
            }
            placeholder="中文"
          />
        </div>
        <div>
          <div className={fieldLabel} style={labelColor}>
            중문 발음
          </div>
          <FieldInput
            className="w-full"
            value={draft.term_zh_pron ?? ""}
            onChange={(e) =>
              onChange({ ...draft, term_zh_pron: e.target.value || null })
            }
            placeholder="발음"
          />
        </div>
      </div>

      <div className="mt-2.5">
        <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[10px] font-semibold" style={{ color: K.faint }}>
            정의
          </span>
          {draft.movedFromTitle ? (
            <span className="text-[11px]" style={{ color: K.candInk }}>
              · 원래 제목에 있던 문장을 옮겨 왔어요
            </span>
          ) : null}
        </div>
        <textarea
          className="w-full resize-y rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
          style={{
            borderColor: K.line,
            background: K.panel,
            color: K.ink,
            height: 70,
            lineHeight: 1.7
          }}
          value={draft.definition}
          onChange={(e) => onChange({ ...draft, definition: e.target.value })}
          placeholder="정의"
        />
      </div>

      <div className="mt-2.5 max-w-[220px]">
        <div className={fieldLabel} style={labelColor}>
          분류
        </div>
        <FieldSelect
          className="w-full"
          value={draft.category}
          onChange={(e) =>
            onChange({
              ...draft,
              category: e.target.value as GlossaryEditDraft["category"]
            })
          }
        >
          <option value="common">공통</option>
          <option value="interior">인테리어</option>
          <option value="hw">하드웨어</option>
        </FieldSelect>
      </div>

      {evidence ? (
        <div className="mt-2.5 text-[12px]" style={{ color: K.sub }}>
          근거: {evidence.replace(/^근거:\s*/, "")}
        </div>
      ) : null}
    </div>
  );
}

export function useCandidateNav() {
  const router = useRouter();
  return (sub: "pending" | "mine" | "history", extra?: string) => {
    const q = extra ? `&${extra}` : "";
    router.push(`/settings?tab=luna&luna=candidates&sub=${sub}${q}`);
  };
}

export function ConversationLink({
  conversationId,
  children
}: {
  conversationId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  if (!conversationId) return <span>{children}</span>;
  return (
    <button
      type="button"
      className="cursor-pointer underline-offset-2 hover:underline"
      style={{ color: K.faint }}
      onClick={() =>
        router.push(`/settings?tab=luna&luna=talk&sub=history&conv=${conversationId}`)
      }
    >
      {children}
    </button>
  );
}

export function cardTitle(item: CandidateRow): string {
  const kind = getCandidateCardKind({
    source: item.source,
    category: item.category,
    meta: item.meta,
    threadLength: item.thread.length
  });
  if (kind === "selfstudy") return selfstudyQuestion(item.meta) ?? item.content;
  if (kind === "glossary") {
    return glossaryCardTitle(parseGlossaryMeta(item.meta, item.content)).title;
  }
  return item.content;
}

export { KnowledgeShell, LoadingLine, ErrorLine, Meta, dialogueTurnLabel, candidateMetaLine, scopeBadgeLabel, getCandidateCardKind };
