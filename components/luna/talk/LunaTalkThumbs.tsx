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

type ThumbItem = {
  id: string;
  conversation_id: string;
  when: string;
  user_name: string;
  question: string;
  answer: string;
  reason: string | null;
  reason_label: string | null;
  note: string | null;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaTalkThumbs({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<ThumbItem[]>([]);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/luna/talk/thumbs", {
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
    const json = (await res.json()) as { items?: ThumbItem[] };
    setItems(json.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const body = (
    <>
      <p className="mb-3 text-[13px]" style={{ color: K.sub }}>
        대화에서 남긴 싫어요입니다. 칩과 직접 적은 글이 프롬프트·유형 개선의 근거가 됩니다.
      </p>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <ListCard>
          {items.length === 0 ? (
            <ListItem>
              <p className="text-[13px]" style={{ color: K.faint }}>
                싫어요 기록이 없습니다.
              </p>
            </ListItem>
          ) : (
            items.map((item) => (
              <ListItem key={item.id}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => router.push(`/luna?c=${item.conversation_id}`)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px]" style={{ color: K.faint }}>
                      {item.when}
                    </span>
                    <span className="text-[12px]" style={{ color: K.sub }}>
                      {item.user_name}
                    </span>
                    {item.reason_label ? (
                      <Badge kind="red">{item.reason_label}</Badge>
                    ) : (
                      <Badge kind="src">사유 없음</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13.5px] font-bold leading-[1.45]" style={{ color: K.ink }}>
                    {item.question || "(질문 없음)"}
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5]" style={{ color: K.sub }}>
                    {item.answer || "(답변 없음)"}
                  </p>
                  {item.note ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-[1.5]" style={{ color: K.ink }}>
                      {item.note}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[12px]" style={{ color: K.faint }}>
                      직접 적은 글 없음
                    </p>
                  )}
                </button>
              </ListItem>
            ))
          )}
        </ListCard>
      ) : null}

      {!loading && items.length > 0 ? (
        <Hint>최근 {items.length}건 · 행을 누르면 그 대화로 갑니다</Hint>
      ) : null}
    </>
  );

  if (embedded) return body;
  return <KnowledgeShell>{body}</KnowledgeShell>;
}
