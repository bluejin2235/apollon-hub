"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  ErrorLine,
  FieldInput,
  FieldSelect,
  Hint,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine,
  Meta,
  StatCard,
  StatGrid,
  Toolbar
} from "@/components/luna/knowledge/ui";
import {
  formatKnowledgeDate,
  scopeLabel,
  sourceLabel
} from "@/lib/luna/knowledge-format";
import { K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type KnowledgeItem = {
  id: string;
  content: string;
  use_count: number | null;
  resolved_at: string | null;
  created_at: string;
  scope_suggestion: string | null;
  source: string | null;
  origin: string | null;
  evidence: string | null;
  author_name: string | null;
  source_conversation_id: string | null;
};

type Stats = {
  total: number;
  org: number;
  personal: number;
  week_new: number;
};

type SortKey = "recent" | "most_used" | "oldest";
type ScopeKey = "all" | "org" | "personal";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaKnowledgeTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      status: "active",
      sort,
      page: String(page)
    });
    if (scope !== "all") params.set("scope", scope);
    if (query) params.set("q", query);

    const res = await fetch(`/api/luna/knowledge?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      items?: KnowledgeItem[];
      total?: number;
      stats?: Stats | null;
    };
    setItems(json.items ?? []);
    setTotal(json.total ?? 0);
    setStats(json.stats ?? null);
    setLoading(false);
  }, [page, query, scope, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQuery(q.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const pageCount = Math.max(1, Math.ceil(total / 20));

  return (
    <KnowledgeShell>
      <StatGrid>
        <StatCard label="전체" value={stats ? stats.total : "—"} />
        <StatCard label="조직 지식" value={stats ? stats.org : "—"} />
        <StatCard label="개인 지식" value={stats ? stats.personal : "—"} />
        <StatCard
          label="이번 주 추가"
          value={stats && stats.week_new > 0 ? `+${stats.week_new}` : stats ? "—" : "—"}
          valueClassName={stats && stats.week_new > 0 ? "text-[#0F6E56]" : undefined}
        />
      </StatGrid>

      <Toolbar>
        <FieldInput
          className="min-w-[170px] flex-1"
          placeholder="지식 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FieldSelect
          value={scope}
          onChange={(e) => {
            setPage(1);
            setScope(e.target.value as ScopeKey);
          }}
        >
          <option value="all">전체 범위</option>
          <option value="org">조직</option>
          <option value="personal">개인</option>
        </FieldSelect>
        <FieldSelect
          value={sort}
          onChange={(e) => {
            setPage(1);
            setSort(e.target.value as SortKey);
          }}
        >
          <option value="recent">최근 확정순</option>
          <option value="most_used">많이 쓰인 순</option>
          <option value="oldest">오래된 순</option>
        </FieldSelect>
      </Toolbar>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <>
          <ListCard>
            {items.length === 0 ? (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  확정 지식이 없습니다.
                </p>
              </ListItem>
            ) : (
              items.map((item) => {
                const sc = scopeLabel(item.scope_suggestion);
                const date = formatKnowledgeDate(item.resolved_at ?? item.created_at);
                const uses = item.use_count ?? 0;
                const evidence =
                  item.evidence?.trim() ||
                  (item.author_name ? item.author_name : null);
                return (
                  <ListItem key={item.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      {sc ? <Badge kind={sc.badge}>{sc.label}</Badge> : null}
                      <Badge kind="src">
                        {sourceLabel(item.source, item.origin)}
                      </Badge>
                      <Meta>
                        사용 {uses}회 · {date}
                      </Meta>
                    </div>
                    <p
                      className="my-2 line-clamp-3 text-[14px] leading-[1.6]"
                      title={item.content}
                    >
                      {item.content}
                    </p>
                    <p className="text-[12px]" style={{ color: K.sub }}>
                      근거: {evidence || "—"}
                      {item.source_conversation_id ? " · 원문 보기" : ""}
                    </p>
                  </ListItem>
                );
              })
            )}
          </ListCard>

          {pageCount > 1 ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-[12px]" style={{ color: K.sub }}>
              <button
                type="button"
                disabled={page <= 1}
                className="rounded-[9px] border px-2 py-1 disabled:opacity-40"
                style={{ borderColor: K.line, background: K.panel }}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                이전
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                className="rounded-[9px] border px-2 py-1 disabled:opacity-40"
                style={{ borderColor: K.line, background: K.panel }}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                다음
              </button>
            </div>
          ) : null}

          <Hint>
            행 클릭 시 상세 — 전체 문장 · 근거 원문 · 사용 이력 · 수정 / 보류 / 삭제
          </Hint>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
