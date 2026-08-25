"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createTag, getTags, setWorkTags, type WebsiteTagItem } from "@/lib/website/api";
import { Guide, Sep, SmallBtn, TextInput } from "@/components/website/work-editor-ui";

const TAG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Props = {
  workId: string;
  selectedIds: string[];
  onReload: () => Promise<void>;
};

function tagName(tag: WebsiteTagItem) {
  return tag.label?.ko || tag.label?.en || tag.id;
}

export function TagPicker({ workId, selectedIds, onReload }: Props) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<WebsiteTagItem[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newKo, setNewKo] = useState("");
  const [newEn, setNewEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getTags().then((res) => {
      if (res.ok) setAll(res.data.items ?? []);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = useMemo(() => {
    const byId = new Map(all.map((tag) => [tag.id, tag]));
    return selectedIds.map((id) => byId.get(id) ?? { id, label: { ko: id } });
  }, [all, selectedIds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((tag) => {
      if (!needle) return true;
      return `${tag.id} ${tagName(tag)}`.toLowerCase().includes(needle);
    });
  }, [all, q]);

  async function replace(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await setWorkTags(workId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function add(id: string) {
    if (selectedIds.includes(id)) return;
    setOpen(false);
    setCreating(false);
    setQ("");
    await replace([...selectedIds, id]);
  }

  async function remove(id: string) {
    await replace(selectedIds.filter((item) => item !== id));
  }

  function startCreate() {
    setCreating(true);
    const slug = q.trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (TAG_ID_RE.test(slug)) setNewId(slug);
  }

  async function makeTag() {
    const id = newId.trim();
    if (!TAG_ID_RE.test(id) || !newKo.trim() || !newEn.trim()) {
      setError("id는 영문 소문자·하이픈, 국문·영문은 모두 필요합니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createTag(id, { ko: newKo.trim(), en: newEn.trim() });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setAll((prev) => [...prev, created.data]);
      setCreating(false);
      setNewId("");
      setNewKo("");
      setNewEn("");
      await add(created.data.id);
    } finally {
      setBusy(false);
    }
  }

  const noneMatch = filtered.length === 0;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white"
          >
            {tagName(tag)}
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(tag.id)}
              className="text-white/70 hover:text-white"
              aria-label={`${tagName(tag)} 제거`}
            >
              ✕
            </button>
          </span>
        ))}
        <div className="relative" ref={boxRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-400"
          >
            ＋ 추가
          </button>
          {open ? (
            <div className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <TextInput value={q} onChange={setQ} placeholder="태그 검색" />
              <ul className="mt-2 max-h-48 overflow-y-auto">
                {filtered.map((tag) => {
                  const on = selectedIds.includes(tag.id);
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        disabled={on || busy}
                        onClick={() => void add(tag.id)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${
                          on ? "text-slate-300" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span>{tagName(tag)}</span>
                        <span className="text-slate-400">{tag.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {noneMatch || creating ? (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  {!creating ? (
                    <SmallBtn onClick={startCreate}>새 태그 만들기</SmallBtn>
                  ) : (
                    <div className="space-y-1.5">
                      <TextInput value={newId} onChange={setNewId} placeholder="id (영문 소문자·하이픈)" />
                      <TextInput value={newKo} onChange={setNewKo} placeholder="국문" />
                      <TextInput value={newEn} onChange={setNewEn} placeholder="영문" />
                      <div className="flex gap-1">
                        <SmallBtn disabled={busy} onClick={() => void makeTag()}>
                          만들기
                        </SmallBtn>
                        <SmallBtn onClick={() => setCreating(false)}>취소</SmallBtn>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <SmallBtn onClick={startCreate}>새 태그 만들기</SmallBtn>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      <Guide>
        <b className="font-semibold text-slate-600">3~6개</b> · 태그당 2~10자
        <Sep />
        쓰이는 곳 —{" "}
        <b className="font-semibold text-slate-600">
          사이트 안 분류(태그를 누르면 같은 태그의 워크가 모임) · 검색 노출 키워드 · 관련 콘텐츠 자동 추천
        </b>
        <br />
        사람이 검색창에 칠 법한 말로 답니다. 여러 프로젝트가 같은 태그를 공유해야 의미가 있습니다.
        <br />
        좋은 예) 면세점 · K-POP · 이머시브 리테일 &nbsp; 나쁜 예) 2024년1월착수 · 김대리담당
      </Guide>
    </div>
  );
}
