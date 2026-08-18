"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  GlossaryDuplicateDialog,
  type GlossaryDuplicatePayload
} from "@/components/glossary/GlossaryDuplicateDialog";
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
  KnowledgeReviewCard,
  type KnowledgeReviewAction
} from "@/components/luna/candidates/KnowledgeReviewCard";
import type { GlossaryDupMatch, GlossaryDupTerm } from "@/lib/glossary/duplicate";
import type { GlossaryFieldValues } from "@/lib/glossary/types";
import {
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

type QueueCounts = {
  total: number;
  duplicate: number;
  fresh: number;
};

const PAGE_SIZE = 20;

function CardStackItem({
  showDivider,
  children
}: {
  showDivider: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {showDivider ? (
        <div className="my-3.5 h-px" style={{ background: K.line }} />
      ) : null}
      {children}
    </div>
  );
}

const FILTERS: { key: PendingFilter; label: string; countKey: keyof Counts }[] = [
  { key: "all", label: "전체", countKey: "all" },
  { key: "chat", label: "대화에서", countKey: "chat" },
  { key: "selfstudy", label: "자습에서", countKey: "selfstudy" },
  { key: "question", label: "루나의 질문", countKey: "question" },
  { key: "direct", label: "알려주기", countKey: "direct" },
  { key: "interview", label: "구술·문서", countKey: "interview" },
  { key: "glossary", label: "용어", countKey: "glossary" }
];
function toGlossaryPayload(draft: GlossaryEditDraft) {
  return {
    term_ko: draft.term_ko.trim(),
    term_en: draft.term_en.trim() || null,
    term_zh: draft.term_zh.trim() || null,
    definition: draft.definition.trim(),
    categories: draft.categories,
    synonyms: draft.synonyms
  };
}

function asConfirmDraft(
  draft: ReturnType<typeof parseGlossaryMeta>
): GlossaryEditDraft {
  return { ...draft, movedFromTitle: false };
}

export function LunaCandidatesPending() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<PendingFilter>("all");
  const [items, setItems] = useState<CandidateRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [queue, setQueue] = useState<QueueCounts | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reviseOpen, setReviseOpen] = useState<Record<string, string>>({});
  const [glossaryEdit, setGlossaryEdit] = useState<
    Record<string, GlossaryEditDraft>
  >({});
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [dupPayload, setDupPayload] = useState<GlossaryDuplicatePayload | null>(
    null
  );
  const [dupBusy, setDupBusy] = useState(false);
  const [dupError, setDupError] = useState("");
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

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
        queue?: QueueCounts;
      };
      setItems(json.items ?? []);
      setCounts(json.counts ?? null);
      setQueue(json.queue ?? null);
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
    void load(filter);
  }, [filter, load]);

  function dismissItem(id: string) {
    const gone = items.find((c) => c.id === id);
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
    setReplyDraft((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (!gone) return;
    const isGlossary = gone.is_glossary;
    const isDup =
      gone.review_reason === "duplicate" || Boolean(gone.duplicate);
    setQueue((q) => {
      if (!q) return q;
      return {
        total: Math.max(0, q.total - 1),
        duplicate:
          !isGlossary && isDup ? Math.max(0, q.duplicate - 1) : q.duplicate,
        fresh: !isGlossary && !isDup ? Math.max(0, q.fresh - 1) : q.fresh
      };
    });
    setCounts((c) => {
      if (!c) return c;
      const next = { ...c, all: Math.max(0, c.all - 1) };
      if (gone.source === "chat") next.chat = Math.max(0, c.chat - 1);
      if (gone.source === "selfstudy") next.selfstudy = Math.max(0, c.selfstudy - 1);
      if (gone.source === "question") next.question = Math.max(0, c.question - 1);
      if (gone.source === "direct") next.direct = Math.max(0, c.direct - 1);
      if (gone.source === "interview") next.interview = Math.max(0, c.interview - 1);
      if (isGlossary) next.glossary = Math.max(0, c.glossary - 1);
      return next;
    });
  }

  async function respond(
    id: string,
    action: "confirm" | "revise" | "reject" | "not_needed",
    text?: string,
    glossary?: GlossaryEditDraft
  ) {
    const token = await getAccessToken();
    if (!token) {
      setCardErrors((prev) => ({ ...prev, [id]: "로그인이 필요합니다" }));
      return;
    }
    setBusyId(id);
    setMessage("");
    setCardErrors((prev) => ({ ...prev, [id]: "" }));
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
          glossary: glossary ? toGlossaryPayload(glossary) : undefined
        })
      });
      const json = (await res.json().catch(() => null)) as {
        id?: string;
        status?: string;
        content?: string;
        meta?: Record<string, unknown> | null;
        thread?: CandidateRow["thread"];
        glossary_registered?: boolean;
        glossary_notice?: string;
        merged_into?: string;
        error?: string;
        conflicts?: boolean;
        primary?: GlossaryDupMatch;
        others?: GlossaryDupMatch[];
        existing?: GlossaryDupTerm;
        incoming?: GlossaryFieldValues;
        merge_draft?: GlossaryFieldValues | null;
      } | null;

      if (res.status === 409 && json?.conflicts && json.primary && json.existing && json.incoming) {
        setDupPayload({
          primary: json.primary,
          others: json.others ?? [],
          existing: json.existing,
          incoming: json.incoming,
          merge_draft: json.merge_draft ?? null,
          source_label: "지식후보",
          candidate_id: id
        });
        setDupError("");
        return;
      }

      if (!res.ok) {
        const errMsg = json?.error ?? `처리 실패 (${res.status})`;
        setCardErrors((prev) => ({ ...prev, [id]: errMsg }));
        return;
      }
      if (!json) {
        setCardErrors((prev) => ({ ...prev, [id]: "처리 실패" }));
        return;
      }

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

        setCardErrors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }

      if (action === "confirm") {
        if (json.merged_into) {
          setMessage("중복 후보를 본문에 병합했어요");
        } else if (json.glossary_registered) {
          setMessage("용어사전에 등록했습니다");
        } else if (json.glossary_notice) {
          setMessage(`기억을 확정했습니다 (${json.glossary_notice})`);
        } else {
          setMessage("기억을 확정했습니다");
        }
      }
      dismissItem(id);
    } catch {
      setCardErrors((prev) => ({ ...prev, [id]: "네트워크 오류" }));
    } finally {
      setBusyId(null);
    }
  }

  async function reviewAction(
    id: string,
    action: KnowledgeReviewAction,
    text?: string,
    rejectNote?: string
  ) {
    const token = await getAccessToken();
    if (!token) {
      setCardErrors((prev) => ({ ...prev, [id]: "로그인이 필요합니다" }));
      return;
    }
    setBusyId(id);
    setMessage("");
    setCardErrors((prev) => ({ ...prev, [id]: "" }));
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
          reject_note: rejectNote || undefined
        })
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        merged_into?: string;
        keep_id?: string;
        status?: string;
      } | null;
      if (!res.ok) {
        setCardErrors((prev) => ({
          ...prev,
          [id]: json?.error ?? `처리 실패 (${res.status})`
        }));
        return;
      }
      if (action === "later") {
        setMessage("나중에 다시 볼게요");
      } else if (action === "keep_both") {
        setMessage("둘 다 남겼어요");
      } else if (action === "reject") {
        setMessage("거절 이유를 남겼어요");
      } else if (action === "discard_new" || action === "accept_existing") {
        setMessage("새 후보를 지웠어요");
      } else if (json?.keep_id || json?.merged_into) {
        setMessage("오래된 지식에 기록을 남기고 후보를 지웠어요");
      } else {
        setMessage("기억을 확정했습니다");
      }
      dismissItem(id);
    } catch {
      setCardErrors((prev) => ({ ...prev, [id]: "네트워크 오류" }));
    } finally {
      setBusyId(null);
    }
  }

  async function resolveGlossaryDup(args: {
    action: "merge" | "replace" | "keep" | "register";
    merged: GlossaryFieldValues;
    incoming: GlossaryFieldValues;
    survivor_id: string;
  }) {
    if (!dupPayload?.candidate_id) return;
    const token = await getAccessToken();
    if (!token) return;
    setDupBusy(true);
    setDupError("");
    const survivorId = args.survivor_id || dupPayload.existing.id;
    const loserIds = Array.from(
      new Set(
        [
          dupPayload.primary.existing_id,
          ...dupPayload.others.map((o) => o.existing_id)
        ].filter((id): id is string => Boolean(id) && id !== survivorId)
      )
    );
    try {
      const res = await fetch("/api/glossary/resolve-duplicate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: args.action,
          existing_id: dupPayload.existing.id,
          survivor_id: survivorId,
          incoming: args.incoming,
          merged: args.merged,
          candidate_id: dupPayload.candidate_id,
          loser_ids: loserIds
        })
      });
      const json = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        conflicts?: boolean;
        primary?: GlossaryDupMatch;
        others?: GlossaryDupMatch[];
        existing?: GlossaryDupTerm;
        incoming?: GlossaryFieldValues;
        merge_draft?: GlossaryFieldValues | null;
        conflict_term_ko?: string;
      } | null;
      if (res.status === 409 && json?.conflicts && json.primary && json.existing) {
        setDupPayload({
          ...dupPayload,
          primary: json.primary,
          others: json.others ?? [],
          existing: json.existing,
          incoming: json.incoming ?? args.incoming,
          merge_draft: json.merge_draft ?? null
        });
        setDupError(
          json.error ||
            json.primary.message ||
            "바꾼 이름도 겹칩니다. 다시 확인해 주세요."
        );
        return;
      }
      if (!res.ok) {
        setDupError(
          json?.error ??
            (json?.conflict_term_ko
              ? `한국어 이름이 다른 활성 용어와 겹칩니다 — ${json.conflict_term_ko}`
              : `처리 실패 (${res.status})`)
        );
        return;
      }
      const doneId = dupPayload.candidate_id;
      setDupPayload(null);
      setDupError("");
      setGlossaryEdit((prev) => {
        const next = { ...prev };
        delete next[doneId];
        return next;
      });
      setMessage(json?.message ?? "처리했습니다.");
      dismissItem(doneId);
    } catch (err) {
      setDupError(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setDupBusy(false);
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
      <div className="mb-1 text-[16px] font-extrabold">지식후보</div>
      <p className="mb-3.5 text-[11.5px]" style={{ color: K.sub }}>
        확인이 필요한 {queue?.total ?? items.length}건
        {queue ? ` · 중복 ${queue.duplicate} · 새 지식 ${queue.fresh}` : ""}
      </p>
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
        <>
        {items.slice(0, visibleLimit).map((item, cardIndex) => {
          const kind = getCandidateCardKind({
            source: item.source,
            category: item.category,
            meta: item.meta,
            threadLength: item.thread.length
          });
          const busy = busyId === item.id;
          const glossary = parseGlossaryMeta(item.meta, item.content);
          const confirmDraft = asConfirmDraft(glossary);
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

          const isDuplicate = item.review_reason === "duplicate" || Boolean(item.duplicate);
          const reviseDraft = reviseOpen[item.id];
          const editingGlossary = glossaryEdit[item.id];
          const cardError = cardErrors[item.id];
          const useReviewCard =
            kind !== "glossary" &&
            kind !== "selfstudy" &&
            item.source !== "question";

          if (useReviewCard) {
            return (
              <CardStackItem key={item.id} showDivider={cardIndex > 0}>
                <KnowledgeReviewCard
                  item={item}
                  busy={busy}
                  error={cardError}
                onAction={(action, text, rejectNote) =>
                  void reviewAction(item.id, action, text, rejectNote)
                }
                />
              </CardStackItem>
            );
          }
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
            setCardErrors((p) => ({ ...p, [item.id]: "" }));
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
            setCardErrors((p) => ({ ...p, [item.id]: "" }));
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
            const activeDraft = editingGlossary ?? confirmDraft;
            const registerBlocked = !activeDraft.term_ko.trim();

            return (
              <CardStackItem key={item.id} showDivider={cardIndex > 0}>
              <CandidateCardShell>
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
                    alreadyInGlossary={item.glossary_already_exists}
                  />
                )}
                {cardError ? (
                  <p className="mt-2 text-[12px]" style={{ color: K.danger }}>
                    {cardError}
                  </p>
                ) : null}
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
                        {busy ? "저장 중…" : "저장 · 확정"}
                      </Btn>
                      <Btn disabled={busy} onClick={closeRevise}>
                        취소
                      </Btn>
                    </>
                  ) : (
                    <>
                      <Btn
                        primary
                        disabled={busy || registerBlocked}
                        onClick={() =>
                          void respond(item.id, "confirm", undefined, confirmDraft)
                        }
                      >
                        {busy ? "등록 중…" : "맞아요 → 용어사전 등록"}
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
              </CardStackItem>
            );
          }

          if (kind === "selfstudy") {
            const q = selfstudyQuestion(item.meta);
            return (
              <CardStackItem key={item.id} showDivider={cardIndex > 0}>
              <CandidateCardShell>
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
              </CardStackItem>
            );
          }

          if (kind === "dialogue" && item.thread.length > 0) {
            const turnN = Math.max(1, Math.ceil(item.thread.length / 2));
            return (
              <CardStackItem key={item.id} showDivider={cardIndex > 0}>
              <CandidateCardShell highlight={item.is_my_turn}>
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
              </CardStackItem>
            );
          }

          return (
            <CardStackItem key={item.id} showDivider={cardIndex > 0}>
            <CandidateCardShell>
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
            </CardStackItem>
          );
        })}
        {items.length > visibleLimit ? (
          <button
            type="button"
            className="mt-3.5 w-full rounded-[10px] py-2.5 text-[12.5px] font-bold"
            style={{
              border: `1px solid ${K.line}`,
              color: K.sub,
              background: K.panel
            }}
            onClick={() => setVisibleLimit((n) => n + PAGE_SIZE)}
          >
            더 보기
          </button>
        ) : null}
        </>
      )}

      <GlossaryDuplicateDialog
        open={!!dupPayload}
        payload={dupPayload}
        busy={dupBusy}
        error={dupError}
        onCancel={() => {
          setDupPayload(null);
          setDupError("");
        }}
        onResolve={(args) => void resolveGlossaryDup(args)}
      />
    </KnowledgeShell>
  );
}
