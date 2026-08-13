"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CandidateCardShell,
  ConversationLink,
  ErrorLine,
  FilterChip,
  GlossaryCardBody,
  GlossaryEditForm,
  KnowledgeShell,
  LoadingLine,
  ReplyRow,
  ScopeBadge,
  SourceBadge,
  ThreadBlock,
  getAccessToken,
  getCandidateCardKind,
  scopeBadgeLabel,
  type CandidateRow
} from "@/components/luna/candidates/shared";
import { Btn } from "@/components/luna/knowledge/ui";
import {
  glossaryCardTitle,
  openGlossaryEditDraft,
  parseGlossaryMeta,
  selfstudyQuestion,
  candidateMetaLine,
  type GlossaryEditDraft
} from "@/lib/luna/candidate-format";
import { K } from "@/lib/luna/knowledge-format";
import type { PendingFilter } from "@/app/api/luna/candidates/route";

type Counts = {
  all: number;
  chat: number;
  selfstudy: number;
  question: number;
  direct: number;
  interview: number;
  glossary: number;
};

const FILTERS: { key: PendingFilter; label: string; countKey: keyof Counts }[] = [
  { key: "all", label: "전체", countKey: "all" },
  { key: "chat", label: "대화에서", countKey: "chat" },
  { key: "selfstudy", label: "자습에서", countKey: "selfstudy" },
  { key: "question", label: "루나의 질문", countKey: "question" },
  { key: "direct", label: "알려주기", countKey: "direct" },
  { key: "interview", label: "구술·문서", countKey: "interview" },
  { key: "glossary", label: "용어", countKey: "glossary" }
];

