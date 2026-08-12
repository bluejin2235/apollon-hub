"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  ListCard,
  LoadingLine,
  Toolbar
} from "@/components/luna/knowledge/ui";
import {
  brainFetch,
  formatDateTime,
  SectionTitle
} from "@/components/luna/brain/shared";
import { clipText, K } from "@/lib/luna/knowledge-format";
import {
  formatPromptNumber,
  isHumanOnlyPromptLevel,
  type LunaPromptGroupRow,
  type LunaPromptRow,
  type LunaPromptVersionRow
} from "@/lib/luna/prompts";

type PromptsResponse = {
  prompts?: LunaPromptRow[];
  groups?: LunaPromptGroupRow[];
};

type Draft = {
  title: string;
  description: string;
  purpose: string;
  content: string;
  sort_order: number;
  change_summary: string;
  prediction: string;
};

function toDraft(p: LunaPromptRow): Draft {
  return {
    title: p.title ?? "",
    description: p.description ?? "",
    purpose: p.purpose ?? "",
    content: p.content ?? "",
    sort_order: p.sort_order ?? 0,
    change_summary: "",
    prediction: ""
  };
}

function EditLabel({ className = "" }: { className?: string }) {
  return (
    <span className={`text-[11.5px] ${className}`} style={{ color: K.faint }}>
      사람만 수정
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[12px]" style={{ color: K.sub }}>
      {children}
    </span>
  );
}

const AREA_CLASS =
  "w-full rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]";

