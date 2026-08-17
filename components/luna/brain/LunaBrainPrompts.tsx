"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import {
  brainFetch,
  formatDateTime
} from "@/components/luna/brain/shared";
import { clipText, K } from "@/lib/luna/knowledge-format";
import {
  formatPromptNumber,
  isHumanOnlyPromptLevel,
  type LunaPromptRow,
  type LunaPromptVersionRow
} from "@/lib/luna/prompts";
import {
  PROMPT_STAGES,
  promptDisplayBadge,
  type PromptDisplayBadge
} from "@/lib/luna/prompt-stages";
import {
  LensDepartmentBadges,
  useDepartmentLens
} from "@/components/luna/brain/LunaDepartmentLens";

type PromptsResponse = {
  prompts?: LunaPromptRow[];
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[12px]" style={{ color: K.sub }}>
      {children}
    </span>
  );
}

const AREA_CLASS =
  "w-full rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]";

function charCount(text: string | null | undefined): string {
  return `${(text ?? "").length.toLocaleString("ko-KR")}자`;
}

function BadgeChip({ kind }: { kind: PromptDisplayBadge }) {
  if (kind === "core") {
    return (
      <span
        className="ml-[7px] align-[2px] rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold"
        style={{ background: "#FAEEDA", color: "#B0552F" }}
      >
        핵심
      </span>
    );
  }
  if (kind === "always") {
    return (
      <span
        className="ml-[7px] align-[2px] rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold"
        style={{ background: K.lunaSoft, color: K.lunaInk }}
      >
        항상
      </span>
    );
  }
  return (
    <span
      className="ml-[7px] align-[2px] rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold"
      style={{ background: K.lunaSoft, color: K.lunaInk }}
    >
      직접 지정 시
    </span>
  );
}

function matchesQuery(p: LunaPromptRow, q: string): boolean {
  if (!q) return true;
  const num = formatPromptNumber(p).toLowerCase();
  return (
    num.includes(q) ||
    (p.title ?? "").toLowerCase().includes(q) ||
    (p.prompt_key ?? "").toLowerCase().includes(q)
  );
}

