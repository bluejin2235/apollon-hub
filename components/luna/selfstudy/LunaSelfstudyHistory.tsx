"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  ErrorLine,
  KnowledgeShell,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { Chip, DayLabel, getAccessToken } from "@/components/luna/selfstudy/shared";
import { K } from "@/lib/luna/knowledge-format";

type StatusKind = "pending" | "confirmed" | "not_needed" | "rejected";
type Filter = "all" | "confirmed" | "pending" | "dropped";

type Item = {
  id: string;
  status_kind: StatusKind;
  source_note: string;
  question: string | null;
  answer: string;
  found: string | null;
};

type Group = {
  key: string;
  label: string;
  items: Item[];
};

type Payload = {
  stats: {
    total: number;
    confirmed: number;
    pending: number;
    dropped: number;
    accuracy_pct: number | null;
  };
  filter_counts: Record<Filter, number>;
  next_run_label: string;
  groups: Group[];
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "confirmed", label: "확정됨" },
  { key: "pending", label: "대기 중" },
  { key: "dropped", label: "틀림 · 안 배워도 됨" }
];

function statusBadge(kind: StatusKind): {
  label: string;
  badge: "wait" | "ok" | "src" | "red";
} {
  if (kind === "pending") return { label: "대기 중", badge: "wait" };
  if (kind === "confirmed") return { label: "확정됨", badge: "ok" };
  if (kind === "not_needed") return { label: "안 배워도 됨", badge: "src" };
  return { label: "틀림", badge: "red" };
}

export function LunaSelfstudyHistory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async (f: Filter) => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/luna/selfstudy/history?filter=${f}`, {
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
    void load(filter);
  }, [filter, load]);

  if (loading) {
    return (
      <KnowledgeShell>
        <LoadingLine />
      </KnowledgeShell>
    );
  }

  const stats = data?.stats;
  const groups = data?.groups ?? [];

  return (
    <KnowledgeShell>
      {error ? <ErrorLine message={error} /> : null}

      <StatGrid>
        <StatCard label="누적 문답" value={stats?.total ?? "—"} />
        <StatCard
          label="기억으로 확정"
          value={
            stats ? (
              <span style={{ color: K.talk }}>{stats.confirmed}</span>
            ) : (
              "—"
            )
          }
        />
        <StatCard
          label="자습 정확도"
          value={
            stats?.accuracy_pct != null ? (
              <>
                {stats.accuracy_pct}
                <span className="text-[13px] font-normal">%</span>
              </>
            ) : (
              "—"
            )
          }
        />
        <StatCard label="다음 실행" value={data?.next_run_label ?? "—"} small />
      </StatGrid>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            {data?.filter_counts?.[f.key] != null
              ? ` ${data.filter_counts[f.key]}`
              : ""}
          </Chip>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          자습 이력이 없습니다
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <DayLabel>
              {g.label} · {g.items.length}문답
            </DayLabel>
            <div
              className="mb-3.5 overflow-hidden rounded-[12px] border"
              style={{ background: K.panel, borderColor: K.line }}
            >
              {g.items.map((item) => {
                const b = statusBadge(item.status_kind);
                const muted =
                  item.status_kind === "rejected" ||
                  item.status_kind === "not_needed";
                return (
                  <div
                    key={item.id}
                    className="border-b px-4 py-[13px] last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge kind={b.badge}>{b.label}</Badge>
                      <span className="text-[11.5px]" style={{ color: K.faint }}>
                        {item.source_note}
                      </span>
                    </div>
                    {item.question ? (
                      <div
                        className="mb-[3px] mt-2 text-[12.5px]"
                        style={{ color: K.sub }}
                      >
                        Q. {item.question}
                      </div>
                    ) : null}
                    <div
                      className="text-[13.5px] leading-relaxed"
                      style={{ color: muted ? K.sub : K.ink }}
                    >
                      A. {item.answer || "—"}
                    </div>
                    {item.found ? (
                      <div
                        className="mt-1.5 text-[11.5px]"
                        style={{ color: K.faint }}
                      >
                        {item.found}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </KnowledgeShell>
  );
}
