"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WikiDiffView } from "@/components/wiki/WikiDiffView";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { WikiSectionEditor } from "@/components/wiki/WikiSectionEditor";
import { wikiFetch, WikiApiError } from "@/components/wiki/wiki-fetch";
import { WikiStaffHiddenMark } from "@/components/wiki/WikiStaffHiddenMark";
import { formatWikiStamp, wikiEditorLabel, W } from "@/components/wiki/wiki-theme";
import { formatDiffCounts } from "@/lib/wiki/diff";
import { WIKI_RULES_LOCK_MESSAGE } from "@/lib/wiki/permissions";
import { emptySection, sectionsPlain } from "@/lib/wiki/sections";
import {
  WIKI_CATEGORY_META,
  wikiDocPath,
  wikiKindLabel,
  wikiMakePrompt,
  type WikiCategory,
  type WikiDoc,
  type WikiHistoryEntry,
  type WikiRelated,
  type WikiSection
} from "@/lib/wiki/types";

type DocPayload = {
  item?: WikiDoc;
  can_edit?: boolean;
  can_delete?: boolean;
  wiki_ready?: boolean;
  notice?: string;
};

type Tab = "read" | "edit" | "history";

export function WikiDocView({
  category,
  slug
}: {
  category: WikiCategory;
  slug: string;
}) {
  const router = useRouter();
  const meta = WIKI_CATEGORY_META[category];
  const [doc, setDoc] = useState<WikiDoc | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [wikiReady, setWikiReady] = useState(true);
  const [tab, setTab] = useState<Tab>("read");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickA, setPickA] = useState<number | null>(null);
  const [pickB, setPickB] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMissing(false);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`
      );
      if (!json.item || json.item.category !== category) {
        setDoc(null);
        setMissing(true);
        return;
      }
      setDoc(json.item);
      setCanEdit(json.can_edit === true);
      setCanDelete(json.can_delete === true);
      setWikiReady(json.wiki_ready !== false);
    } catch (err) {
      setDoc(null);
      if (err instanceof WikiApiError && err.status === 404) {
        setMissing(true);
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }, [category, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const originalSection = useMemo(
    () => doc?.sections.find((s) => s.id === editingId) ?? null,
    [doc, editingId]
  );

  function startEdit(section: WikiSection) {
    if (!canEdit) return;
    setTab("read");
    setEditingId(section.id);
    setDraftBody(section.body);
    setDraftTitle(section.title);
    setChangeNote("");
    setShowDiff(false);
    setNotice("");
  }

  function cancelEdit() {
    setEditingId(null);
    setShowDiff(false);
    setChangeNote("");
  }

  async function saveSection() {
    if (!doc || !editingId) return;
    setBusy(true);
    setError("");
    try {
      const sections = doc.sections.map((s) =>
        s.id === editingId ? { ...s, title: draftTitle, body: draftBody } : s
      );
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sections, change_note: changeNote })
        }
      );
      if (json.item) setDoc(json.item);
      setNotice(json.notice || "저장하면 루나가 바로 이 내용을 씁니다");
      cancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAllSections(sections: WikiSection[], note?: string) {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sections, change_note: note ?? changeNote })
        }
      );
      if (json.item) setDoc(json.item);
      setNotice(json.notice || "저장하면 루나가 바로 이 내용을 씁니다");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revertTo(version: number) {
    if (!window.confirm(`v${version}으로 되돌릴까요? 되돌린 내용도 새 판으로 남습니다.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`,
        { method: "PATCH", body: JSON.stringify({ revert_to: version }) }
      );
      if (json.item) setDoc(json.item);
      setNotice("되돌렸습니다. 루나가 바로 이 내용을 씁니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "되돌리지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!doc) return;
    setBusy(true);
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            is_active: false,
            change_note: "비활성"
          })
        }
      );
      if (json.item) setDoc(json.item);
      setNotice("비활성으로 두었습니다. 루나는 이 문서를 쓰지 않습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!canDelete) return;
    if (!window.confirm("이 문서를 삭제할까요? 슈퍼관리자만 할 수 있습니다.")) return;
    setBusy(true);
    try {
      await wikiFetch(`/api/wiki/docs/${encodeURIComponent(slug)}`, {
        method: "DELETE"
      });
      router.push(meta.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: W.faint }}>
        불러오는 중…
      </div>
    );
  }
  if (missing) {
    return (
      <div className="px-[22px] py-10">
        <p className="text-[12px] font-bold" style={{ color: W.faint }}>
          404
        </p>
        <h1 className="mt-1 text-[22px] font-extrabold tracking-[-0.3px]">
          문서를 찾을 수 없습니다
        </h1>
        <p className="mt-2 text-[13px]" style={{ color: W.sub }}>
          없거나, 직원에게 열려 있지 않은 문서입니다.
        </p>
        <Link
          href={meta.path}
          className="mt-4 inline-block text-[13px] font-semibold"
          style={{ color: W.luna }}
        >
          {meta.label} 목록으로
        </Link>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="px-[22px] py-6 text-[12px]" style={{ color: W.del }}>
        {error || "없습니다."}
      </div>
    );
  }

  const locked = !canEdit;
  const showToc = doc.sections.length >= 3;
  const history = doc.history;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-2 text-[11px]" style={{ color: W.faint }}>
        <Link href="/wiki/terms" style={{ color: W.luna }}>
          Wikipedia
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        <Link href={meta.path} style={{ color: W.luna }}>
          {meta.label}
        </Link>
        <span className="mx-[5px]" style={{ color: W.line }}>
          ›
        </span>
        {doc.title}
      </div>

      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">
        {doc.title}{" "}
        <span
          className="align-[6px] rounded-[9px] px-2 py-[3px] text-[10px] font-bold"
          style={{ background: W.chip, color: W.sub }}
        >
          {wikiKindLabel(category, doc.kind)}
        </span>
        {doc.visible_to_staff === false ? (
          <span className="ml-1.5 align-[6px] inline-flex">
            <WikiStaffHiddenMark />
          </span>
        ) : null}
        {category === "rules" ? (
          <span
            className="ml-1.5 align-[6px] rounded-[9px] px-2 py-[3px] text-[10px] font-bold"
            style={{ background: W.lockBg, color: W.lock }}
          >
            🔒 관리자만
          </span>
        ) : null}
      </h1>
      {doc.visible_to_staff === false ? (
        <p
          className="mb-3 mt-2 rounded-[10px] px-[13px] py-2.5 text-[11.5px]"
          style={{ background: W.lockBg, color: W.lock }}
        >
          🔒 직원에게 안 보임. 슈퍼관리자만 이 문서를 볼 수 있습니다. 루나는 계속 참고합니다.
        </p>
      ) : null}
      <p className="mb-3 mt-1 text-[11px]" style={{ color: W.faint }}>
        {formatWikiStamp(doc.updated_at, doc.updated_by_name, doc.updated_by)} · {doc.version}판
        {typeof doc.use_count === "number" ? ` · 루나가 ${doc.use_count}번 사용` : ""}
      </p>

      <div
        className="mb-[17px] flex gap-0.5 border-b"
        style={{ borderColor: W.line }}
      >
        <TabBtn on={tab === "read"} onClick={() => setTab("read")}>
          읽기
        </TabBtn>
        <TabBtn
          on={tab === "edit"}
          disabled={locked}
          onClick={() => {
            if (locked) return;
            setTab("edit");
          }}
        >
          고치기
        </TabBtn>
        <TabBtn on={tab === "history"} onClick={() => setTab("history")}>
          변경 이력
        </TabBtn>
      </div>

      {locked && category === "rules" ? (
        <div
          className="mb-[15px] rounded-[10px] border px-[13px] py-2.5 text-[11.5px]"
          style={{
            background: W.lockBg,
            borderColor: "#EADFC0",
            color: W.lock
          }}
        >
          {WIKI_RULES_LOCK_MESSAGE}
        </div>
      ) : null}

      {!wikiReady ? (
        <p className="mb-3 text-[11.5px]" style={{ color: W.lock }}>
          마이그레이션 전에는 절 단위 저장이 되지 않습니다.
        </p>
      ) : null}
      {error ? (
        <p className="mb-3 text-[12px]" style={{ color: W.del }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 text-[12px]" style={{ color: W.lunaInk }}>
          {notice}
        </p>
      ) : null}

      {tab === "read" ? (
        <>
          {showToc ? (
            <nav
              className="mb-4 rounded-[11px] border px-3.5 py-3"
              style={{ borderColor: W.line, background: "#FAFBFC" }}
            >
              <div
                className="mb-1.5 text-[10.5px] font-bold"
                style={{ color: W.faint }}
              >
                차례
              </div>
              <ol className="ml-4 list-decimal text-[12.5px]">
                {doc.sections.map((s) => (
                  <li key={s.id} className="py-0.5">
                    <a href={`#${s.id}`} style={{ color: W.luna }}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="mb-5">
              <div
                className="mb-2 flex items-baseline gap-[9px] border-b pb-1"
                style={{ borderColor: W.line2 }}
              >
                <h3 className="text-[15px] font-bold">{section.title}</h3>
                {canEdit ? (
                  <button
                    type="button"
                    className="ml-auto text-[11px]"
                    style={{ color: W.luna }}
                    onClick={() => startEdit(section)}
                  >
                    고치기
                  </button>
                ) : null}
              </div>
              {editingId === section.id ? (
                <>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="mb-2 w-full rounded-lg border px-3 py-1.5 text-[13px] font-semibold outline-none"
                    style={{ borderColor: W.line }}
                  />
                  {showDiff ? (
                    <div className="mb-3">
                      <WikiDiffView
                        before={originalSection?.body ?? ""}
                        after={draftBody}
                      />
                    </div>
                  ) : null}
                  <WikiSectionEditor
                    heading={draftTitle || section.title}
                    value={draftBody}
                    onChange={setDraftBody}
                    onCancel={cancelEdit}
                    changeNote={changeNote}
                    onChangeNote={setChangeNote}
                    onSave={() => void saveSection()}
                    onToggleDiff={() => setShowDiff((v) => !v)}
                    showDiff={showDiff}
                    busy={busy}
                  />
                </>
              ) : (
                <WikiMarkdown text={section.body} />
              )}
            </section>
          ))}

          <div
            className="mt-[22px] border-t pt-[13px]"
            style={{ borderColor: W.line }}
          >
            {doc.related.length > 0 ? (
              <p className="mb-1.5 text-[11.5px]" style={{ color: W.sub }}>
                <b className="font-semibold" style={{ color: W.ink }}>
                  관련
                </b>{" "}
                {doc.related.map((r) => (
                  <RelatedLink key={`${r.kind}-${r.title}`} item={r} />
                ))}
              </p>
            ) : null}
            <p className="text-[11.5px]" style={{ color: W.faint }}>
              {category === "rules"
                ? "규정이 바뀌면 전원에게 알림이 갑니다"
                : "수정은 검토 없이 바로 반영되고, 모든 변경은 이력으로 남습니다"}
            </p>
            {category !== "rules" ? (
              <Link
                href={`/luna?q=${encodeURIComponent(wikiMakePrompt(doc.title))}`}
                prefetch={false}
                className="mt-2 inline-block rounded-[9px] border px-[9px] py-1 text-[10.5px] font-semibold"
                style={{ borderColor: W.line, color: "#33363c" }}
              >
                루나에게 이걸로 만들어달라기
              </Link>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deactivate()}
                  className="rounded-[9px] border px-3 py-1.5 text-[11px] font-semibold"
                  style={{ borderColor: W.line, color: W.sub }}
                >
                  비활성
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className="rounded-[9px] px-3 py-1.5 text-[11px] font-semibold"
                  style={{ background: W.delBg, color: W.del }}
                >
                  삭제
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {tab === "edit" && canEdit ? (
        <EditAll
          doc={doc}
          busy={busy}
          onAdd={() =>
            void saveAllSections([...doc.sections, emptySection()], "절 추가")
          }
          onSave={(sections, note) => void saveAllSections(sections, note)}
        />
      ) : null}

      {tab === "history" ? (
        <HistoryPanel
          history={history}
          pickA={pickA}
          pickB={pickB}
          setPickA={setPickA}
          setPickB={setPickB}
          canEdit={canEdit}
          busy={busy}
          onRevert={(v) => void revertTo(v)}
        />
      ) : null}
    </div>
  );
}

