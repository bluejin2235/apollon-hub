"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  ErrorLine,
  KnowledgeShell,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { getAccessToken, InfoBar } from "@/components/luna/selfstudy/shared";
import { K } from "@/lib/luna/knowledge-format";

type Kind =
  | "search_zero"
  | "clarify_unresolved"
  | "correction"
  | "thumbs_down"
  | "eval_quality";

type Item = {
  key: string;
  kind: Kind;
  user_name: string;
  conversation_id: string;
  time_label: string;
  title: string;
  detail: string;
  excluded: boolean;
  already_learned: boolean;
  planned: boolean;
};

type Payload = {
  counts: Record<Kind, number>;
  planned_count: number;
  total: number;
  run_time_label: string;
  next_run_label: string;
  items: Item[];
};

function kindBadge(kind: Kind): { label: string; badge: "warn" | "org" | "ok" | "src" } {
  if (kind === "search_zero") return { label: "검색 0건", badge: "warn" };
  if (kind === "clarify_unresolved")
    return { label: "되묻기 미해소", badge: "org" };
  if (kind === "eval_quality") return { label: "시험 품질", badge: "src" };
  if (kind === "thumbs_down") return { label: "싫어요", badge: "warn" };
  return { label: "정정받음", badge: "ok" };
}

export function LunaSelfstudyStuck() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/luna/selfstudy/stuck", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(`불러오기 실패 (${res.status})`);
        return;
      }
      setData((await res.json()) as Payload);
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleExclude(item: Item) {
    const token = await getAccessToken();
    if (!token) return;
    setBusyKey(item.key);
    setMessage("");
    try {
      const res = await fetch("/api/luna/selfstudy/stuck", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ key: item.key, excluded: !item.excluded })
      });
      if (!res.ok) {
        setMessage(`처리 실패: ${await res.text()}`);
        return;
      }
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function runNow() {
    const token = await getAccessToken();
    if (!token) return;
    setRunning(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/selfstudy", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ force: true })
      });
      if (!res.ok) {
        setMessage(
          res.status === 403
            ? "지금 실행은 슈퍼관리자만 가능합니다"
            : `실행 실패: ${await res.text()}`
        );
        return;
      }
      const json = (await res.json()) as { submitted?: number; message?: string };
      setMessage(json.message || `자습 ${json.submitted ?? 0}건 제출`);
      await load();
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <KnowledgeShell>
        <LoadingLine />
      </KnowledgeShell>
    );
  }

  const items = data?.items ?? [];

  return (
    <KnowledgeShell>
      {error ? <ErrorLine message={error} /> : null}
      {message ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {message}
        </p>
      ) : null}

      <InfoBar>
        오늘 대화에서 루나가 막힌 순간들입니다. 이 중에서만 오늘 밤 자습 주제를
        고릅니다 — 임의 주제는 만들지 않아요.
      </InfoBar>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 min-[901px]:grid-cols-3">
        <StatCard label="검색 0건" value={data?.counts.search_zero ?? "—"} />
        <StatCard
          label="되묻기 미해소"
          value={data?.counts.clarify_unresolved ?? "—"}
        />
        <StatCard label="정정받음" value={data?.counts.correction ?? "—"} />
        <StatCard label="싫어요" value={data?.counts.thumbs_down ?? "—"} />
        <StatCard
          label="시험 품질"
          value={data?.counts.eval_quality ?? "—"}
        />
      </div>

      {items.length === 0 ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          오늘은 막힌 순간이 없습니다
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-[12px] border"
          style={{ background: K.panel, borderColor: K.line }}
        >
          {items.map((item) => {
            const b = kindBadge(item.kind);
            const busy = busyKey === item.key;
            const muted = item.already_learned || item.excluded;
            return (
              <div
                key={item.key}
                className="border-b px-4 py-[13px] last:border-b-0"
                style={{ borderColor: K.line2 }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge kind={b.badge}>{b.label}</Badge>
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    {item.user_name} · 오늘 {item.time_label}
                    {item.conversation_id ? " · " : ""}
                    {item.conversation_id ? (
                      <button
                        type="button"
                        className="cursor-pointer underline-offset-2 hover:underline"
                        style={{ color: K.faint }}
                        onClick={() =>
                          router.push(
                            `/settings?tab=luna&luna=talk&sub=history&conv=${item.conversation_id}`
                          )
                        }
                      >
                        원문 보기
                      </button>
                    ) : null}
                  </span>
                  <span className="ml-auto">
                    {item.already_learned ? (
                      <Badge kind="src">이미 확정됨 · 제외</Badge>
                    ) : item.excluded ? (
                      <Badge kind="src">자습 제외됨</Badge>
                    ) : item.planned ? (
                      <Badge kind="wait">오늘 밤 자습 예정</Badge>
                    ) : (
                      <Badge kind="src">선정 기준 꺼짐</Badge>
                    )}
                  </span>
                </div>

                <div
                  className="mt-2 text-[13.5px] leading-relaxed"
                  style={{ color: muted ? K.sub : K.ink }}
                >
                  {item.title || "—"}
                </div>
                <div className="mt-[3px] text-[12.5px]" style={{ color: K.sub }}>
                  {item.already_learned
                    ? "정정이 기억으로 확정되어 자습 대상에서 자동 제외"
                    : item.detail}
                </div>

                {item.already_learned ? null : (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Btn disabled={busy} onClick={() => void toggleExclude(item)}>
                      {item.excluded ? "자습에 다시 포함" : "자습에서 제외"}
                    </Btn>
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        router.push(
                          "/settings?tab=luna&luna=candidates&sub=pending"
                        )
                      }
                    >
                      내가 직접 알려주기
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[9px] px-3.5 py-3"
        style={{ background: K.panel }}
      >
        <div className="flex-1 text-[13px]" style={{ color: K.sub }}>
          오늘 밤 {data?.run_time_label ?? "03:00"}에 {data?.planned_count ?? 0}건을
          자습하고 지식후보로 제출합니다
        </div>
        <Btn disabled={running} onClick={() => void runNow()}>
          {running ? "실행 중…" : "지금 실행"}
        </Btn>
      </div>
    </KnowledgeShell>
  );
}
