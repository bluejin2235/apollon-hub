"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LunaConsolidateBox } from "@/components/luna/knowledge/LunaConsolidateBox";
import {
  Badge,
  Btn,
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
  clipText,
  formatKnowledgeDate,
  scopeLabel,
  sourceLabel,
  K
} from "@/lib/luna/knowledge-format";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

type KnowledgeItem = {
  id: string;
  content: string;
  use_count: number | null;
  last_used_at: string | null;
  resolved_at: string | null;
  created_at: string;
  scope_suggestion: string | null;
  source: string | null;
  origin: string | null;
  evidence: string | null;
  author_name: string | null;
  source_conversation_id: string | null;
  source_id: string | null;
  source_title: string | null;
};

type VersionRow = {
  id: string;
  version: number;
  content: string;
  status: string | null;
  change_note: string | null;
  editor_name: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  org: number;
  personal: number;
  week_new: number;
};

type SortKey = "recent" | "most_used" | "oldest";
type ScopeKey = "all" | "org" | "personal";
type PanelMode = "edit" | "hold" | "archive" | null;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaKnowledgeTab() {
  const router = useRouter();
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
  const [canManage, setCanManage] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, VersionRow[]>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode>(null);
  const [editContent, setEditContent] = useState("");
  const [editScope, setEditScope] = useState<"org" | "personal">("org");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

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
      setCanManage(false);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      items?: KnowledgeItem[];
      total?: number;
      stats?: Stats | null;
      can_manage?: boolean;
    };
    setItems(json.items ?? []);
    setTotal(json.total ?? 0);
    setStats(json.stats ?? null);
    setCanManage(json.can_manage === true);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadDetail(id: string) {
    const token = await getAccessToken();
    if (!token) return;
    setDetailLoading(id);
    try {
      const res = await fetch(`/api/luna/knowledge?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        item?: KnowledgeItem;
        versions?: VersionRow[];
        can_manage?: boolean;
      };
      if (json.can_manage === true) setCanManage(true);
      if (json.item) {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, ...json.item } : it))
        );
      }
      setVersions((prev) => ({ ...prev, [id]: json.versions ?? [] }));
    } finally {
      setDetailLoading(null);
    }
  }

  function toggleExpand(item: KnowledgeItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      setPanel(null);
      setChangeNote("");
      return;
    }
    setExpandedId(item.id);
    setPanel(null);
    setChangeNote("");
    setEditContent(item.content);
    setEditScope(
      item.scope_suggestion === "personal" ? "personal" : "org"
    );
    if (!versions[item.id]) void loadDetail(item.id);
  }

  async function patchLearning(payload: {
    id: string;
    status?: string;
    content?: string;
    scope_suggestion?: "org" | "personal" | null;
    change_note: string;
  }) {
    const token = await getAccessToken();
    if (!token) return false;
    const res = await fetch("/api/luna/knowledge", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      setToast(`저장 실패: ${await res.text()}`);
      return false;
    }
    return true;
  }

  async function saveEdit(id: string) {
    if (!canManage || busy) return;
    if (!editContent.trim() || !changeNote.trim()) {
      setToast("내용과 변경 사유를 입력하세요");
      return;
    }
    setBusy(true);
    const ok = await patchLearning({
      id,
      content: editContent.trim(),
      scope_suggestion: editScope,
      change_note: changeNote.trim()
    });
    setBusy(false);
    if (!ok) return;
    setToast("수정했습니다");
    setPanel(null);
    setChangeNote("");
    setExpandedId(null);
    void load();
  }

  async function saveHold(id: string) {
    if (!canManage || busy) return;
    if (!changeNote.trim()) {
      setToast("보류 사유를 입력하세요");
      return;
    }
    setBusy(true);
    const ok = await patchLearning({
      id,
      status: "conflict",
      change_note: changeNote.trim()
    });
    setBusy(false);
    if (!ok) return;
    setToast("보류했습니다 · 충돌 보류함에서 다시 처리할 수 있어요");
    setPanel(null);
    setChangeNote("");
    setExpandedId(null);
    void load();
  }

  async function saveArchive(id: string) {
    if (!canManage || busy) return;
    if (!changeNote.trim()) {
      setToast("폐기 사유를 입력하세요");
      return;
    }
    const confirmed = window.confirm(
      "이 지식을 폐기하면 루나가 더 이상 사용하지 않습니다"
    );
    if (!confirmed) return;
    setBusy(true);
    const ok = await patchLearning({
      id,
      status: "archived",
      change_note: changeNote.trim()
    });
    setBusy(false);
    if (!ok) return;
    setToast("폐기했습니다 (archived · 복구 가능)");
    setPanel(null);
    setChangeNote("");
    setExpandedId(null);
    void load();
  }

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
          <option value="recent">최근 등록순</option>
          <option value="most_used">많이 쓰인 순</option>
          <option value="oldest">오래된 순</option>
        </FieldSelect>
      </Toolbar>

      {toast ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {toast}
        </p>
      ) : null}
      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <>
          <ListCard>
            {items.length === 0 ? (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  아폴론 지식이 없습니다.
                </p>
              </ListItem>
            ) : (
              items.map((item) => {
                const sc = scopeLabel(item.scope_suggestion);
                const date = formatKnowledgeDate(
                  item.resolved_at ?? item.created_at
                );
                const uses = item.use_count ?? 0;
                const evidence =
                  item.evidence?.trim() ||
                  (item.author_name ? item.author_name : null);
                const open = expandedId === item.id;
                const vers = versions[item.id] ?? [];

                return (
                  <ListItem key={item.id}>
                    <button
                      type="button"
                      className="w-full cursor-pointer text-left"
                      onClick={() => toggleExpand(item)}
                    >
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
                        className={`my-2 text-[14px] leading-[1.6] ${
                          open ? "" : "line-clamp-3"
                        }`}
                        title={item.content}
                      >
                        {item.content}
                      </p>
                      <p className="text-[12px]" style={{ color: K.sub }}>
                        근거: {evidence || "—"}
                        {item.source_id || item.source_conversation_id
                          ? " · 원문 보기"
                          : ""}
                      </p>
                    </button>

                    {open ? (
                      <div
                        className="mt-3 rounded-[9px] border px-3 py-3"
                        style={{ borderColor: K.line, background: "#fbfaff" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          className="mb-2 text-[10px] font-semibold uppercase"
                          style={{ color: K.faint }}
                        >
                          상세
                        </div>
                        <p className="text-[13.5px] leading-[1.7]">{item.content}</p>

                        <div
                          className="mt-3 space-y-1 text-[12.5px]"
                          style={{ color: K.sub }}
                        >
                          <div>
                            근거: {evidence || "—"}
                            {item.source_id ? (
                              <>
                                {" · "}
                                <button
                                  type="button"
                                  className="font-bold text-[#0F6E56] underline-offset-2 hover:underline"
                                  onClick={() =>
                                    router.push(
                                      buildLunaSettingsUrl("talk", "sources", {
                                        source: item.source_id!
                                      })
                                    )
                                  }
                                >
                                  {item.source_title
                                    ? clipText(item.source_title, 28)
                                    : "구술·문서에서 보기"}
                                </button>
                              </>
                            ) : null}
                          </div>
                          <div>
                            사용 {uses}회 · 최근 사용{" "}
                            {formatKnowledgeDate(item.last_used_at)} · 등록{" "}
                            {formatKnowledgeDate(
                              item.resolved_at ?? item.created_at
                            )}{" "}
                            · 범위 {sc?.label ?? "—"}
                          </div>
                        </div>

                        <div className="mt-3">
                          <div
                            className="mb-1.5 text-[10px] font-semibold uppercase"
                            style={{ color: K.faint }}
                          >
                            변경 이력
                          </div>
                          {detailLoading === item.id ? (
                            <p className="text-[12px]" style={{ color: K.faint }}>
                              이력 불러오는 중…
                            </p>
                          ) : vers.length === 0 ? (
                            <p className="text-[12px]" style={{ color: K.faint }}>
                              이력이 없습니다
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {vers.map((v) => (
                                <li
                                  key={v.id}
                                  className="rounded-[8px] border px-2.5 py-2 text-[12px]"
                                  style={{ borderColor: K.line2 }}
                                >
                                  <div className="flex flex-wrap gap-2">
                                    <b>v{v.version}</b>
                                    <span style={{ color: K.faint }}>
                                      {formatKnowledgeDate(v.created_at)}
                                    </span>
                                    <span style={{ color: K.sub }}>
                                      {v.editor_name || "—"}
                                    </span>
                                  </div>
                                  <div style={{ color: K.sub }}>
                                    {v.change_note || "—"}
                                  </div>
                                  <div
                                    className="mt-0.5 line-clamp-2 leading-[1.5]"
                                    style={{ color: K.faint }}
                                  >
                                    {clipText(v.content, 120)}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {!canManage ? (
                          <p
                            className="mt-3 text-[11.5px]"
                            style={{ color: K.faint }}
                          >
                            수정·보류·폐기는 슈퍼관리자만 할 수 있어요
                          </p>
                        ) : null}

                        {panel === null ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Btn
                              primary
                              disabled={!canManage || busy}
                              onClick={() => {
                                setPanel("edit");
                                setEditContent(item.content);
                                setEditScope(
                                  item.scope_suggestion === "personal"
                                    ? "personal"
                                    : "org"
                                );
                                setChangeNote("");
                              }}
                            >
                              수정
                            </Btn>
                            <Btn
                              disabled={!canManage || busy}
                              onClick={() => {
                                setPanel("hold");
                                setChangeNote("");
                              }}
                            >
                              보류
                            </Btn>
                            <Btn
                              disabled={!canManage || busy}
                              onClick={() => {
                                setPanel("archive");
                                setChangeNote("");
                              }}
                            >
                              폐기
                            </Btn>
                          </div>
                        ) : null}

                        {panel === "edit" ? (
                          <div className="mt-3">
                            <div
                              className="mb-1 text-[10px] font-semibold"
                              style={{ color: K.faint }}
                            >
                              내용
                            </div>
                            <textarea
                              className="w-full resize-y rounded-[9px] border px-[11px] py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
                              style={{
                                borderColor: K.line,
                                background: K.panel,
                                minHeight: 70
                              }}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                            />
                            <div className="mt-2 max-w-[220px]">
                              <div
                                className="mb-1 text-[10px] font-semibold"
                                style={{ color: K.faint }}
                              >
                                범위
                              </div>
                              <FieldSelect
                                className="w-full"
                                value={editScope}
                                onChange={(e) =>
                                  setEditScope(
                                    e.target.value === "personal"
                                      ? "personal"
                                      : "org"
                                  )
                                }
                              >
                                <option value="org">조직</option>
                                <option value="personal">개인</option>
                              </FieldSelect>
                            </div>
                            <div className="mt-2">
                              <div
                                className="mb-1 text-[10px] font-semibold"
                                style={{ color: K.faint }}
                              >
                                변경 사유 (필수)
                              </div>
                              <FieldInput
                                className="w-full"
                                placeholder="예: 표현 다듬음 · 날짜 정정"
                                value={changeNote}
                                onChange={(e) => setChangeNote(e.target.value)}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Btn
                                primary
                                disabled={busy}
                                onClick={() => void saveEdit(item.id)}
                              >
                                저장
                              </Btn>
                              <Btn
                                onClick={() => {
                                  setPanel(null);
                                  setChangeNote("");
                                }}
                              >
                                취소
                              </Btn>
                            </div>
                          </div>
                        ) : null}

                        {panel === "hold" ? (
                          <div className="mt-3">
                            <p
                              className="mb-2 text-[12.5px] leading-snug"
                              style={{ color: K.candInk }}
                            >
                              보류하면 루나가 답변에 쓰지 않습니다. 충돌
                              보류함에서 다시 처리할 수 있어요.
                            </p>
                            <FieldInput
                              className="w-full"
                              placeholder="보류 사유 (필수)"
                              value={changeNote}
                              onChange={(e) => setChangeNote(e.target.value)}
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Btn
                                primary
                                disabled={busy}
                                onClick={() => void saveHold(item.id)}
                              >
                                보류하기
                              </Btn>
                              <Btn
                                onClick={() => {
                                  setPanel(null);
                                  setChangeNote("");
                                }}
                              >
                                취소
                              </Btn>
                            </div>
                          </div>
                        ) : null}

                        {panel === "archive" ? (
                          <div className="mt-3">
                            <p
                              className="mb-2 text-[12.5px] leading-snug"
                              style={{ color: K.candInk }}
                            >
                              이 지식을 폐기하면 루나가 더 이상 사용하지
                              않습니다. 완전 삭제가 아니라 archived 로
                              남겨 복구할 수 있어요.
                            </p>
                            <FieldInput
                              className="w-full"
                              placeholder="폐기 사유 (필수)"
                              value={changeNote}
                              onChange={(e) => setChangeNote(e.target.value)}
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Btn
                                primary
                                disabled={busy}
                                onClick={() => void saveArchive(item.id)}
                              >
                                폐기하기
                              </Btn>
                              <Btn
                                onClick={() => {
                                  setPanel(null);
                                  setChangeNote("");
                                }}
                              >
                                취소
                              </Btn>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </ListItem>
                );
              })
            )}
          </ListCard>

          {pageCount > 1 ? (
            <div
              className="mt-3 flex items-center justify-center gap-2 text-[12px]"
              style={{ color: K.sub }}
            >
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
            행 클릭 시 상세 — 전체 문장 · 근거 원문 · 사용 이력 · 수정 / 보류 /
            폐기
          </Hint>
        </>
      ) : null}

      <LunaConsolidateBox />
    </KnowledgeShell>
  );
}