export function LunaCandidatesPending() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<PendingFilter>("all");
  const [items, setItems] = useState<CandidateRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reviseOpen, setReviseOpen] = useState<Record<string, string>>({});
  const [glossaryEdit, setGlossaryEdit] = useState<
    Record<string, GlossaryEditDraft>
  >({});
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const load = useCallback(async (f: PendingFilter) => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/luna/candidates?filter=${f}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(`불러오기 실패 (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        items?: CandidateRow[];
        counts?: Counts;
      };
      setItems(json.items ?? []);
      setCounts(json.counts ?? null);
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function respond(
    id: string,
    action: "confirm" | "revise" | "reject" | "not_needed",
    text?: string,
    glossary?: GlossaryEditDraft
  ) {
    const token = await getAccessToken();
    if (!token) return;
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch("/api/luna/candidates/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id,
          action,
          text,
          glossary: glossary
            ? {
                term_ko: glossary.term_ko,
                term_en: glossary.term_en || null,
                term_zh: glossary.term_zh || null,
                definition: glossary.definition,
                categories: glossary.categories
              }
            : undefined
        })
      });
      if (!res.ok) {
        setMessage(`처리 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as {
        id?: string;
        status?: string;
        content?: string;
        meta?: Record<string, unknown> | null;
        thread?: CandidateRow["thread"];
        glossary_registered?: boolean;
        glossary_notice?: string;
        merged_into?: string;
      };

      if (action === "revise" && json.id) {
        setItems((prev) =>
          prev.map((c) =>
            c.id === json.id
              ? {
                  ...c,
                  content: json.content ?? c.content,
                  meta: json.meta ?? c.meta,
                  raw_input:
                    typeof json.content === "string" ? json.content : c.raw_input,
                  thread: json.thread ?? c.thread,
                  is_my_turn:
                    c.source === "question" &&
                    (json.thread?.length ?? 0) > 0 &&
                    json.thread?.[json.thread.length - 1]?.role === "luna"
                }
              : c
          )
        );
        setReviseOpen((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setGlossaryEdit((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setReplyDraft((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }

      setItems((prev) => prev.filter((c) => c.id !== id));
      setReviseOpen((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setGlossaryEdit((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (action === "confirm") {
        if (json.merged_into) {
          setMessage("중복 후보를 본문에 병합했어요");
        } else if (json.glossary_registered) {
          setMessage("용어사전에 등록했어요");
        } else if (json.glossary_notice) {
          setMessage(`기억으로 확정했어요 (${json.glossary_notice})`);
        } else {
          setMessage("기억으로 확정했어요");
        }
      }
      void load(filter);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <KnowledgeShell>
        <LoadingLine />
      </KnowledgeShell>
    );
  }

  return (
    <KnowledgeShell>
      {error ? <ErrorLine message={error} /> : null}
      {message ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {message}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            on={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {counts ? counts[f.countKey] : "—"}
          </FilterChip>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          대기 중인 후보가 없습니다
        </p>
      ) : (
        items.map((item) => {
          const kind = getCandidateCardKind({
            source: item.source,
            category: item.category,
            meta: item.meta,
            threadLength: item.thread.length
          });
          const busy = busyId === item.id;
          const glossary = parseGlossaryMeta(item.meta, item.content);
          const scopeLabel = scopeBadgeLabel(
            item.scope_suggestion,
            kind === "glossary" ? glossary.categories : undefined
          );
          const metaLine = candidateMetaLine({
            source: item.source,
            author_name: item.author_name,
            created_at: item.created_at,
            evidence: item.evidence,
            meta: item.meta
          });

          const isDuplicate = item.review_reason === "duplicate";
          const reviseDraft = reviseOpen[item.id];
          const editingGlossary = glossaryEdit[item.id];
          const openRevise = () => {
            const initial = isDuplicate
              ? (item.raw_input?.trim() || item.content)
              : item.content;
            setReviseOpen((p) => ({ ...p, [item.id]: initial }));
            setGlossaryEdit((p) => {
              const n = { ...p };
              delete n[item.id];
              return n;
            });
          };
          const closeRevise = () => {
            setReviseOpen((p) => {
              const n = { ...p };
              delete n[item.id];
              return n;
            });
            setGlossaryEdit((p) => {
              const n = { ...p };
              delete n[item.id];
              return n;
            });
          };
          const revisePanel =
            reviseDraft !== undefined ? (
              <div className="mt-3">
                {isDuplicate ? (
                  <div
                    className="mb-1.5 text-[11px] font-semibold"
                    style={{ color: K.faint }}
                  >
                    병합 초안
                  </div>
                ) : null}
                <textarea
                  className="w-full rounded-[9px] border p-2.5 text-[13px] leading-[1.7]"
                  style={{ borderColor: K.line, minHeight: 70 }}
                  rows={3}
                  value={reviseDraft}
                  onChange={(e) =>
                    setReviseOpen((p) => ({ ...p, [item.id]: e.target.value }))
                  }
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Btn
                    primary
                    disabled={busy || !reviseDraft.trim()}
                    onClick={() =>
                      void respond(item.id, "confirm", reviseDraft.trim())
                    }
                  >
                    저장 · 확정
                  </Btn>
                  <Btn onClick={closeRevise}>취소</Btn>
                </div>
              </div>
            ) : null;

          if (kind === "glossary") {
            const registerBlocked = editingGlossary
              ? !editingGlossary.term_ko.trim()
              : glossaryCardTitle(glossary).missingTerm;

            return (
              <CandidateCardShell key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge
                    source={item.source}
                    glossary
                    sourceId={item.source_id}
                    sourceTitle={item.source_title}
                  />
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    {metaLine}
                    {item.source_conversation_id ? (
                      <>
                        {" · "}
                        <ConversationLink conversationId={item.source_conversation_id}>
                          원문 보기
                        </ConversationLink>
                      </>
                    ) : null}
                  </span>
                  <ScopeBadge label={scopeLabel} />
                </div>
                {editingGlossary ? (
                  <GlossaryEditForm
                    draft={editingGlossary}
                    evidence={item.evidence}
                    onChange={(next) =>
                      setGlossaryEdit((p) => ({ ...p, [item.id]: next }))
                    }
                  />
                ) : (
                  <GlossaryCardBody
                    meta={item.meta}
                    content={item.content}
                    evidence={item.evidence}
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {editingGlossary ? (
                    <>
                      <Btn
                        primary
                        disabled={busy || !editingGlossary.term_ko.trim()}
                        onClick={() =>
                          void respond(
                            item.id,
                            "confirm",
                            undefined,
                            editingGlossary
                          )
                        }
                      >
                        저장 · 확정
                      </Btn>
                      <Btn onClick={closeRevise}>취소</Btn>
                    </>
                  ) : (
                    <>
                      <Btn
                        primary
                        disabled={busy || registerBlocked}
                        onClick={() => void respond(item.id, "confirm")}
                      >
                        맞아요 → 용어사전 등록
                      </Btn>
                      {registerBlocked ? (
                        <span
                          className="text-[11.5px]"
                          style={{ color: K.faint }}
                        >
                          용어명이 비어 있어 바로 등록할 수 없어요
                        </span>
                      ) : null}
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          setGlossaryEdit((p) => ({
                            ...p,
                            [item.id]: openGlossaryEditDraft(glossary)
                          }))
                        }
                      >
                        고쳐서 확정
                      </Btn>
                      <Btn
                        disabled={busy}
                        onClick={() => void respond(item.id, "reject")}
                      >
                        아니에요
                      </Btn>
                    </>
                  )}
                </div>
              </CandidateCardShell>
            );
          }

          if (kind === "selfstudy") {
            const q = selfstudyQuestion(item.meta);
            return (
              <CandidateCardShell key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge
                    source={item.source}
                    sourceId={item.source_id}
                    sourceTitle={item.source_title}
                  />
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    {metaLine}
                  </span>
                </div>
                <div className="qa">
                  {q ? (
                    <div className="mt-2.5 text-[12.5px]" style={{ color: K.sub }}>
                      Q. {q}
                    </div>
                  ) : null}
                  <div className="text-[14px] leading-relaxed">A. {item.content}</div>
                </div>
                {item.evidence ? (
                  <div className="mt-2 text-[12px]" style={{ color: K.sub }}>
                    찾은 곳: {item.evidence.replace(/^출처:\s*/, "")}
                  </div>
                ) : null}
                {revisePanel}
                {reviseDraft === undefined ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      primary
                      disabled={busy}
                      onClick={() => void respond(item.id, "confirm")}
                    >
                      잘 배웠어 → 기억
                    </Btn>
                    <Btn disabled={busy} onClick={openRevise}>
                      고쳐서 확정
                    </Btn>
                    <Btn
                      disabled={busy}
                      onClick={() => void respond(item.id, "reject")}
                    >
                      틀렸어
                    </Btn>
                    <button
                      type="button"
                      disabled={busy}
                      className="px-2 text-[12.5px] font-bold disabled:opacity-50"
                      style={{ color: K.faint }}
                      onClick={() => void respond(item.id, "not_needed")}
                    >
                      이런 건 안 배워도 돼
                    </button>
                  </div>
                ) : null}
              </CandidateCardShell>
            );
          }

          if (kind === "dialogue" && item.thread.length > 0) {
            const turnN = Math.max(1, Math.ceil(item.thread.length / 2));
            return (
              <CandidateCardShell key={item.id} highlight={item.is_my_turn}>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge
                    source={item.source}
                    myTurn={item.is_my_turn}
                    sourceId={item.source_id}
                    sourceTitle={item.source_title}
                  />
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    문답 {turnN}번째
                    {isDuplicate ? " · 중복 병합" : ""}
                  </span>
                </div>
                <ThreadBlock thread={item.thread} />
                {!isDuplicate ? (
                  <ReplyRow
                    value={replyDraft[item.id] ?? ""}
                    onChange={(v) =>
                      setReplyDraft((p) => ({ ...p, [item.id]: v }))
                    }
                    busy={busy}
                    onSend={() => {
                      const t = replyDraft[item.id]?.trim();
                      if (!t) return;
                      void respond(item.id, "revise", t);
                    }}
                  />
                ) : null}
                {revisePanel}
                {reviseDraft === undefined ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Btn
                      primary
                      disabled={busy}
                      onClick={() => void respond(item.id, "confirm")}
                    >
                      맞아요 → 기억
                    </Btn>
                    <Btn disabled={busy} onClick={openRevise}>
                      고쳐서 확정
                    </Btn>
                    <Btn
                      disabled={busy}
                      onClick={() => void respond(item.id, "reject")}
                    >
                      아니에요
                    </Btn>
                  </div>
                ) : null}
              </CandidateCardShell>
            );
          }

          return (
            <CandidateCardShell key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <SourceBadge
                  source={item.source}
                  sourceId={item.source_id}
                  sourceTitle={item.source_title}
                />
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  {metaLine}
                  {isDuplicate ? " · 중복 병합" : ""}
                  {item.source_conversation_id ? (
                    <>
                      {" · "}
                      <ConversationLink conversationId={item.source_conversation_id}>
                        원문 보기
                      </ConversationLink>
                    </>
                  ) : null}
                </span>
                <ScopeBadge label={scopeLabel} />
              </div>
              <div className="my-2.5 text-[14px] leading-relaxed">
                {isDuplicate
                  ? item.raw_input?.trim() || item.content
                  : item.content}
              </div>
              {item.evidence ? (
                <div className="text-[12px]" style={{ color: K.sub }}>
                  근거: {item.evidence.replace(/^근거:\s*/, "")}
                </div>
              ) : null}
              {revisePanel}
              {reviseDraft === undefined ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn
                    primary
                    disabled={busy}
                    onClick={() => void respond(item.id, "confirm")}
                  >
                    맞아요 → 기억
                  </Btn>
                  <Btn disabled={busy} onClick={openRevise}>
                    고쳐서 확정
                  </Btn>
                  <Btn
                    disabled={busy}
                    onClick={() => void respond(item.id, "reject")}
                  >
                    아니에요
                  </Btn>
                </div>
              ) : null}
            </CandidateCardShell>
          );
        })
      )}
    </KnowledgeShell>
  );
}