export function LunaBrainPrompts() {
  const [prompts, setPrompts] = useState<LunaPromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [typeCount, setTypeCount] = useState<number | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const lens = useDepartmentLens();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<PromptsResponse>("/api/luna/prompts");
      setPrompts(json.prompts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [typesJson, libJson] = await Promise.all([
          brainFetch<{ types?: Array<{ is_active?: boolean }> }>(
            "/api/luna/question-types?active=true"
          ),
          brainFetch<{ items?: Array<{ is_active?: boolean }> }>("/api/luna/library")
        ]);
        setTypeCount((typesJson.types ?? []).length);
        setLibraryCount(
          (libJson.items ?? []).filter((i) => i.is_active !== false).length
        );
      } catch {
        /* optional meta */
      }
    })();
  }, []);

  const activePrompts = useMemo(
    () => prompts.filter((p) => p.is_active),
    [prompts]
  );
  const inactivePrompts = useMemo(
    () =>
      prompts
        .filter((p) => !p.is_active)
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "ko")),
    [prompts]
  );

  const q = query.trim().toLowerCase();

  const childrenOf = useMemo(() => {
    const map = new Map<string, LunaPromptRow[]>();
    for (const p of activePrompts) {
      if (!p.parent_key) continue;
      const list = map.get(p.parent_key) ?? [];
      list.push(p);
      map.set(p.parent_key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
    }
    return map;
  }, [activePrompts]);

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

  async function toggleActive(p: LunaPromptRow) {
    if (p.kind === "identity" || p.prompt_key === "identity.apollon") return;
    setBusy(true);
    setNotice("");
    try {
      await brainFetch("/api/luna/prompts", {
        method: "PATCH",
        body: JSON.stringify({ id: p.id, is_active: !p.is_active })
      });
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function renderEditor(p: LunaPromptRow) {
    if (!draft) return null;
    const versions = (p.versions ?? []).slice(0, 8);
    return (
      <div
        className="mt-3 border-t pt-3"
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
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
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
                  onChange={(e) =>
                    setDraft({ ...draft, prediction: e.target.value })
                  }
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
              {isHumanOnlyPromptLevel(p.level) ? (
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  사람만 수정
                </span>
              ) : (
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  저장하면 회귀 시험이 자동 실행됩니다
                </span>
              )}
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

  function renderCard(p: LunaPromptRow, opts?: { nested?: boolean }) {
    const open = openId === p.id;
    const badge = promptDisplayBadge(p.prompt_key);
    const isCore = badge === "core";
    const kids = p.prompt_key ? childrenOf.get(p.prompt_key) ?? [] : [];
    const openChild = kids.find((c) => c.id === openId) ?? null;
    const visibleKids = kids.filter((c) => matchesQuery(c, q));
    const showKids =
      !opts?.nested &&
      (Boolean(openChild) || (q ? visibleKids.length > 0 : kids.length > 0));
    const lensKey = p.prompt_key ?? "";
    const isLens = p.kind === "perspective" && Boolean(lensKey);

    return (
      <div
        key={p.id}
        className="mb-2 rounded-[11px] px-[15px] py-[13px]"
        style={{
          background: isCore ? "#FFFDF8" : K.panel,
          border: `1px solid ${isCore ? "#E0C79B" : K.line}`,
          opacity: p.is_active ? 1 : 0.5
        }}
      >
        <div className="flex items-center gap-[9px]">
          <span
            className="w-11 shrink-0 font-mono text-[10.5px]"
            style={{ color: K.faint }}
          >
            {formatPromptNumber(p)}
          </span>
          <button
            type="button"
            onClick={() => openRow(p)}
            className="min-w-0 flex-1 text-left text-[14px] font-semibold"
          >
            {p.title}
            {badge ? <BadgeChip kind={badge} /> : null}
          </button>
          <span className="shrink-0 text-[10.5px]" style={{ color: K.faint }}>
            {charCount(p.content)}
          </span>
          <button
            type="button"
            disabled={busy || p.kind === "identity"}
            onClick={() => void toggleActive(p)}
            className="relative h-[18px] w-8 shrink-0 rounded-[10px] disabled:opacity-40"
            style={{ background: p.is_active ? K.luna : "#adb2b8" }}
            aria-label={p.is_active ? "끄기" : "켜기"}
          >
            <span
              className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white"
              style={p.is_active ? { right: 2 } : { left: 2 }}
            />
          </button>
        </div>
        {p.description ? (
          <p
            className="mt-[5px] text-[11.5px] leading-[1.6]"
            style={{ color: K.sub, marginLeft: 53 }}
          >
            {p.description}
          </p>
        ) : null}
        {p.prompt_key === "type.classify" ? (
          <p
            className="mt-1.5 text-[10.5px]"
            style={{ color: K.faint, marginLeft: 53 }}
          >
            유형이 무엇인지는{" "}
            <b style={{ color: K.ink }}>유형</b> 탭에서 정한다
            {typeCount != null ? ` · 현재 ${typeCount}종` : ""}
            {" · 판정 모델 Haiku 4.5"}
          </p>
        ) : null}
        {p.prompt_key === "type.make" ? (
          <p
            className="mt-1.5 text-[10.5px]"
            style={{ color: K.faint, marginLeft: 53 }}
          >
            양식은 <b style={{ color: K.ink }}>라이브러리</b> 탭에서 관리
            {libraryCount != null ? ` · 현재 ${libraryCount}개` : ""}
          </p>
        ) : null}
        {isLens ? (
          <LensDepartmentBadges
            lensKey={lensKey}
            assigned={lens.assignedByLens.get(lensKey) ?? []}
            unassigned={lens.unassigned}
            busyDept={lens.busyDept}
            onAssign={(department, key) => void lens.save(department, key)}
            onRemove={(department) => void lens.save(department, null)}
          />
        ) : null}
        {showKids ? (
          <div
            className="mt-2 border-l-2 pl-3"
            style={{ borderColor: K.line, marginLeft: 53 }}
          >
            <div className="mb-1.5 text-[10.5px]" style={{ color: K.faint }}>
              {p.prompt_key === "type.find" ? "찾는 동안 쓰는 것" : "함께 읽는 것"}
            </div>
            {(q ? visibleKids : kids).map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => openRow(child)}
                className="flex w-full items-center gap-2 py-[5px] text-left text-[12.5px]"
              >
                <span
                  className="w-11 shrink-0 font-mono text-[10px]"
                  style={{ color: K.faint }}
                >
                  {formatPromptNumber(child)}
                </span>
                <span className="min-w-0 flex-1" style={{ color: K.sub }}>
                  {child.title}
                </span>
                <span className="text-[10px]" style={{ color: K.faint }}>
                  {charCount(child.content)}
                </span>
              </button>
            ))}
            {openChild ? renderEditor(openChild) : null}
          </div>
        ) : null}
        {open ? renderEditor(p) : null}
      </div>
    );
  }

  return (
    <KnowledgeShell>
      <div className="mx-auto max-w-[820px]">
        <div className="mb-5 flex items-center gap-2.5">
          <FieldInput
            className="min-w-0 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름으로 찾기"
          />
          <Btn onClick={() => setShowAllHistory((v) => !v)}>
            {showAllHistory ? "목록으로" : "변경 이력"}
          </Btn>
          <Btn onClick={() => setShowInactive((v) => !v)}>
            꺼진 것 보기 ({inactivePrompts.length})
          </Btn>
        </div>

        {notice ? (
          <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
            {notice}
          </p>
        ) : null}
        {error ? <ErrorLine message={error} /> : null}
        {lens.error ? <ErrorLine message={lens.error} /> : null}
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
                  <span className="w-[52px] text-[11px]" style={{ color: K.faint }}>
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

        {!loading && !error && !showAllHistory
          ? PROMPT_STAGES.map((stage) => {
              const items = activePrompts
                .filter((p) => p.stage === stage.stage && !p.parent_key)
                .filter((p) => {
                  if (!q) return true;
                  if (matchesQuery(p, q)) return true;
                  const kids = p.prompt_key
                    ? childrenOf.get(p.prompt_key) ?? []
                    : [];
                  return kids.some((c) => matchesQuery(c, q));
                })
                .sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0));
              if (q && items.length === 0) return null;
              return (
                <section key={stage.stage} className="mb-[26px]">
                  <div className="mb-1 flex items-baseline gap-2.5">
                    <span
                      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-white"
                      style={{ background: K.luna }}
                    >
                      {stage.stage}
                    </span>
                    <h3 className="text-[15px] font-bold">{stage.title}</h3>
                    <span className="text-[12.5px]" style={{ color: K.sub }}>
                      {stage.subtitle}
                    </span>
                  </div>
                  <p
                    className="mb-2.5 text-[11.5px] leading-[1.6]"
                    style={{ color: K.faint, marginLeft: 32 }}
                  >
                    {stage.description}
                  </p>
                  <div style={{ marginLeft: 32 }}>
                    {items.length === 0 ? (
                      <p className="text-[12px]" style={{ color: K.faint }}>
                        이 단계의 활성 프롬프트가 없습니다.
                      </p>
                    ) : (
                      items.map((p) => renderCard(p))
                    )}
                  </div>
                  {stage.stage === 2 && lens.unassigned.length > 0 ? (
                    <p
                      className="mt-2.5 text-[11px] leading-[1.6]"
                      style={{ color: K.faint, marginLeft: 32 }}
                    >
                      전사 부서는 관점 없이 답합니다
                    </p>
                  ) : null}
                  {stage.note ? (
                    <p
                      className="mt-2.5 text-[11px] leading-[1.6]"
                      style={{ color: K.faint, marginLeft: 32 }}
                    >
                      {stage.note}
                    </p>
                  ) : null}
                </section>
              );
            })
          : null}

        {!loading && !error && !showAllHistory && showInactive ? (
          <section className="mb-[26px]">
            <h3 className="mb-2 text-[15px] font-bold">꺼진 것</h3>
            {inactivePrompts.filter((p) => matchesQuery(p, q)).length === 0 ? (
              <p className="text-[12px]" style={{ color: K.faint }}>
                비활성 프롬프트가 없습니다.
              </p>
            ) : (
              inactivePrompts
                .filter((p) => matchesQuery(p, q))
                .map((p) => renderCard(p))
            )}
          </section>
        ) : null}

        {!loading && !error && !showAllHistory ? (
          <>
            <div className="my-[26px] h-px" style={{ background: K.line }} />
            <div
              className="rounded-[11px] border px-4 py-3.5 text-[12px] leading-[1.75]"
              style={{ background: K.panel, borderColor: K.line, color: K.sub }}
            >
              <b style={{ color: K.ink }}>이 화면을 읽는 법</b>
              <br />
              위에서 아래로가 루나가 생각하는 순서입니다. 질문을 받으면 1번부터
              차례로 지나갑니다.
              <br />
              <b style={{ color: K.ink }}>3번</b>에서 유형이 정해지고,{" "}
              <b style={{ color: K.ink }}>4번</b>에서 그 유형에 맞는 것 하나만
              읽습니다.
              <br />
              <span style={{ color: "#B0552F" }}>핵심</span> 표시는 여기가 잘못되면
              뒤가 전부 어긋나는 자리입니다.
              <br />
              <b style={{ color: K.ink }}>항상</b> 표시는 유형과 무관하게 매번 읽는
              것입니다.
            </div>
          </>
        ) : null}
      </div>
    </KnowledgeShell>
  );
}
