"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CandidateCardShell,
  ConversationLink,
  ErrorLine,
  FilterChip,
  GlossaryCardBody,
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
  parseGlossaryMeta,
  selfstudyQuestion,
  candidateMetaLine
} from "@/lib/luna/candidate-format";
import { K } from "@/lib/luna/knowledge-format";
import type { PendingFilter } from "@/app/api/luna/candidates/route";

type Counts = {
  all: number;
  chat: number;
  selfstudy: number;
  question: number;
  direct: number;
  glossary: number;
};

const FILTERS: { key: PendingFilter; label: string; countKey: keyof Counts }[] = [
  { key: "all", label: "전체", countKey: "all" },
  { key: "chat", label: "대화에서", countKey: "chat" },
  { key: "selfstudy", label: "자습에서", countKey: "selfstudy" },
  { key: "question", label: "루나의 질문", countKey: "question" },
  { key: "direct", label: "알려주기", countKey: "direct" },
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
    text?: string
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
        body: JSON.stringify({ id, action, text })
      });
      if (!res.ok) {
        setMessage(`처리 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as {
        id?: string;
        status?: string;
        content?: string;
        thread?: CandidateRow["thread"];
        glossary_registered?: boolean;
        glossary_notice?: string;
      };

      if (action === "revise" && json.id) {
        setItems((prev) =>
          prev.map((c) =>
            c.id === json.id
              ? {
                  ...c,
                  content: json.content ?? c.content,
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
        setReplyDraft((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        return;
      }

      setItems((prev) => prev.filter((c) => c.id !== id));
      if (action === "confirm") {
        if (json.glossary_registered) {
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
            kind === "glossary" ? glossary.category : undefined
          );
          const metaLine = candidateMetaLine({
            source: item.source,
            author_name: item.author_name,
            created_at: item.created_at,
            evidence: item.evidence,
            meta: item.meta
          });

          if (kind === "glossary") {
            return (
              <CandidateCardShell key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={item.source} glossary />
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
                <GlossaryCardBody
                  meta={item.meta}
                  content={item.content}
                  evidence={item.evidence}
                />
                {reviseOpen[item.id] !== undefined ? (
                  <textarea
                    className="mt-3 w-full rounded-[9px] border p-2.5 text-[13px] outline-none focus:border-[#d9d2ff]"
                    style={{ borderColor: K.line }}
                    rows={3}
                    value={reviseOpen[item.id]}
                    onChange={(e) =>
                      setReviseOpen((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                    placeholder="고친 정의를 입력하세요"
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {reviseOpen[item.id] !== undefined ? (
                    <>
                      <Btn
                        primary
                        disabled={busy || !reviseOpen[item.id]?.trim()}
                        onClick={() =>
                          void respond(item.id, "revise", reviseOpen[item.id])
                        }
                      >
                        수정 반영
                      </Btn>
                      <Btn onClick={() => setReviseOpen((p) => {
                        const n = { ...p };
                        delete n[item.id];
                        return n;
                      })}>
                        취소
                      </Btn>
                    </>
                  ) : (
                    <>
                      <Btn
                        primary
                        disabled={busy}
                        onClick={() => void respond(item.id, "confirm")}
                      >
                        맞아요 → 용어사전 등록
                      </Btn>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          setReviseOpen((p) => ({
                            ...p,
                            [item.id]: glossary.definition
                          }))
                        }
                      >
                        고쳐서 등록
                      </Btn>
                      <Btn disabled={busy} onClick={() => void respond(item.id, "reject")}>
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
                  <SourceBadge source={item.source} />
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
                {reviseOpen[item.id] !== undefined ? (
                  <textarea
                    className="mt-3 w-full rounded-[9px] border p-2.5 text-[13px]"
                    style={{ borderColor: K.line }}
                    rows={3}
                    value={reviseOpen[item.id]}
                    onChange={(e) =>
                      setReviseOpen((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {reviseOpen[item.id] !== undefined ? (
                    <>
                      <Btn
                        primary
                        disabled={busy}
                        onClick={() =>
                          void respond(item.id, "revise", reviseOpen[item.id])
                        }
                      >
                        수정 반영
                      </Btn>
                      <Btn onClick={() => setReviseOpen((p) => {
                        const n = { ...p };
                        delete n[item.id];
                        return n;
                      })}>
                        취소
                      </Btn>
                    </>
                  ) : (
                    <>
                      <Btn primary disabled={busy} onClick={() => void respond(item.id, "confirm")}>
                        잘 배웠어 → 기억
                      </Btn>
                      <Btn
                        disabled={busy}
                        onClick={() =>
                          setReviseOpen((p) => ({ ...p, [item.id]: item.content }))
                        }
                      >
                        고쳐서 확정
                      </Btn>
                      <Btn disabled={busy} onClick={() => void respond(item.id, "reject")}>
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
                    </>
                  )}
                </div>
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
                  />
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    문답 {turnN}번째
                  </span>
                </div>
                <ThreadBlock thread={item.thread} />
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
                <div className="mt-2 flex flex-wrap gap-2">
                  <Btn primary disabled={busy} onClick={() => void respond(item.id, "confirm")}>
                    맞아요 → 기억
                  </Btn>
                  <Btn disabled={busy} onClick={() => void respond(item.id, "reject")}>
                    아니에요
                  </Btn>
                </div>
              </CandidateCardShell>
            );
          }

          return (
            <CandidateCardShell key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <SourceBadge source={item.source} />
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
              <div className="my-2.5 text-[14px] leading-relaxed">{item.content}</div>
              {item.evidence ? (
                <div className="text-[12px]" style={{ color: K.sub }}>
                  근거: {item.evidence.replace(/^근거:\s*/, "")}
                </div>
              ) : null}
              {reviseOpen[item.id] !== undefined ? (
                <textarea
                  className="mt-3 w-full rounded-[9px] border p-2.5 text-[13px]"
                  style={{ borderColor: K.line }}
                  rows={3}
                  value={reviseOpen[item.id]}
                  onChange={(e) =>
                    setReviseOpen((p) => ({ ...p, [item.id]: e.target.value }))
                  }
                />
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {reviseOpen[item.id] !== undefined ? (
                  <>
                    <Btn
                      primary
                      disabled={busy}
                      onClick={() =>
                        void respond(item.id, "revise", reviseOpen[item.id])
                      }
                    >
                      수정 반영
                    </Btn>
                    <Btn onClick={() => setReviseOpen((p) => {
                      const n = { ...p };
                      delete n[item.id];
                      return n;
                    })}>
                      취소
                    </Btn>
                  </>
                ) : (
                  <>
                    <Btn primary disabled={busy} onClick={() => void respond(item.id, "confirm")}>
                      맞아요 → 기억
                    </Btn>
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        setReviseOpen((p) => ({ ...p, [item.id]: item.content }))
                      }
                    >
                      고쳐서 확정
                    </Btn>
                    <Btn disabled={busy} onClick={() => void respond(item.id, "reject")}>
                      아니에요
                    </Btn>
                  </>
                )}
              </div>
            </CandidateCardShell>
          );
        })
      )}
    </KnowledgeShell>
  );
}
