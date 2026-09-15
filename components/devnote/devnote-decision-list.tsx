"use client";

import { useEffect, useState } from "react";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";
import {
  deleteDevnoteDecision,
  todayKstYmd,
  upsertDevnoteDecision
} from "@/lib/devnote/service";
import type { DevnoteDecisionRow } from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

type Draft = {
  decided_on: string;
  what: string;
  why: string;
  is_key: boolean;
};

function emptyDraft(): Draft {
  return { decided_on: todayKstYmd(), what: "", why: "", is_key: false };
}

function fromRow(row: DevnoteDecisionRow): Draft {
  return {
    decided_on: row.decided_on,
    what: row.what,
    why: row.why,
    is_key: row.is_key
  };
}

export function DevnoteDecisionList({
  serviceId,
  items,
  adding,
  onAddingChange,
  onChange
}: {
  serviceId: string;
  items: DevnoteDecisionRow[];
  adding: boolean;
  onAddingChange: (value: boolean) => void;
  onChange: (items: DevnoteDecisionRow[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) return;
    setOpenId(null);
    setDraft(emptyDraft());
    setError(null);
  }, [adding]);

  const editingNew = adding;
  const editingId = editingNew ? "new" : openId;

  function openNew() {
    setOpenId(null);
    setDraft(emptyDraft());
    setError(null);
    onAddingChange(true);
  }

  function openRow(row: DevnoteDecisionRow) {
    onAddingChange(false);
    setOpenId(row.id);
    setDraft(fromRow(row));
    setError(null);
  }

  function cancel() {
    onAddingChange(false);
    setOpenId(null);
    setError(null);
  }

  async function save() {
    if (!draft.what.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertDevnoteDecision(supabase, {
        id: editingNew ? undefined : openId ?? undefined,
        service_id: serviceId,
        decided_on: draft.decided_on,
        what: draft.what,
        why: draft.why,
        is_key: draft.is_key
      });
      if (editingNew) {
        onChange(
          [...items, saved].sort((a, b) => b.decided_on.localeCompare(a.decided_on))
        );
      } else {
        onChange(
          items
            .map((row) => (row.id === saved.id ? saved : row))
            .sort((a, b) => b.decided_on.localeCompare(a.decided_on))
        );
      }
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
      await deleteDevnoteDecision(supabase, id);
      onChange(items.filter((row) => row.id !== id));
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <DecisionForm
      draft={draft}
      saving={saving}
      error={error}
      showDelete={!editingNew && Boolean(openId)}
      onChange={setDraft}
      onSave={() => void save()}
      onCancel={cancel}
      onDelete={() => openId && void remove(openId)}
    />
  );

  if (items.length === 0 && !editingNew) {
    return (
      <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
        <p className="text-[13px] text-[#858C9A]">아직 기록이 없습니다.</p>
        <DevnoteButton className="mt-3" onClick={openNew}>
          추가
        </DevnoteButton>
      </div>
    );
  }

  return (
    <div>
      {editingNew ? <div className="mb-5">{form}</div> : null}
      <div className="ml-1 border-l-2 border-[#E2E5EA] pl-[18px]">
        {items.map((row) => {
          const open = !editingNew && openId === row.id;
          return (
            <div key={row.id} className="relative pb-[22px] last:pb-0">
              <span
                className={`absolute top-1.5 h-[9px] w-[9px] rounded-full border-2 bg-white -left-[25px] ${
                  row.is_key
                    ? "border-[#2B5BD7] bg-[#2B5BD7]"
                    : "border-[#858C9A]"
                }`}
                aria-hidden
              />
              {open ? (
                form
              ) : (
                <button
                  type="button"
                  onClick={() => openRow(row)}
                  className="w-full rounded-md px-1 py-0.5 text-left hover:bg-[#F7F8FA]"
                >
                  <p className="font-mono text-[11.5px] text-[#858C9A]">
                    {row.decided_on}
                  </p>
                  <p className="mt-0.5 font-semibold text-[#15171C]">{row.what}</p>
                  {row.why ? (
                    <p className="mt-0.5 text-[13px] text-[#4A505C]">{row.why}</p>
                  ) : null}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DecisionForm({
  draft,
  saving,
  error,
  showDelete,
  onChange,
  onSave,
  onCancel,
  onDelete
}: {
  draft: Draft;
  saving: boolean;
  error: string | null;
  showDelete: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E2E5EA] bg-[#F7F8FA] p-3">
      {error ? <DevnoteError message={error} /> : null}
      <div className="grid gap-2">
        <label className="text-[12px] text-[#858C9A]">
          날짜
          <input
            type="date"
            value={draft.decided_on}
            disabled={saving}
            onChange={(e) => onChange({ ...draft, decided_on: e.target.value })}
            className="mt-1 w-full rounded-md border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[13px] text-[#15171C]"
          />
        </label>
        <label className="text-[12px] text-[#858C9A]">
          무엇을
          <input
            value={draft.what}
            disabled={saving}
            onChange={(e) => onChange({ ...draft, what: e.target.value })}
            className="mt-1 w-full rounded-md border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[13px] text-[#15171C]"
          />
        </label>
        <label className="text-[12px] text-[#858C9A]">
          왜
          <textarea
            value={draft.why}
            disabled={saving}
            rows={3}
            onChange={(e) => onChange({ ...draft, why: e.target.value })}
            className="mt-1 w-full rounded-md border border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[13px] text-[#15171C]"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[#15171C]">
          <input
            type="checkbox"
            checked={draft.is_key}
            disabled={saving}
            onChange={(e) => onChange({ ...draft, is_key: e.target.checked })}
            className="accent-[#2B5BD7]"
          />
          중요
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <DevnoteButton tone="primary" disabled={saving || !draft.what.trim()} onClick={onSave}>
          {saving ? "저장 중" : "저장"}
        </DevnoteButton>
        {showDelete ? (
          <DevnoteButton disabled={saving} onClick={onDelete}>
            삭제
          </DevnoteButton>
        ) : null}
        <DevnoteButton disabled={saving} onClick={onCancel}>
          취소
        </DevnoteButton>
      </div>
    </div>
  );
}
