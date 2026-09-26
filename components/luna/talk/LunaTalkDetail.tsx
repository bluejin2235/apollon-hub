"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Source = {
  kind: string;
  title: string;
  path: string;
  drive: string;
  via_link: string;
  url: string | null;
};
type Message = {
  id: string;
  role: string;
  content: string;
  content_truncated: boolean;
  created_at: string;
  search: {
    retrieved_candidate_peak: number | null;
    displayed_source_count: number | null;
    cards: Source[];
    notion: Source[];
    wiki: Source[];
  };
};
type Detail = {
  conversation: { title: string | null };
  truncated: boolean;
  messages: Message[];
};

export function LunaTalkDetail({ conversationId }: { conversationId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        if (!cancelled) setError("로그인이 필요합니다");
        return;
      }
      try {
        const res = await fetch(
          `/api/luna/talk/detail?conversation_id=${encodeURIComponent(conversationId)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (!res.ok) throw new Error("대화 상세를 불러오지 못했습니다");
        const json = (await res.json()) as Detail;
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "불러오기 실패");
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  if (error) return <p className="mt-3 text-xs text-red-700">{error}</p>;
  if (!detail) return <p className="mt-3 text-xs text-slate-500">대화 원문을 불러오는 중…</p>;

  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
      <p className="text-xs font-semibold text-slate-700">대화 원문 · {detail.messages.length}개 메시지</p>
      {detail.truncated ? <p className="text-xs text-amber-700">최초 100개 메시지만 표시합니다.</p> : null}
      {detail.messages.map((message) => {
        const src = [...message.search.cards, ...message.search.notion, ...message.search.wiki];
        const hasSearch = message.search.retrieved_candidate_peak !== null
          || message.search.displayed_source_count !== null;
        return (
          <div key={message.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <p className="mb-2 font-semibold text-slate-700">
              {message.role === "assistant" ? "LUNA 답변" : message.role === "user" ? "질문" : message.role}
            </p>
            <p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-slate-800">
              {message.content}
            </p>
            {message.content_truncated ? <p className="mt-1 text-amber-700">본문 일부만 표시합니다.</p> : null}
            {message.role === "assistant" && hasSearch ? (
              <div className="mt-3 border-t border-slate-100 pt-2 text-slate-600">
                <p>검색 중 확인된 후보 최대 {message.search.retrieved_candidate_peak ?? "미기록"}건 · 저장된 출처 카드 수 {message.search.displayed_source_count ?? "미기록"}건</p>
                <p>두 수치는 검색 단계와 카드 저장 단계를 각각 센 값이며, 인용된 출처 수를 뜻하지 않습니다.</p>
              </div>
            ) : null}
            {src.length > 0 ? (
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                <p className="font-semibold">답변과 함께 저장된 자료</p>
                {src.map((source, i) => (
                  <p key={`${message.id}-${i}`} className="break-all">
                    {source.kind} · {source.title || "제목 없음"}
                    {source.via_link ? ` · 연결: ${source.via_link}` : ""}
                    {source.path ? ` · ${source.drive ? `${source.drive}:\\` : ""}${source.path}` : ""}
                    {source.url ? <> · <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">열기</a></> : null}
                  </p>
                ))}
              </div>
            ) : message.role === "assistant" ? (
              <p className="mt-2 text-slate-500">이 답변에 저장된 출처 목록이 없습니다.</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
