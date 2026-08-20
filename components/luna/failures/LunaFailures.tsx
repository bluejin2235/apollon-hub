"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  ErrorLine,
  Hint,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";
import { LunaRejectReasons } from "@/components/luna/brain/LunaRejectReasons";

type FailureRow = {
  id: string;
  conversation_id: string | null;
  question: string;
  answer_excerpt: string;
  signal: string;
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  asked_by_name?: string | null;
};

type Cluster = {
  key: string;
  label: string;
  count: number;
  asker_count: number;
};

type Payload = {
  summary: { open: number; improve: number; skip: number };
  clusters: Cluster[];
  items: FailureRow[];
};

const SIGNAL_LABEL: Record<string, string> = {
  thumbs_down: "👎",
  correction: "정정",
  candidate_deleted: "후보 삭제",
  low_intent: "의도 낮음",
  low_confidence: "자신감 낮음",
  not_found: "못 찾음",
  unclassified: "미분류",
  zero_search: "검색 0건",
  eval_fail: "점검 실패"
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function FailureCard({
  item,
  onDone
}: {
  item: FailureRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (action: "improve" | "skip") => {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    const res = await fetch("/api/luna/failures", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: item.id,
        action,
        note: action === "improve" ? note : undefined
      })
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onDone();
    }
  };

  return (
    <ListItem>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="src">{SIGNAL_LABEL[item.signal] ?? item.signal}</Badge>
          {item.intent_score != null ? (
            <Badge kind={item.intent_score < 5 ? "red" : "src"}>
              의도 {item.intent_score}
            </Badge>
          ) : null}
          {item.confidence_score != null ? (
            <Badge kind={item.confidence_score < 5 ? "red" : "src"}>
              자신감 {item.confidence_score}
            </Badge>
          ) : null}
          <span className="text-[12px]" style={{ color: K.faint }}>
            {item.asked_by_name ?? "—"}
          </span>
        </div>
        <button
          type="button"
          className="w-full text-left"
          onClick={() =>
            item.conversation_id
              ? router.push(`/luna?c=${item.conversation_id}`)
              : undefined
          }
        >
          <p className="text-[13.5px] font-bold leading-[1.45]" style={{ color: K.ink }}>
            {item.question || "(질문 없음)"}
          </p>
          <p className="mt-1 text-[13px] leading-[1.5]" style={{ color: K.sub }}>
            {item.answer_excerpt || "(답변 없음)"}
          </p>
          {item.self_note ? (
            <p className="mt-1 text-[12px] italic" style={{ color: K.faint }}>
              {item.self_note}
            </p>
          ) : null}
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-[#2563eb] bg-[#eff6ff] px-3 py-1.5 text-[12px] font-semibold text-[#2563eb]"
          >
            개선하기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("skip")}
            className="rounded-lg border border-[#e7e8ec] bg-white px-3 py-1.5 text-[12px] text-[#6b6f76]"
          >
            스킵하기
          </button>
        </div>
        {open ? (
          <div className="rounded-lg border border-[#e7e8ec] bg-[#fafbfc] p-3">
            <p className="mb-2 text-[12px] font-semibold" style={{ color: K.sub }}>
              이렇게 했어야 해요
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#e7e8ec] px-2 py-1.5 text-[13px]"
              placeholder="새 사실, 위키 누락, 답변 방식…"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => void act("improve")}
                className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                남기기
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-[12px] text-[#6b6f76]"
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ListItem>
  );
}

export function LunaFailures() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/luna/failures", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? "슈퍼관리자만 볼 수 있습니다."
          : `불러오기 실패: ${await res.text()}`
      );
      setLoading(false);
      return;
    }
    setData((await res.json()) as Payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <KnowledgeShell>
      <p className="mb-3 text-[13px]" style={{ color: K.sub }}>
        잘 안 된 순간만 모읍니다. 성공한 답변은 여기 없습니다.
      </p>

      {data ? (
        <div className="mb-4 flex flex-wrap gap-3 text-[13px]">
          <span style={{ color: K.ink }}>
            확인할 것 <strong>{data.summary.open}</strong>
          </span>
          <span style={{ color: K.sub }}>
            · 개선한 것 <strong>{data.summary.improve}</strong>
          </span>
          <span style={{ color: K.sub }}>
            · 스킵한 것 <strong>{data.summary.skip}</strong>
          </span>
        </div>
      ) : null}

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error && data ? (
        <>
          {data.clusters.length > 0 ? (
            <div className="mb-4 space-y-2">
              <p className="text-[12px] font-semibold" style={{ color: K.sub }}>
                묶어 보기
              </p>
              {data.clusters.slice(0, 8).map((c) => (
                <div
                  key={c.key}
                  className="rounded-lg border border-[#e7e8ec] bg-[#fafbfc] px-3 py-2 text-[13px]"
                  style={{ color: K.ink }}
                >
                  「{c.label}…」 관련 {c.count}번 · {c.asker_count}명
                </div>
              ))}
            </div>
          ) : null}

          <ListCard>
            {data.items.length === 0 ? (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  확인할 실패가 없습니다.
                </p>
              </ListItem>
            ) : (
              data.items.map((item) => (
                <FailureCard key={item.id} item={item} onDone={load} />
              ))
            )}
          </ListCard>
          <Hint>최근 {data.items.length}건 · 행을 누르면 그 대화로 갑니다</Hint>
          <LunaRejectReasons />
        </>
      ) : null}
    </KnowledgeShell>
  );
}
