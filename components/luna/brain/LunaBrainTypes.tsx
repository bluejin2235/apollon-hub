"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldTextarea,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { brainFetch, formatDateTime, SectionTitle } from "@/components/luna/brain/shared";
import { K } from "@/lib/luna/knowledge-format";
import type { QuestionTypeRow, UnclassifiedQuestionRow } from "@/lib/luna/question-types";

type TypesPayload = {
  types?: QuestionTypeRow[];
  source?: string;
  web_augment?: boolean;
  error?: string;
};

type UnclassifiedPayload = {
  questions?: UnclassifiedQuestionRow[];
  table_ready?: boolean;
  error?: string;
};

const EMPTY_DRAFT: QuestionTypeRow = {
  slug: "",
  label: "",
  criteria: "",
  sources: "",
  answer_form: "",
  prompt_key: null,
  needs_search: false,
  needs_library: false,
  skip_clarify: false,
  is_active: true,
  sort_order: 99
};

function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? <Badge kind="ok">{label}</Badge> : null;
}

export function LunaBrainTypes() {
  const [types, setTypes] = useState<QuestionTypeRow[]>([]);
  const [source, setSource] = useState("seed");
  const [unclassified, setUnclassified] = useState<UnclassifiedQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<QuestionTypeRow>(EMPTY_DRAFT);
  const [webAugment, setWebAugment] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [typesJson, uncJson] = await Promise.all([
        brainFetch<TypesPayload>("/api/luna/question-types?active=false"),
        brainFetch<UnclassifiedPayload>("/api/luna/unclassified?status=pending")
      ]);
      setTypes(typesJson.types ?? []);
      setSource(typesJson.source ?? "db");
      setWebAugment(typesJson.web_augment !== false);
      setUnclassified(uncJson.questions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "유형을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openType(row: QuestionTypeRow) {
    setSelected(row.slug);
    setDraft({ ...row });
    setNotice("");
  }

  function openNew(from?: UnclassifiedQuestionRow) {
    setSelected("new");
    setDraft({
      ...EMPTY_DRAFT,
      criteria: from ? `예: ${from.question}` : "",
      label: ""
    });
    setNotice("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const isNew = selected === "new";
      await brainFetch("/api/luna/question-types", {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(
          draft.slug === "know"
            ? { ...draft, web_augment: webAugment }
            : draft
        )
      });
      setNotice(isNew ? "유형을 추가했습니다." : "유형을 저장했습니다.");
      await load();
      if (isNew) setSelected(draft.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: QuestionTypeRow) {
    setBusy(true);
    setError("");
    try {
      await brainFetch("/api/luna/question-types", {
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

  async function dismissUnclassified(id: string) {
    try {
      await brainFetch("/api/luna/unclassified", {
        method: "PATCH",
        body: JSON.stringify({ id, status: "dismissed" })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리하지 못했습니다.");
    }
  }

  const editing = selected !== null;

  return (
    <KnowledgeShell>
      <p className="mb-3 text-[12.5px]" style={{ color: K.sub }}>
        판정 기준은 이 목록만 봅니다. 유형 slug 를 코드에 넣지 않습니다.
        {source === "seed" ? " · 테이블이 없어 시드로 표시 중입니다." : null}
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
          <SectionTitle>유형</SectionTitle>
          <div className="mb-3 flex justify-end">
            <Btn primary onClick={() => openNew()} disabled={busy}>
              새 유형
            </Btn>
          </div>
          {types.length === 0 ? (
            <p className="mb-4 text-[12px]" style={{ color: K.faint }}>
              유형이 없습니다.
            </p>
          ) : (
            <div className="mb-5">
              {types.map((row) => (
                <ListCard key={row.slug}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-left text-[13px] font-bold"
                      onClick={() => openType(row)}
                    >
                      {row.label}{" "}
                      <span className="font-normal" style={{ color: K.faint }}>
                        {row.slug}
                      </span>
                    </button>
                    {row.is_active ? (
                      <Badge kind="ok">활성</Badge>
                    ) : (
                      <Badge kind="wait">비활성</Badge>
                    )}
                    <Flag on={row.needs_search} label="검색" />
                    <Flag on={row.needs_library} label="양식" />
                    <Flag on={row.skip_clarify} label="되묻기 생략" />
                    {row.slug === "know" ? (
                      <Flag on={webAugment} label="웹 보강" />
                    ) : null}
                    <span className="ml-auto">
                      <Btn
                        onClick={() => void toggleActive(row)}
                        disabled={busy}
                      >
                        {row.is_active ? "끄기" : "켜기"}
                      </Btn>
                    </span>
                  </div>
                  <p className="mt-1 text-[12px]" style={{ color: K.sub }}>
                    {row.criteria || "판정 기준 없음"}
                  </p>
                </ListCard>
              ))}
            </div>
          )}

          {editing ? (
            <div className="mb-6 rounded-[12px] border p-4" style={{ borderColor: K.line }}>
              <SectionTitle>
                {selected === "new" ? "새 유형" : `편집 · ${draft.slug}`}
              </SectionTitle>
              {selected === "new" ? (
                <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                  slug
                  <FieldInput
                    className="mt-1 w-full"
                    value={draft.slug}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, slug: e.target.value.trim().toLowerCase() }))
                    }
                    placeholder="know"
                  />
                </label>
              ) : null}
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                이름
                <FieldInput
                  className="mt-1 w-full"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                />
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                판정 기준
                <FieldTextarea
                  className="mt-1"
                  rows={3}
                  value={draft.criteria}
                  onChange={(e) => setDraft((d) => ({ ...d, criteria: e.target.value }))}
                />
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                소스
                <FieldTextarea
                  className="mt-1"
                  rows={2}
                  value={draft.sources}
                  onChange={(e) => setDraft((d) => ({ ...d, sources: e.target.value }))}
                />
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                답변 형태
                <FieldTextarea
                  className="mt-1"
                  rows={2}
                  value={draft.answer_form}
                  onChange={(e) => setDraft((d) => ({ ...d, answer_form: e.target.value }))}
                />
              </label>
              <label className="mb-2 block text-[12px]" style={{ color: K.sub }}>
                프롬프트 키
                <FieldInput
                  className="mt-1 w-full"
                  value={draft.prompt_key ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      prompt_key: e.target.value.trim() || null
                    }))
                  }
                  placeholder="type.know"
                />
              </label>
              <div className="mb-3 flex flex-wrap gap-4 text-[12.5px]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.needs_search}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, needs_search: e.target.checked }))
                    }
                  />
                  검색
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.needs_library}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, needs_library: e.target.checked }))
                    }
                  />
                  양식 필요
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.skip_clarify}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, skip_clarify: e.target.checked }))
                    }
                  />
                  되묻기 생략
                </label>
                {draft.slug === "know" ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={webAugment}
                      onChange={(e) => setWebAugment(e.target.checked)}
                    />
                    웹 보강
                  </label>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Btn primary onClick={() => void save()} disabled={busy}>
                  저장
                </Btn>
                <Btn onClick={() => setSelected(null)}>닫기</Btn>
              </div>
            </div>
          ) : null}

          <SectionTitle>미분류 질문</SectionTitle>
          <p className="mb-2 text-[12px]" style={{ color: K.faint }}>
            판정 신뢰가 낮거나 유형이 비었던 질문입니다. 새 유형 후보로 삼을 수 있습니다.
          </p>
          {unclassified.length === 0 ? (
            <p className="text-[12px]" style={{ color: K.faint }}>
              대기 중인 미분류 질문이 없습니다.
            </p>
          ) : (
            unclassified.map((q) => (
              <ListCard key={q.id}>
                <div className="text-[13px]">{q.question}</div>
                <div className="mt-1 text-[11.5px]" style={{ color: K.faint }}>
                  {formatDateTime(q.created_at)}
                  {q.reason ? ` · ${q.reason}` : ""}
                  {q.confidence != null ? ` · ${q.confidence}` : ""}
                </div>
                <div className="mt-2 flex gap-2">
                  <Btn primary onClick={() => openNew(q)}>
                    유형 후보로
                  </Btn>
                  <Btn onClick={() => void dismissUnclassified(q.id)}>무시</Btn>
                </div>
              </ListCard>
            ))
          )}
        </>
      )}
    </KnowledgeShell>
  );
}