function TabBtn({
  on,
  disabled,
  onClick,
  children
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-[14px] py-2 text-[12.5px]"
      style={{
        color: on ? W.ink : W.sub,
        fontWeight: on ? 700 : 400,
        borderBottom: on ? `2px solid ${W.luna}` : "2px solid transparent",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer"
      }}
    >
      {children}
    </button>
  );
}

function RelatedLink({ item }: { item: WikiRelated }) {
  const href =
    item.kind === "term"
      ? "/wiki/terms"
      : item.category && item.slug
        ? wikiDocPath(item.category, item.slug)
        : "/wiki/terms";
  return (
    <Link href={href} className="mr-[9px]" style={{ color: W.luna }}>
      {item.title}
    </Link>
  );
}

function EditAll({
  doc,
  busy,
  onAdd,
  onSave
}: {
  doc: WikiDoc;
  busy: boolean;
  onAdd: () => void;
  onSave: (sections: WikiSection[], note: string) => void;
}) {
  const [sections, setSections] = useState(doc.sections);
  const [note, setNote] = useState("");
  useEffect(() => setSections(doc.sections), [doc.sections]);

  return (
    <div>
      <p className="mb-3 text-[11px]" style={{ color: W.faint }}>
        절을 고치거나 순서를 유지한 채 내용을 바꿉니다. 저장하면 바로 반영됩니다.
      </p>
      {sections.map((s, idx) => (
        <div key={s.id} className="mb-3">
          <input
            value={s.title}
            onChange={(e) =>
              setSections((prev) =>
                prev.map((x, i) =>
                  i === idx ? { ...x, title: e.target.value } : x
                )
              )
            }
            className="mb-1 w-full rounded-lg border px-3 py-1.5 text-[13px] font-semibold outline-none"
            style={{ borderColor: W.line }}
          />
          <textarea
            value={s.body}
            onChange={(e) =>
              setSections((prev) =>
                prev.map((x, i) =>
                  i === idx ? { ...x, body: e.target.value } : x
                )
              )
            }
            className="min-h-[90px] w-full rounded-lg border px-3 py-2 text-[13px] leading-[1.9] outline-none"
            style={{ borderColor: W.line }}
          />
        </div>
      ))}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="무엇을 왜 바꾸셨나요?"
        className="mb-2 w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
        style={{ borderColor: W.line }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(sections, note)}
          className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white disabled:opacity-40"
          style={{ background: W.luna }}
        >
          저장
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className="rounded-[9px] border px-3 py-[7px] text-[11.5px] font-semibold"
          style={{ borderColor: W.line }}
        >
          절 추가
        </button>
      </div>
    </div>
  );
}

