"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTag,
  getTags,
  setWorkTags,
  type WebsiteTagItem
} from "@/lib/website/api";
import type { ApiResult } from "@/lib/website/types";
import { SmallBtn, TextInput } from "@/components/website/work-editor-ui";

const TAG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Props = {
  workId: string;
  selectedIds: string[];
  onReload: () => Promise<void>;
  saveTags?: (id: string, tagIds: string[]) => Promise<ApiResult<{ items: unknown[] }>>;
};

function tagName(tag: WebsiteTagItem) {
  return tag.label?.ko || tag.label?.en || tag.id;
}

function slugFromInput(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function TagPicker({ workId, selectedIds, onReload, saveTags = setWorkTags }: Props) {
  const [all, setAll] = useState<WebsiteTagItem[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newKo, setNewKo] = useState("");
  const [newEn, setNewEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSuggest, setOpenSuggest] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getTags().then((res) => {
      if (res.ok) setAll(res.data.items ?? []);
    });
  }, []);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpenSuggest(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = useMemo(() => {
    const byId = new Map(all.map((tag) => [tag.id, tag]));
    return selectedIds.map((id) => byId.get(id) ?? { id, label: { ko: id } });
  }, [all, selectedIds]);

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return all.filter((tag) => !selectedIds.includes(tag.id)).slice(0, 8);
    return all
      .filter((tag) => {
        if (selectedIds.includes(tag.id)) return false;
        return `${tag.id} ${tagName(tag)}`.toLowerCase().includes(needle);
      })
      .slice(0, 8);
  }, [all, needle, selectedIds]);

  async function replace(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await saveTags(workId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  function resetInput() {
    setQ("");
    setCreating(false);
    setNewId("");
    setNewKo("");
    setNewEn("");
    setOpenSuggest(false);
  }

  async function add(id: string) {
    if (selectedIds.includes(id)) return;
    resetInput();
    await replace([...selectedIds, id]);
  }

  async function remove(id: string) {
    await replace(selectedIds.filter((item) => item !== id));
  }

  function beginCreate(source: string) {
    const slug = slugFromInput(source);
    if (!TAG_ID_RE.test(slug)) {
      setError("id는 영문 소문자·하이픈만 쓸 수 있습니다");
      return;
    }
    setCreating(true);
    setNewId(slug);
    setNewKo(source.trim());
    setNewEn("");
    setOpenSuggest(false);
    window.setTimeout(() => enRef.current?.focus(), 0);
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
      resetInput();
      await add(created.data.id);
    } finally {
      setBusy(false);
    }
  }

  function pickExisting(tag: WebsiteTagItem) {
    void add(tag.id);
  }

  function handleEnter() {
    if (busy) return;
    if (creating) {
      void makeTag();
      return;
    }

    const text = q.trim();
    if (!text) return;

    const slug = slugFromInput(text);
    const byId = all.find((tag) => tag.id === slug);
    if (byId) {
      void add(byId.id);
      return;
    }

    const byName = all.find(
      (tag) => tagName(tag).toLowerCase() === text.toLowerCase() && !selectedIds.includes(tag.id),
    );
    if (byName) {
      void add(byName.id);
      return;
    }

    if (filtered.length === 1) {
      void add(filtered[0]!.id);
      return;
    }

    if (all.some((tag) => tag.id === slug)) {
      void add(slug);
      return;
    }

    beginCreate(text);
  }

  return (
    <div ref={boxRef}>
      <div className="wa chips">
        {selected.map((tag) => (
          <span key={tag.id} className="chip">
            {tagName(tag)}
            <button
              type="button"
              className="x"
              aria-label={`${tagName(tag)} 삭제`}
              disabled={busy}
              onClick={() => void remove(tag.id)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="relative mt-2">
        <input
          className="i"
          value={q}
          disabled={busy}
          placeholder="태그를 치고 엔터"
          onChange={(event) => {
            setQ(event.target.value);
            setError(null);
            setOpenSuggest(true);
            if (creating) setCreating(false);
          }}
          onFocus={() => setOpenSuggest(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleEnter();
            }
            if (event.key === "Escape") {
              resetInput();
            }
          }}
        />
        {openSuggest && needle && filtered.length > 0 && !creating ? (
          <ul className="absolute left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {filtered.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickExisting(tag)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <span>{tagName(tag)}</span>
                  <span className="text-slate-400">{tag.id}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {creating ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="text-xs text-slate-500">새 태그 — id·국문·영문을 확인하고 Enter 로 만듭니다</p>
          <TextInput value={newId} onChange={setNewId} placeholder="id (영문 소문자·하이픈)" />
          <TextInput value={newKo} onChange={setNewKo} placeholder="국문" />
          <input
            ref={enRef}
            className="i"
            value={newEn}
            placeholder="영문"
            onChange={(event) => setNewEn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void makeTag();
              }
            }}
          />
          <div className="flex gap-1">
            <SmallBtn disabled={busy} onClick={() => void makeTag()}>
              만들기
            </SmallBtn>
            <SmallBtn onClick={resetInput}>취소</SmallBtn>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
