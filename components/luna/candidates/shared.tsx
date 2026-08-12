"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  LoadingLine,
  Meta
} from "@/components/luna/knowledge/ui";
import {
  candidateMetaLine,
  dialogueTurnLabel,
  getCandidateCardKind,
  parseGlossaryMeta,
  scopeBadgeLabel,
  selfstudyQuestion
} from "@/lib/luna/candidate-format";
import { K, sourceLabel } from "@/lib/luna/knowledge-format";
import type { CandidateSource } from "@/lib/luna/candidates";
import type { ThreadTurn } from "@/lib/luna/candidates";
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
  myTurn
}: {
  source: CandidateSource;
  glossary?: boolean;
  myTurn?: boolean;
}) {
  if (glossary) {
    const src = sourceLabel(source);
    return (
      <Badge kind="org">
        용어 · {src !== "—" ? src : "대화에서"}
      </Badge>
    );
  }
  if (myTurn && source === "question") {
    return <Badge kind="warn">루나의 질문 · 내 차례</Badge>;
  }
  if (source === "chat") return <Badge kind="me">대화에서</Badge>;
  if (source === "selfstudy") return <Badge kind="org">자습에서</Badge>;
  if (source === "question") return <Badge kind="warn">루나의 질문</Badge>;
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
  return (
    <>
      <div className="mt-2.5 text-[17px] font-extrabold">{draft.term_ko}</div>
      <div className="my-2.5 grid grid-cols-1 gap-2 min-[901px]:grid-cols-3">
        {[
          ["한국어", draft.term_ko, null],
          ["English", draft.term_en, null],
          ["中文", draft.term_zh, draft.term_zh_pron]
        ].map(([label, val, pron]) => (
          <div
            key={label}
            className="rounded-[9px] border px-2.5 py-2"
            style={{ borderColor: K.line }}
          >
            <div
              className="text-[10px] font-extrabold uppercase"
              style={{ color: K.faint }}
            >
              {label}
            </div>
            <div
              className={`mt-0.5 text-[13px] ${val ? "font-bold" : ""}`}
              style={{ color: val ? K.ink : K.faint }}
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
          className="mb-1 text-[10px] font-extrabold uppercase"
          style={{ color: K.faint }}
        >
          정의 초안
        </div>
        <p className="text-[13px] leading-relaxed">{draft.definition}</p>
      </div>
      {evidence ? (
        <div className="mt-2 text-[12px]" style={{ color: K.sub }}>
          근거: {evidence.replace(/^근거:\s*/, "")}
        </div>
      ) : null}
    </>
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
  if (kind === "glossary") return parseGlossaryMeta(item.meta, item.content).term_ko;
  return item.content;
}

export { KnowledgeShell, LoadingLine, ErrorLine, Meta, dialogueTurnLabel, candidateMetaLine, scopeBadgeLabel, getCandidateCardKind };
