"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createTag, getTags, setWorkTags, type WebsiteTagItem } from "@/lib/website/api";
import { SmallBtn, TextInput } from "@/components/website/work-editor-ui";
import { Chips } from "@/components/website/ui";

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
      <div className="relative" ref={boxRef}>
        <Chips
          items={selected.map((tag) => ({ id: tag.id, label: tagName(tag) }))}
          onRemove={(id) => {
            if (!busy) void remove(id);
          }}
          onAdd={() => {
            setOpen((v) => !v);
            setCreating(false);
          }}
        />
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
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
