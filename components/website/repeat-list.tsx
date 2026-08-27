"use client";

import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { SmallBtn } from "@/components/website/work-editor-ui";

export type SaveResult = { ok: true } | { ok: false; error: string };

type ItemBase = { id: string };

type RepeatListProps<T extends ItemBase> = {
  items: T[];
  onAdd: () => Promise<SaveResult | void>;
  onUpdate: (item: T) => Promise<SaveResult>;
  onDelete: (item: T) => Promise<SaveResult | void>;
  onReorder: (from: number, to: number) => Promise<SaveResult | void>;
  renderFields: (item: T, onChange: (patch: Partial<T>, opts?: { save?: boolean }) => void) => ReactNode;
  addLabel: string;
  guide?: ReactNode;
  variant?: "default" | "boxed";
};

type RepeatRowProps<T extends ItemBase> = {
  item: T;
  index: number;
  total: number;
  renderFields: RepeatListProps<T>["renderFields"];
  onUpdate: (item: T) => Promise<SaveResult>;
  onDelete: (item: T) => Promise<SaveResult | void>;
  onMove: (dir: -1 | 1) => void;
  variant: "default" | "boxed";
};

function RepeatRow<T extends ItemBase>({
  item,
  index,
  total,
  renderFields,
  onUpdate,
  onDelete,
  onMove,
  variant
}: RepeatRowProps<T>) {
  const [local, setLocal] = useState(item);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const localRef = useRef(local);
  const snapRef = useRef(JSON.stringify(item));
  localRef.current = local;

  useEffect(() => {
    setLocal(item);
    snapRef.current = JSON.stringify(item);
  }, [item]);

  async function persist(next: T) {
    if (JSON.stringify(next) === snapRef.current) return;
    setSave("saving");
    setError(null);
    try {
      const res = await onUpdate(next);
      if (!res.ok) {
        setSave("idle");
        setError(res.error);
        setLocal(item);
        localRef.current = item;
        return;
      }
      snapRef.current = JSON.stringify(next);
      setSave("saved");
      window.setTimeout(() => setSave((cur) => (cur === "saved" ? "idle" : cur)), 1200);
    } finally {
      setSave((cur) => (cur === "saving" ? "idle" : cur));
    }
  }

  function onChange(patch: Partial<T>, opts?: { save?: boolean }) {
    const next = { ...localRef.current, ...patch };
    setLocal(next);
    localRef.current = next;
    if (opts?.save) void persist(next);
  }

  function onRowBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void persist(localRef.current);
  }

  async function remove() {
    if (!window.confirm("삭제할까요?")) return;
    const res = await onDelete(item);
    if (res && !res.ok) setError(res.error);
  }

  if (variant === "boxed") {
    return (
      <div className="repeat-row" onBlur={onRowBlur}>
        <div className="repeat-fields">{renderFields(local, onChange)}</div>
        <div className="repeat-acts">
          {save === "saving" ? <span className="repeat-save">저장 중</span> : null}
          {save === "saved" ? <span className="repeat-save">저장됨</span> : null}
          <button
            type="button"
            className="ico"
            disabled={index <= 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void persist(localRef.current).then(() => onMove(-1));
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="ico"
            disabled={index >= total - 1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void persist(localRef.current).then(() => onMove(1));
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="ico"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void remove()}
          >
            ✕
          </button>
        </div>
        {error ? <p className="repeat-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2" onBlur={onRowBlur}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{renderFields(local, onChange)}</div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {save === "saving" ? <span className="text-[11px] text-slate-400">저장 중</span> : null}
          {save === "saved" ? <span className="text-[11px] text-emerald-600">저장됨</span> : null}
          <button
            type="button"
            disabled={index <= 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void persist(localRef.current).then(() => onMove(-1));
            }}
            className="text-xs text-slate-400 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index >= total - 1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void persist(localRef.current).then(() => onMove(1));
            }}
            className="text-xs text-slate-400 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void remove()}
            className="text-xs text-rose-600"
          >
            삭제
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function RepeatList<T extends ItemBase>({
  items,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
  renderFields,
  addLabel,
  guide,
  variant = "default"
}: RepeatListProps<T>) {
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setListError(null);
    try {
      const res = await onAdd();
      if (res && !res.ok) setListError(res.error);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    setListError(null);
    const res = await onReorder(index, next);
    if (res && !res.ok) setListError(res.error);
  }

  const rows = items.map((item, index) => (
    <RepeatRow
      key={item.id}
      item={item}
      index={index}
      total={items.length}
      renderFields={renderFields}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onMove={(dir) => void move(index, dir)}
      variant={variant}
    />
  ));

  return (
    <div>
      {variant === "boxed" ? (
        items.length > 0 ? <div className="repeat-box">{rows}</div> : null
      ) : (
        <div className="space-y-2">{rows}</div>
      )}
      <div className={variant === "boxed" ? undefined : "mt-2"} style={variant === "boxed" ? { marginTop: 7 } : undefined}>
        {variant === "boxed" ? (
          <button type="button" className="btn sm" disabled={busy} onClick={() => void add()}>
            {addLabel}
          </button>
        ) : (
          <SmallBtn disabled={busy} onClick={() => void add()}>
            {addLabel}
          </SmallBtn>
        )}
      </div>
      {listError ? <p className="mt-1 text-xs text-rose-600">{listError}</p> : null}
      {guide}
    </div>
  );
}