export function LunaBrainPrompts() {
  const [prompts, setPrompts] = useState<LunaPromptRow[]>([]);
  const [groups, setGroups] = useState<LunaPromptGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<PromptsResponse>("/api/luna/prompts");
      setPrompts(json.prompts ?? []);
      setGroups(json.groups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activePrompts = useMemo(
    () => prompts.filter((p) => p.is_active),
    [prompts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activePrompts;
    return activePrompts.filter((p) => {
      const num = formatPromptNumber(p).toLowerCase();
      return num.includes(q) || (p.title ?? "").toLowerCase().includes(q);
    });
  }, [activePrompts, query]);

  const sections = useMemo(() => {
    const ordered = groups
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        group: g,
        items: filtered
          .filter((p) => (p.group_name ?? p.level) === g.group_key)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      }));
    return ordered.filter((s) => s.items.length > 0);
  }, [groups, filtered]);

  const allHistory = useMemo(() => {
    const rows: Array<LunaPromptVersionRow & { number: string; promptName: string }> =
      [];
    for (const p of prompts) {
      for (const v of p.versions ?? []) {
        rows.push({
          ...v,
          number: formatPromptNumber(p),
          promptName: p.title ?? "제목 없음"
        });
      }
    }
    return rows
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 50);
  }, [prompts]);

  function openRow(p: LunaPromptRow) {
    setNotice("");
    if (openId === p.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(p.id);
    setDraft(toDraft(p));
  }

  async function save(p: LunaPromptRow) {
    if (!draft) return;
    if (!draft.change_summary.trim() || !draft.prediction.trim()) {
      setNotice("변경 요약과 예측을 모두 적어야 저장할 수 있습니다.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/prompts", {
        method: "PATCH",
        body: JSON.stringify({
          id: p.id,
          title: draft.title,
          description: draft.description,
          purpose: draft.purpose,
          content: draft.content,
          sort_order: draft.sort_order,
          change_summary: draft.change_summary.trim(),
          prediction: draft.prediction.trim()
        })
      });
      setOpenId(null);
      setDraft(null);
      setNotice("저장했습니다. 회귀 시험이 자동 실행됩니다.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revert(p: LunaPromptRow, version: number) {
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/prompts/revert", {
        method: "POST",
        body: JSON.stringify({ id: p.id, version })
      });
      setOpenId(null);
      setDraft(null);
      setNotice(`v${version} 내용으로 되돌렸습니다.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function renderEditor(p: LunaPromptRow) {
    if (!draft) return null;
    const versions = (p.versions ?? []).slice(0, 8);
    return (
      <div
        className="border-b px-4 py-4"
        style={{ borderColor: K.line2, background: "#fbfbfd" }}
      >
        <div className="grid grid-cols-1 gap-4 min-[901px]:grid-cols-[1fr_260px]">
          <div className="min-w-0">
            <label className="mb-2.5 block">
              <FieldLabel>제목</FieldLabel>
              <FieldInput
                className="w-full"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="mb-2.5 block">
              <FieldLabel>부가 설명</FieldLabel>
              <FieldInput
                className="w-full"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="mb-2.5 block">
              <FieldLabel>목적</FieldLabel>
              <textarea
                rows={2}
                className={AREA_CLASS}
                style={{ borderColor: K.line, background: K.panel, color: K.ink }}
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
              />
            </label>
            <label className="mb-2.5 block">
              <FieldLabel>프롬프트 본문</FieldLabel>
              <textarea
                rows={14}
                className={`${AREA_CLASS} font-mono text-[12px] leading-relaxed`}
                style={{ borderColor: K.line, background: K.panel, color: K.ink }}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-2">
              <label className="block">
                <FieldLabel>변경 요약 (필수)</FieldLabel>
                <FieldInput
                  className="w-full"
                  value={draft.change_summary}
                  placeholder="무엇을 왜 바꿨는지"
                  onChange={(e) =>
                    setDraft({ ...draft, change_summary: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <FieldLabel>예측 (필수)</FieldLabel>
                <FieldInput
                  className="w-full"
                  value={draft.prediction}
                  placeholder="이 변경으로 무엇이 나아질지"
                  onChange={(e) => setDraft({ ...draft, prediction: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn primary disabled={busy} onClick={() => void save(p)}>
                저장
              </Btn>
              <Btn
                disabled={busy}
                onClick={() => {
                  setOpenId(null);
                  setDraft(null);
                }}
              >
                닫기
              </Btn>
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                저장하면 회귀 시험이 자동 실행됩니다
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-1.5 text-[12px] font-bold">변경 이력</div>
            {versions.length === 0 ? (
              <p className="text-[12px]" style={{ color: K.faint }}>
                아직 변경 이력이 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="rounded-[9px] border px-2.5 py-2"
                    style={{ borderColor: K.line, background: K.panel }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11.5px] font-bold">v{v.version}</span>
                      {v.changed_by_luna ? (
                        <Badge kind="wait">루나</Badge>
                      ) : (
                        <Badge kind="src">사람</Badge>
                      )}
                      <span
                        className="ml-auto text-[11px]"
                        style={{ color: K.faint }}
                      >
                        {formatDateTime(v.created_at)}
                      </span>
                    </div>
                    {v.change_summary ? (
                      <p
                        className="mt-1 text-[11.5px] leading-snug"
                        style={{ color: K.sub }}
                      >
                        {clipText(v.change_summary, 90)}
                      </p>
                    ) : null}
                    {v.verify_note ? (
                      <p className="mt-1 text-[11px]" style={{ color: K.faint }}>
                        {v.verify_note}
                      </p>
                    ) : null}
                    {v.version < p.version ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void revert(p, v.version)}
                        className="mt-1.5 cursor-pointer text-[11.5px] font-bold underline-offset-2 hover:underline disabled:opacity-50"
                        style={{ color: K.luna }}
                      >
                        이 버전으로 되돌리기
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <KnowledgeShell>
      <Toolbar>
        <FieldInput
          className="min-w-[180px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="번호 또는 이름으로 찾기"
        />
        <Btn onClick={() => setShowAllHistory((v) => !v)}>
          {showAllHistory ? "목록으로" : "변경 이력 전체"}
        </Btn>
      </Toolbar>

      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && !error && showAllHistory ? (
        allHistory.length === 0 ? (
          <p className="text-[12px]" style={{ color: K.faint }}>
            변경 이력이 없습니다.
          </p>
        ) : (
          <ListCard>
            {allHistory.map((v) => (
              <div
                key={v.id}
                className="flex flex-wrap items-center gap-2.5 border-b px-4 py-2.5 last:border-b-0"
                style={{ borderColor: K.line2 }}
              >
                <span className="w-[46px] text-[11px]" style={{ color: K.faint }}>
                  {v.number}
                </span>
                <span className="text-[13px]">{v.promptName}</span>
                {v.changed_by_luna ? (
                  <Badge kind="wait">루나</Badge>
                ) : (
                  <Badge kind="src">사람</Badge>
                )}
                <span
                  className="min-w-0 flex-1 truncate text-[11.5px]"
                  style={{ color: K.sub }}
                >
                  {v.change_summary ?? "—"}
                </span>
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  v{v.version}
                </span>
                <span
                  className="w-[78px] text-right text-[11.5px]"
                  style={{ color: K.faint }}
                >
                  {formatDateTime(v.created_at)}
                </span>
              </div>
            ))}
          </ListCard>
        )
      ) : null}

      {!loading && !error && !showAllHistory ? (
        sections.length === 0 ? (
          <p className="text-[12px]" style={{ color: K.faint }}>
            {query.trim() ? "찾는 프롬프트가 없습니다." : "프롬프트가 없습니다."}
          </p>
        ) : (
          sections.map(({ group, items }) => (
            <div key={group.group_key}>
              <div className="mb-1.5 text-[12px]" style={{ color: K.sub }}>
                {group.group_key} {group.label}
                {group.tagline ? ` · ${group.tagline}` : ""}
                {group.when_runs ? (
                  <span style={{ color: K.faint }}> — {group.when_runs}</span>
                ) : null}
              </div>
              <div className="mb-3">
                <ListCard>
                  {items.map((p) => {
                    const open = openId === p.id;
                    return (
                      <div key={p.id}>
                        <button
                          type="button"
                          onClick={() => openRow(p)}
                          className="flex w-full cursor-pointer items-center gap-2.5 border-b px-4 py-2.5 text-left last:border-b-0"
                          style={{
                            borderColor: K.line2,
                            background: open ? "#fbfbfd" : undefined
                          }}
                        >
                          <span
                            className="w-[46px] shrink-0 text-[11px]"
                            style={{ color: K.faint }}
                          >
                            {formatPromptNumber(p)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px]">
                            {p.title}
                          </span>
                          {p.description ? (
                            <span
                              className="hidden max-w-[220px] shrink-0 truncate text-[11.5px] min-[901px]:inline"
                              style={{ color: K.faint }}
                            >
                              {p.description}
                            </span>
                          ) : null}
                          {p.changed_by_luna ? (
                            <Badge kind="wait">루나 수정</Badge>
                          ) : null}
                          {isHumanOnlyPromptLevel(p.level) ? <EditLabel /> : null}
                          <span
                            className="w-[78px] shrink-0 text-right text-[11.5px]"
                            style={{ color: K.faint }}
                          >
                            v{p.version}
                          </span>
                        </button>
                        {open ? renderEditor(p) : null}
                      </div>
                    );
                  })}
                </ListCard>
              </div>
            </div>
          ))
        )
      ) : null}

      {!loading && !error && !showAllHistory && sections.length > 0 ? (
        <SectionTitle className="mt-3 font-normal">
          <span className="text-[12px] font-normal" style={{ color: K.faint }}>
            활성 프롬프트 {activePrompts.length}개 · L1·L5는 루나가 스스로 고칠 수
            없습니다
          </span>
        </SectionTitle>
      ) : null}
    </KnowledgeShell>
  );
}
