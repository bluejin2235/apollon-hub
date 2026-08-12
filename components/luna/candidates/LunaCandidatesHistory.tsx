"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ErrorLine,
  FilterChip,
  getAccessToken,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/candidates/shared";
import { Badge, ListCard, ListItem, StatCard, StatGrid } from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";

type HistoryFilter = "all" | "confirmed" | "rejected" | "not_needed";

type Stats = {
  confirmed_total: number;
  rejected_total: number;
  not_needed_total: number;
  confirm_rate: number | null;
  avg_confirm_days: number | null;
};

type WeekBar = {
  label: string;
  count: number;
  current: boolean;
};

type HistoryItem = {
  id: string;
  content: string;
  status_kind: "confirmed" | "rejected" | "not_needed";
  source_label: string;
  resolved_at: string | null;
  resolved_name: string;
  resolved_short: string;
};

const FILTERS: { key: HistoryFilter; label: string; countKey: keyof Stats | "all" }[] = [
  { key: "all", label: "전체", countKey: "all" },
  { key: "confirmed", label: "확정", countKey: "confirmed_total" },
  { key: "rejected", label: "반려", countKey: "rejected_total" },
  { key: "not_needed", label: "안 배워도 됨", countKey: "not_needed_total" }
];

function statusBadge(kind: HistoryItem["status_kind"]) {
  if (kind === "confirmed") return { label: "확정", badge: "ok" as const };
  if (kind === "not_needed") return { label: "안 배워도 됨", badge: "src" as const };
  return { label: "반려", badge: "red" as const };
}

export function LunaCandidatesHistory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [weekly, setWeekly] = useState<WeekBar[]>([]);
  const [trendLabel, setTrendLabel] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});

  const load = useCallback(async (f: HistoryFilter) => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/luna/candidates/history?filter=${f}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(`불러오기 실패 (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        stats?: Stats;
        weekly_inflow?: WeekBar[];
        trend_label?: string;
        items?: HistoryItem[];
        filter_counts?: Record<string, number>;
      };
      setStats(json.stats ?? null);
      setWeekly(json.weekly_inflow ?? []);
      setTrendLabel(json.trend_label ?? "");
      setItems(json.items ?? []);
      setFilterCounts(json.filter_counts ?? {});
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const maxBar = Math.max(...weekly.map((w) => w.count), 1);

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

      <StatGrid>
        <StatCard
          label="누적 확정"
          value={stats?.confirmed_total ?? "—"}
        />
        <StatCard
          label="반려·폐기"
          value={stats?.rejected_total ?? "—"}
        />
        <StatCard
          label="확정률"
          value={
            stats?.confirm_rate != null ? `${stats.confirm_rate}%` : "—"
          }
        />
        <StatCard
          label="평균 확정 소요"
          value={
            stats?.avg_confirm_days != null ? (
              <>
                {stats.avg_confirm_days}
                <span className="text-[13px] font-normal">일</span>
              </>
            ) : (
              "—"
            )
          }
        />
      </StatGrid>

      <div
        className="mb-3.5 rounded-[12px] border px-4 py-3.5"
        style={{ background: K.panel, borderColor: K.line }}
      >
        <h4 className="text-[13px] font-bold">
          주간 유입 추이
          {trendLabel ? (
            <span
              className="float-right text-[11.5px] font-bold"
              style={{ color: K.talk }}
            >
              {trendLabel}
            </span>
          ) : null}
        </h4>
        {weekly.length > 0 ? (
          <div className="mt-2.5 flex h-[60px] items-end gap-2.5">
            {weekly.map((w) => (
              <div
                key={w.label}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <i
                  className="block w-full rounded-[2px]"
                  style={{
                    height: `${Math.max(8, (w.count / maxBar) * 52)}px`,
                    background: w.current ? K.cand : "#F5C4B3"
                  }}
                />
                <span className="text-[11px]" style={{ color: K.faint }}>
                  {w.label} · {w.count}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px]" style={{ color: K.faint }}>
            —
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f.countKey === "all"
              ? filterCounts.all
              : stats?.[f.countKey as keyof Stats];
          return (
            <FilterChip
              key={f.key}
              on={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {count != null ? ` ${count}` : ""}
            </FilterChip>
          );
        })}
      </div>

      {items.length === 0 ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          처리 이력이 없습니다
        </p>
      ) : (
        <ListCard>
          {items.map((item) => {
            const b = statusBadge(item.status_kind);
            return (
              <ListItem key={item.id}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge kind={b.badge}>{b.label}</Badge>
                  <span
                    className={`flex-1 text-[13px] ${
                      item.status_kind !== "confirmed" ? "" : ""
                    }`}
                    style={{
                      color: item.status_kind === "confirmed" ? K.ink : K.sub
                    }}
                  >
                    {item.content}
                  </span>
                  <span className="text-[11.5px]" style={{ color: K.faint }}>
                    {item.source_label}
                  </span>
                  <span
                    className="w-[100px] text-right text-[11.5px]"
                    style={{ color: K.faint }}
                  >
                    {item.resolved_short} · {item.resolved_name}
                  </span>
                </div>
              </ListItem>
            );
          })}
        </ListCard>
      )}
    </KnowledgeShell>
  );
}