function HistoryPanel({
  history,
  pickA,
  pickB,
  setPickA,
  setPickB,
  canEdit,
  busy,
  onRevert
}: {
  history: WikiHistoryEntry[];
  pickA: number | null;
  pickB: number | null;
  setPickA: (v: number | null) => void;
  setPickB: (v: number | null) => void;
  canEdit: boolean;
  busy: boolean;
  onRevert: (version: number) => void;
}) {
  const left = history.find((h) => h.version === pickA);
  const right = history.find((h) => h.version === pickB);

  function toggle(version: number) {
    if (pickA === version) {
      setPickA(null);
      return;
    }
    if (pickB === version) {
      setPickB(null);
      return;
    }
    if (pickA == null) {
      setPickA(version);
      return;
    }
    if (pickB == null) {
      setPickB(version);
      return;
    }
    setPickA(pickB);
    setPickB(version);
  }

  return (
    <div>
      <p className="mb-3 text-[11px]" style={{ color: W.faint }}>
        왼쪽 동그라미로 두 판을 고르면 비교합니다. 되돌린 것도 새 판으로 남습니다.
      </p>
      <div className="mb-4 space-y-1">
        {history.length === 0 ? (
          <p className="text-[12px]" style={{ color: W.faint }}>
            아직 이력이 없습니다.
          </p>
        ) : (
          history.map((h) => {
            const on = h.version === pickA || h.version === pickB;
            return (
              <div
                key={h.version}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px]"
                style={{ background: on ? W.lunaSoft : "transparent" }}
              >
                <button
                  type="button"
                  aria-label={`v${h.version} 비교에 넣기`}
                  onClick={() => toggle(h.version)}
                  className="h-[14px] w-[14px] shrink-0 rounded-full border"
                  style={{
                    borderColor: on ? W.luna : W.line,
                    background: on ? W.luna : W.panel
                  }}
                />
                <span className="w-10 font-bold">v{h.version}</span>
                <span className="font-semibold">
                  {wikiEditorLabel(h.by, h.by_name)}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: W.sub }}>
                  {h.summary || "수정"}
                </span>
                <span style={{ color: W.faint }}>
                  {formatDiffCounts(h.added, h.removed)}
                </span>
                <span style={{ color: W.faint }}>
                  {new Date(h.at).toLocaleString("ko-KR")}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRevert(h.version)}
                    className="text-[11px]"
                    style={{ color: W.luna }}
                  >
                    되돌리기
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {left && right ? (
        <WikiDiffView
          before={sectionsPlain(left.sections)}
          after={sectionsPlain(right.sections)}
        />
      ) : null}
    </div>
  );
}
