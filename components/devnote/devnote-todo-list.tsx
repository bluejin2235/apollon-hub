"use client";

import { useEffect, useMemo, useState } from "react";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";
import {
  deleteDevnoteTodo,
  setDevnoteTodoDone,
  upsertDevnoteTodo
} from "@/lib/devnote/service";
import type { DevnoteTodoRow } from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

type Draft = { title: string; body: string };

export function DevnoteTodoList({
  serviceId,
  items,
  adding,
  onAddingChange,
  onChange
}: {
  serviceId: string;
  items: DevnoteTodoRow[];
  adding: boolean;
  onAddingChange: (value: boolean) => void;
  onChange: (items: DevnoteTodoRow[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) return;
    setOpenId(null);
    setDraft({ title: "", body: "" });
    setError(null);
  }, [adding]);

  const sorted = useMemo(
    () => [...items.filter((t) => !t.done), ...items.filter((t) => t.done)],
    [items]
  );

  function openNew() {
    setOpenId(null);
    setDraft({ title: "", body: "" });
    setError(null);
    onAddingChange(true);
  }

  function openRow(row: DevnoteTodoRow) {
    onAddingChange(false);
    setOpenId(row.id);
    setDraft({ title: row.title, body: row.body ?? "" });
    setError(null);
  }

  function cancel() {
    onAddingChange(false);
    setOpenId(null);
    setError(null);
  }

  async function save() {
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const nextOrder =
        Math.max(0, ...items.map((t) => t.sort_order)) + 10;
      const saved = await upsertDevnoteTodo(supabase, {
        id: adding ? undefined : openId ?? undefined,
        service_id: serviceId,
        title: draft.title,
        body: draft.body,
        sort_order: adding ? nextOrder : undefined
      });
      if (adding) onChange([...items, saved]);
      else onChange(items.map((row) => (row.id === saved.id ? saved : row)));
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDevnoteTodo(supabase, id);
      onChange(items.filter((row) => row.id !== id));
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: DevnoteTodoRow) {
    const snapshot = items;
    const next = !row.done;
    onChange(
      snapshot.map((item) => (item.id === row.id ? { ...item, done: next } : item))
    );
    try {
      await setDevnoteTodoDone(supabase, row.id, next);
    } catch (err) {
      onChange(snapshot);
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    }
  }

  const form = (
    <div className="rounded-lg border border-[#E2E5EA] bg-[#F7F8FA] p-3">
      {error && (adding || openId) ? <DevnoteError message={error} /> : null}
      <label className="text-[12px] text-[#858C9A]">
        제목
        <input
          value={draft.title}
          disabled={saving}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="mt-1 w-full rounded-md border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[13px] text-[#15171C]"
        />
      </label>
      <label className="mt-2 block text-[12px] text-[#858C9A]">
        설명
        <textarea
          value={draft.body}
          disabled={saving}
          rows={3}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          className="mt-1 w-full rounded-md border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[13px] text-[#15171C]"
        />
      </label>
      <div className="mt-3 flex gap-2">
        <DevnoteButton
          tone="primary"
          disabled={saving || !draft.title.trim()}
          onClick={() => void save()}
        >
          {saving ? "저장 중" : "저장"}
        </DevnoteButton>
        {!adding && openId ? (
          <DevnoteButton disabled={saving} onClick={() => void remove(openId)}>
            삭제
          </DevnoteButton>
        ) : null}
        <DevnoteButton disabled={saving} onClick={cancel}>
          취소
        </DevnoteButton>
      </div>
    </div>
  );

  if (items.length === 0 && !adding) {
    return (
      <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
        {error ? <DevnoteError message={error} /> : null}
        <p className="text-[13px] text-[#858C9A]">할 일이 없습니다.</p>
        <DevnoteButton className="mt-3" onClick={openNew}>
          추가
        </DevnoteButton>
      </div>
    );
  }

  return (
    <div>
      {error && !adding && !openId ? <DevnoteError message={error} /> : null}
      {adding ? <div className="mb-4">{form}</div> : null}
      <ul>
        {sorted.map((row) => {
          const isOpen = !adding && openId === row.id;
          return (
            <li
              key={row.id}
              className={`flex gap-3 border-b border-[#EFF1F4] py-3 last:border-b-0 ${
                row.done ? "opacity-50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={row.done}
                onChange={() => void toggle(row)}
                className="mt-1 accent-[#2B5BD7]"
                aria-label={`${row.title} 완료`}
              />
              <div className="min-w-0 flex-1">
                {isOpen ? (
                  form
                ) : (
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className="w-full text-left"
                  >
                    <p
                      className={`font-semibold text-[#15171C] ${
                        row.done ? "line-through" : ""
                      }`}
                    >
                      {row.title}
                    </p>
                    {row.body ? (
                      <p className="mt-0.5 text-[12.5px] text-[#858C9A]">{row.body}</p>
                    ) : null}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
