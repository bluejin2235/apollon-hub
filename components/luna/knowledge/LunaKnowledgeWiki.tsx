"use client";

import { useCallback, useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { WikiSectionEditor } from "@/components/wiki/WikiSectionEditor";
import { WikiStaffHiddenMark } from "@/components/wiki/WikiStaffHiddenMark";
import { formatWikiWhen, W } from "@/components/wiki/wiki-theme";
import {
  ErrorLine,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
import {
  type WikiDoc,
  type WikiDocListItem,
  type WikiMenu,
  type WikiSection
} from "@/lib/wiki/types";

type ListPayload = {
  items?: WikiDocListItem[];
  is_admin?: boolean;
  can_edit?: boolean;
  can_toggle_visibility?: boolean;
  wiki_ready?: boolean;
  error?: string;
};

type DocPayload = {
  item?: WikiDoc;
  can_edit?: boolean;
  wiki_ready?: boolean;
  error?: string;
};

function VisibilityToggle({
  visible,
  disabled,
  busy,
  onToggle
}: {
  visible: boolean;
  disabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={visible}
      className="relative h-[18px] w-8 shrink-0 rounded-full transition disabled:opacity-40"
      style={{ background: visible ? K.luna : "#d9dbe0" }}
      title={visible ? "직원에게 공개" : "관리자만"}
    >
      <span
        className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition"
        style={{ left: visible ? "14px" : "2px" }}
      />
    </button>
  );
}

export function LunaKnowledgeWiki() {
  const [menuSlug, setMenuSlug] = useState("projects");
  const [menus, setMenus] = useState<WikiMenu[]>([]);
  const [items, setItems] = useState<WikiDocListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canToggleVisibility, setCanToggleVisibility] = useState(false);
  const [wikiReady, setWikiReady] = useState(true);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<WikiDoc | null>(null);
  const [expandedCanEdit, setExpandedCanEdit] = useState(false);
  const [expandLoading, setExpandLoading] = useState(false);
  const [expandError, setExpandError] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);

  const menu = menus.find((m) => m.slug === menuSlug) ?? null;

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await wikiFetch<ListPayload>(
        `/api/wiki/docs?menu=${encodeURIComponent(menuSlug)}&include_inactive=1`
      );
      setItems(json.items ?? []);
      setCanToggleVisibility(json.can_toggle_visibility === true);
      setWikiReady(json.wiki_ready !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [menuSlug]);

  useEffect(() => {
    void wikiFetch<{ menus?: WikiMenu[] }>("/api/wiki/nav")
      .then((n) => {
        const list = n.menus ?? [];
        setMenus(list);
        setMenuSlug((cur) =>
          list.some((m) => m.slug === cur) ? cur : list[0]?.slug ?? cur
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadList();
    setExpandedSlug(null);
    setExpandedDoc(null);
    setEditingSectionId(null);
  }, [loadList]);

  async function loadDoc(slug: string) {
    setExpandLoading(true);
    setExpandError("");
    try {
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(slug)}`
      );
      if (!json.item || json.item.menu_slug !== menuSlug) {
        setExpandedDoc(null);
        setExpandError("문서를 찾지 못했습니다.");
        return;
      }
      setExpandedDoc(json.item);
      setExpandedCanEdit(json.can_edit === true);
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      setExpandedDoc(null);
    } finally {
      setExpandLoading(false);
    }
  }

  function toggleRow(slug: string) {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
      setExpandedDoc(null);
      setEditingSectionId(null);
      return;
    }
    setExpandedSlug(slug);
    setEditingSectionId(null);
    void loadDoc(slug);
  }

  function startEdit(section: WikiSection) {
    if (!expandedCanEdit) return;
    setEditingSectionId(section.id);
    setDraftBody(section.body);
    setDraftTitle(section.title);
    setChangeNote("");
    setShowDiff(false);
  }

  function cancelEdit() {
    setEditingSectionId(null);
    setShowDiff(false);
    setChangeNote("");
  }

  async function saveSection() {
    if (!expandedDoc || !editingSectionId) return;
    setBusy(true);
    setExpandError("");
    try {
      const sections = expandedDoc.sections.map((s) =>
        s.id === editingSectionId ? { ...s, title: draftTitle, body: draftBody } : s
      );
      const json = await wikiFetch<DocPayload>(
        `/api/wiki/docs/${encodeURIComponent(expandedDoc.slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sections, change_note: changeNote })
        }
      );
      if (!json.item) throw new Error("저장하지 못했습니다.");
      setExpandedDoc(json.item);
      setEditingSectionId(null);
      void loadList();
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(row: WikiDocListItem) {
    if (!canToggleVisibility) return;
    setToggleBusy(row.slug);
    setError("");
    try {
      await wikiFetch(`/api/wiki/docs/${encodeURIComponent(row.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ visible_to_staff: row.visible_to_staff === false })
      });
      await loadList();
      if (expandedSlug === row.slug) {
        await loadDoc(row.slug);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "공개 설정을 바꾸지 못했습니다.");
    } finally {
      setToggleBusy(null);
    }
  }

  return (
    <KnowledgeShell>
      <p className="mb-3 text-[12.5px]" style={{ color: K.sub }}>
        위키 문서를 여기서 고칩니다. 저장하면 루나가 바로 씁니다. 슈퍼관리자만
        문서별 공개(직원 노출)를 바꿀 수 있습니다.
      </p>

      {!wikiReady ? (
        <p
          className="mb-3 rounded-[10px] px-[13px] py-2.5 text-[11.5px]"
          style={{ background: W.lockBg, color: W.lock }}
        >
          위키 마이그레이션 SQL을 실행하면 절 단위 편집·공개 설정이 켜집니다.
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {menus.map((m) => {
          const active = menuSlug === m.slug;
          return (
            <button
              key={m.slug}
              type="button"
              onClick={() => setMenuSlug(m.slug)}
              className="rounded-[20px] px-3 py-1 text-[12px] font-semibold"
              style={{
                background: active ? K.lunaSoft : K.chip,
                color: active ? K.lunaInk : K.sub
              }}
            >
              {m.name}
            </button>
          );
        })}
      </div>

      <h2 className="mb-1 text-[15px] font-bold">{menu?.name ?? "위키"}</h2>
      <p className="mb-3 text-[11px]" style={{ color: K.faint }}>
        {menu?.description ?? ""}
      </p>

      {error ? <ErrorLine message={error} /> : null}
      {loading ? (
        <LoadingLine />
      ) : items.length === 0 ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          문서가 없습니다.
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-[11px] border"
          style={{ borderColor: K.line, background: K.panel }}
        >
          {items.map((row) => {
            const isPrivate = row.visible_to_staff === false;
            const expanded = expandedSlug === row.slug;
            return (
              <div
                key={row.slug}
                className="border-b last:border-b-0"
                style={{
                  borderColor: K.line2,
                  background: isPrivate ? "#FAF7EE" : undefined,
                  opacity: isPrivate ? 0.92 : 1
                }}
              >
                <div className="flex w-full items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleRow(row.slug)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    aria-expanded={expanded}
                  >
                    {isPrivate ? <WikiStaffHiddenMark compact /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{row.title}</span>
                      <span
                        className="mt-0.5 block truncate text-[11.5px]"
                        style={{ color: K.sub }}
                      >
                        {row.summary || "—"}
                      </span>
                    </span>
                    {isPrivate ? (
                      <span
                        className="hidden shrink-0 text-[9px] font-semibold sm:inline"
                        style={{ color: W.lock }}
                      >
                        직원에게 안 보임
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10px]" style={{ color: K.faint }}>
                      {formatWikiWhen(row.updated_at)}
                    </span>
                  </button>
                  {canToggleVisibility ? (
                    <VisibilityToggle
                      visible={row.visible_to_staff !== false}
                      disabled={!canToggleVisibility}
                      busy={toggleBusy === row.slug}
                      onToggle={() => void toggleVisibility(row)}
                    />
                  ) : (
                    <span className="w-8 shrink-0 text-[10px]" style={{ color: K.faint }}>
                      {isPrivate ? "비공개" : "공개"}
                    </span>
                  )}
                </div>

                {expanded ? (
                  <div
                    className="border-t px-4 pb-4 pt-2"
                    style={{ borderColor: K.line2, background: "#FBFBFC" }}
                  >
                    {expandLoading ? (
                      <LoadingLine />
                    ) : expandError ? (
                      <ErrorLine message={expandError} />
                    ) : expandedDoc ? (
                      <div className="space-y-3">
                        {!expandedCanEdit ? (
                          <p className="text-[11px]" style={{ color: W.lock }}>
                            🔒 이 문서는 관리자만 고칠 수 있습니다.
                          </p>
                        ) : null}
                        {expandedDoc.sections.map((section) =>
                          editingSectionId === section.id ? (
                            <WikiSectionEditor
                              key={section.id}
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
                          ) : (
                            <div
                              key={section.id}
                              className="rounded-[10px] border px-3 py-2.5"
                              style={{ borderColor: K.line, background: K.panel }}
                            >
                              <div className="mb-1.5 flex items-center gap-2">
                                <h4 className="text-[12.5px] font-semibold">
                                  {section.title}
                                </h4>
                                {expandedCanEdit ? (
                                  <button
                                    type="button"
                                    onClick={() => startEdit(section)}
                                    className="ml-auto text-[11px] font-medium"
                                    style={{ color: K.luna }}
                                  >
                                    고치기
                                  </button>
                                ) : null}
                              </div>
                              <p
                                className="whitespace-pre-wrap text-[12px] leading-[1.75]"
                                style={{ color: K.sub }}
                              >
                                {section.body.trim() || "—"}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </KnowledgeShell>
  );
}
