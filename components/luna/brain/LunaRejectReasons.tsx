"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  ErrorLine,
  Hint,
  ListCard,
  ListItem,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { getAccessToken } from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";

type RejectItem = {
  id: string;
  when: string;
  content: string;
  action: string;
  note: string | null;
};

export function LunaRejectReasons() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<RejectItem[]>([]);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/luna/candidates/rejects", {
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
    const json = (await res.json()) as { items?: RejectItem[] };
    setItems(json.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-8">
      <h3 className="mb-2 text-[13px] font-bold">거절 이유</h3>
      <p className="mb-3 text-[13px]" style={{ color: K.sub }}>
        지식후보에서 [아니에요]에 남긴 선택과 글입니다. 같은 이유가 반복되면
        판정이나 프롬프트를 고칠 근거가 됩니다.
      </p>
      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}
      {!loading && !error ? (
        <ListCard>
          {items.length === 0 ? (
            <ListItem>
              <p className="text-[13px]" style={{ color: K.faint }}>
                거절 이유가 없습니다.
              </p>
            </ListItem>
          ) : (
            items.map((item) => (
              <ListItem key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px]" style={{ color: K.faint }}>
                    {item.when}
                  </span>
                  {item.action !== "—" ? (
                    <Badge kind="src">{item.action}</Badge>
                  ) : (
                    <Badge kind="src">선택 없음</Badge>
                  )}
                </div>
                <p
                  className="mt-1.5 text-[13.5px] font-bold leading-[1.45]"
                  style={{ color: K.ink }}
                >
                  {item.content || "(내용 없음)"}
                </p>
                {item.note ? (
                  <p
                    className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-[1.5]"
                    style={{ color: K.ink }}
                  >
                    {item.note}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12px]" style={{ color: K.faint }}>
                    직접 적은 글 없음
                  </p>
                )}
              </ListItem>
            ))
          )}
        </ListCard>
      ) : null}
      {!loading && items.length > 0 ? (
        <Hint>최근 {items.length}건</Hint>
      ) : null}
    </div>
  );
}
