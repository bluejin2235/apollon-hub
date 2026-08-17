"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { brainFetch, formatDateTime, SectionTitle } from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";
import {
  LIBRARY_KIND_OPTIONS,
  libraryKindLabel,
  type LibraryAdminRow
} from "@/lib/luna/question-types";

type LibraryPayload = {
  items?: LibraryAdminRow[];
  table_ready?: boolean;
  error?: string;
};

const EMPTY_DRAFT: LibraryAdminRow = {
  slug: "",
  title: "",
  kind: "template",
  content: "",
  source_prompt_key: null,
  is_active: true
};

export function LunaBrainLibrary() {
  const [items, setItems] = useState<LibraryAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<LibraryAdminRow>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await brainFetch<LibraryPayload>("/api/luna/library");
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "라이브러리를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openItem(row: LibraryAdminRow) {
    setSelected(row.slug);
    setDraft({ ...row });
    setNotice("");
  }

  function openNew() {
    setSelected("new");
    setDraft({ ...EMPTY_DRAFT });
    setNotice("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const isNew = selected === "new";
      await brainFetch("/api/luna/library", {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(draft)
      });
      setNotice(isNew ? "양식을 추가했습니다." : "양식을 저장했습니다.");
      await load();
      if (isNew) setSelected(draft.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: LibraryAdminRow) {
    setBusy(true);
    setError("");
    try {
      await brainFetch("/api/luna/library", {
        method: "PATCH",
        body: JSON.stringify({ slug: row.slug, is_active: !row.is_active })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const editing = selected !== null;

  return (
    <KnowledgeShell>
      <p className="mb-3 text-[12.5px]" style={{ color: K.sub }}>
        MAKE 가 쓰는 양식·분석 기준·톤 가이드입니다. 비활성 항목은 답변에 넣지 않습니다.
      </p>
      {error ? <ErrorLine message={error} /> : null}
      {notice ? (
        <p className="mb-2 text-[12px]" style={{ color: K.talk }}>
          {notice}
        </p>
      ) : null}

      {loading ? (
        <LoadingLine />
      ) : (
        <>
          <SectionTitle>라이브러리</SectionTitle>
          <div className="mb-3 flex justify-end">
            <Btn primary onClick={openNew} disabled={busy}>
              새 양식
            </Btn>
          </div>
          {items.length === 0 ? (
            <p className="mb-4 text-[12px]" style={{ color: K.faint }}>
              양식이 없습니다.
            </p>
          ) : (
            <div className="mb-5 space-y-2">
              {items.map((row) => (
                <ListCard key={row.slug}>
                  <div className="flex flex-wrap items-center gap-2 px-4 py-[13px]">
                    <button
                      type="button"
                      className="text-left text-[13px] font-bold"
                      onClick={() => openItem(row)}
                    >
                      {row.title}{" "}
                      <span className="font-normal" style={{ color: K.faint }}>
                        {row.slug}
                      </span>
                    </button>
                    <Badge kind="src">{libraryKindLabel(row.kind)}</Badge>
                    {row.is_active ? (
                      <Badge kind="ok">활성</Badge>
                    ) : (
                      <Badge kind="wait">비활성</Badge>
                    )}
                    <span className="ml-auto">
                      <Btn
                        onClick={() => void toggleActive(row)}
                        disabled={busy}
                      >
                        {row.is_active ? "끄기" : "켜기"}
                      </Btn>
                    </span>
                  </div>
                </ListCard>
              ))}
            </div>
          )}

          {editing ? (
            <div className="mb-6 rounded-[12px] border p-4" style={{ borderColor: K.line }}>
              <SectionTitle>
                {selected === "new" ? "새 양식" : `편집 · ${draft.slug}`}
              </SectionTitle>
              {selected === "new" ? (
                <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                  slug
                  <FieldInput
                    className="mt-1 w-full"
                    value={draft.slug}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        slug: e.target.value.trim().toLowerCase()
                      }))
                    }
                    placeholder="ot_checklist"
                  />
                </label>
              ) : null}
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                제목
                <FieldInput
                  className="mt-1 w-full"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                />
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                종류
                <FieldSelect
                  className="mt-1 w-full"
                  value={draft.kind}
                  onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
                >
                  {LIBRARY_KIND_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </FieldSelect>
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                본문
                <FieldTextarea
                  className="mt-1 min-h-[220px]"
                  rows={12}
                  value={draft.content}
                  onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                />
              </label>
              {draft.source_prompt_key ? (
                <p className="mb-2 text-[11.5px]" style={{ color: K.faint }}>
                  이관 출처 · {draft.source_prompt_key}
                  {draft.updated_at ? ` · ${formatDateTime(draft.updated_at)}` : ""}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Btn primary onClick={() => void save()} disabled={busy}>
                  저장
                </Btn>
                <Btn onClick={() => setSelected(null)}>닫기</Btn>
              </div>
            </div>
          ) : null}
        </>
      )}
    </KnowledgeShell>
  );
}
