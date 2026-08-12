"use client";

import { useCallback, useEffect, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import {
  Badge,
  Btn,
  ErrorLine,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine,
  Meta
} from "@/components/luna/knowledge/ui";
import {
  formatKnowledgeDate,
  K,
  sourceLabel
} from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type ConflictOption = {
  id: string;
  content: string;
  author_name: string | null;
  created_at: string | null;
  source: string | null;
  origin: string | null;
};

type ConflictItem = {
  group: string;
  kind: "group" | "merged";
  title: string;
  pending_days: number | null;
  options: ConflictOption[];
};

type HistoryItem = {
  id: string;
  label: string;
  summary: string;
  resolved_at: string;
  resolver_name: string | null;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaKnowledgeConflict() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    const res = await fetch("/api/luna/knowledge/conflicts", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      conflicts?: ConflictItem[];
      history?: HistoryItem[];
    };
    setConflicts(json.conflicts ?? []);
    setHistory(json.history ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function resolveGroup(group: string, winnerId: string) {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(group);
    try {
      const res = await fetch("/api/luna/teach/resolve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ group, winner_id: winnerId })
      });
      if (!res.ok) {
        setToast(`처리 실패: ${await res.text()}`);
        return;
      }
      setToast("확정했습니다");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function resolveMerged(
    conflictId: string,
    action: "keep_one" | "discard",
    keepId?: string
  ) {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(conflictId);
    try {
      const res = await fetch("/api/luna/knowledge/resolve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          conflict_id: conflictId,
          action,
          ...(keepId ? { keep_id: keepId } : {})
        })
      });
      if (!res.ok) {
        setToast(`처리 실패: ${await res.text()}`);
        return;
      }
      setToast("처리했습니다");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function discardGroup(group: string, kind: "group" | "merged", ids: string[]) {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(group);
    try {
      if (kind === "merged") {
        await resolveMerged(group, "discard");
        return;
      }
      for (const id of ids) {
        await fetch("/api/luna/knowledge", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ id, status: "archived" })
        });
      }
      setToast("폐기했습니다");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <KnowledgeShell>
      <div
        className="mb-3.5 rounded-[9px] px-3.5 py-2.5 text-[13px]"
        style={{ background: K.candSoft, color: K.candInk }}
      >
        보류 중인 지식은 루나가 답변에 사용하지 않습니다. 확정해 주세요.
      </div>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <div className="space-y-3.5">
          {conflicts.length === 0 ? (
            <p className="text-[13px]" style={{ color: K.faint }}>
              보류 중인 충돌이 없습니다.
            </p>
          ) : (
            conflicts.map((c) => (
              <div
                key={c.group}
                className="rounded-[12px] border px-4 py-4"
                style={{ background: K.panel, borderColor: "#f0d9cf" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge kind="warn">의견 충돌</Badge>
                  <span className="text-[12px]" style={{ color: K.sub }}>
                    {c.title} · {c.options.length}건
                  </span>
                  {c.pending_days != null ? (
                    <Meta>보류 {c.pending_days}일째</Meta>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 min-[901px]:grid-cols-2">
                  {c.options.map((opt) => (
                    <div
                      key={opt.id}
                      className="rounded-[9px] border px-3 py-3"
                      style={{ borderColor: K.line }}
                    >
                      <p className="text-[14px] leading-[1.55]">{opt.content}</p>
                      <p className="mb-2.5 mt-1.5 text-[11.5px]" style={{ color: K.sub }}>
                        {opt.author_name || "—"} ·{" "}
                        {formatKnowledgeDate(opt.created_at)} ·{" "}
                        {sourceLabel(opt.source, opt.origin)}
                      </p>
                      <Btn
                        className="w-full"
                        disabled={busy === c.group}
                        onClick={() =>
                          void (c.kind === "group"
                            ? resolveGroup(c.group, opt.id)
                            : resolveMerged(c.group, "keep_one", opt.id))
                        }
                      >
                        이걸로 확정
                      </Btn>
                    </div>
                  ))}
                </div>

                <div
                  className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                  style={{ borderColor: K.line2 }}
                >
                  <Btn primary disabled>
                    병합해서 확정
                  </Btn>
                  <Btn
                    disabled={busy === c.group}
                    onClick={() =>
                      void discardGroup(
                        c.group,
                        c.kind,
                        c.options.map((o) => o.id)
                      )
                    }
                  >
                    둘 다 폐기
                  </Btn>
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    병합 시 두 문장을 합친 초안을 루나가 만들어 줍니다
                  </span>
                </div>
              </div>
            ))
          )}

          <div>
            <div className="mb-2 text-[13px] font-bold">처리 이력</div>
            <ListCard>
              {history.length === 0 ? (
                <ListItem>
                  <p className="text-[13px]" style={{ color: K.faint }}>
                    처리 이력이 없습니다.
                  </p>
                </ListItem>
              ) : (
                history.map((h) => {
                  const badgeKind =
                    h.label === "병합 확정" || h.label === "확정"
                      ? "ok"
                      : h.label === "폐기"
                        ? "src"
                        : "src";
                  return (
                    <ListItem key={h.id}>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Badge kind={badgeKind}>{h.label}</Badge>
                        <span
                          className="min-w-0 flex-1 truncate text-[13px]"
                          style={{
                            color: h.label === "폐기" ? K.sub : K.ink
                          }}
                          title={h.summary}
                        >
                          {h.summary}
                        </span>
                        <Meta>
                          {formatKnowledgeDate(h.resolved_at).slice(5)} ·{" "}
                          {h.resolver_name || "—"}
                        </Meta>
                      </div>
                    </ListItem>
                  );
                })
              )}
            </ListCard>
          </div>
        </div>
      ) : null}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </KnowledgeShell>
  );
}
