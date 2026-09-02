"use client";

import { useEffect, useState } from "react";
import { addCredit, deleteCredit, reorderCredits, updateCredit } from "@/lib/website/api";
import { asLoc, emptyLoc, type Loc, type WorkCredit, type WorkDetail } from "@/lib/website/work-detail";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import "./ui/work-admin.css";

type Props = {
  work: WorkDetail;
  onReload: () => Promise<void>;
};

type Draft = {
  key: string;
  id: string | null;
  role: string;
  name: Loc;
};

function fromWork(credits: WorkCredit[]): Draft[] {
  return [...credits]
    .sort((a, b) => a.sort - b.sort)
    .map((item) => ({
      key: item.id,
      id: item.id,
      role: item.role,
      name: asLoc(item.name)
    }));
}

export function WorkCreditsTab({ work, onReload }: Props) {
  const [rows, setRows] = useState<Draft[]>(() => fromWork(work.work_credits ?? []));
  const [saveState, setSaveState] = useState<PartialSaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(fromWork(work.work_credits ?? []));
    setSaveState("idle");
  }, [work.work_credits]);

  function markDirty() {
    setSaveState((cur) => (cur === "saving" ? cur : "dirty"));
  }

  function add() {
    setRows((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, id: null, role: "", name: emptyLoc() }
    ]);
    markDirty();
  }

  function patch(key: string, next: Partial<Draft>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...next } : row)));
    markDirty();
  }

  function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    setRows(next);
    markDirty();
  }

  function remove(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
    markDirty();
  }

  async function savePartial() {
    setSaveState("saving");
    setError(null);
    const existing = fromWork(work.work_credits ?? []);
    const keepIds = new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)));

    for (const item of existing) {
      if (item.id && !keepIds.has(item.id)) {
        const res = await deleteCredit(work.id, item.id);
        if (!res.ok) {
          setError(res.error);
          setSaveState("dirty");
          return;
        }
      }
    }

    const saved: { id: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (row.id) {
        const res = await updateCredit(work.id, row.id, {
          role: row.role,
          name: row.name,
          sort: i
        });
        if (!res.ok) {
          setError(res.error);
          setSaveState("dirty");
          return;
        }
        saved.push({ id: row.id });
      } else {
        const res = await addCredit(work.id, { role: row.role, name: row.name, sort: i });
        if (!res.ok) {
          setError(res.error);
          setSaveState("dirty");
          return;
        }
        const id = typeof res.data.id === "string" ? res.data.id : null;
        if (!id) {
          setError("credit_id_missing");
          setSaveState("dirty");
          return;
        }
        saved.push({ id });
      }
    }

    if (saved.length > 0) {
      const order = saved.map((item, i) => ({ id: item.id, sort: i }));
      const res = await reorderCredits(work.id, order);
      if (!res.ok) {
        setError(res.error);
        setSaveState("dirty");
        return;
      }
    }

    setSaveState("saved");
    window.setTimeout(() => setSaveState("idle"), 2000);
    await onReload();
  }

  return (
    <div className="wa">
      <div className="grph">
        <h3>크레딧</h3>
        <div className="grpr">
          <button type="button" className="btn sm" onClick={add}>
            ＋ 크레딧 추가
          </button>
          <PartialSaveBtn
            state={saveState}
            disabled={saveState !== "dirty"}
            onClick={() => void savePartial()}
          />
        </div>
      </div>
      <p className="grpd">워크 상세 맨 아래에 적힌 순서대로 나옵니다. 역할은 영문 그대로 표시됩니다.</p>

      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      <div className="box">
        <div className="crh">
          <span>역할</span>
          <span>이름 국문</span>
          <span>이름 영문</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div className="cr" key={row.key}>
            <input
              className="i"
              type="text"
              value={row.role}
              onChange={(event) => patch(row.key, { role: event.target.value })}
            />
            <input
              className="i"
              type="text"
              value={row.name.ko}
              onChange={(event) => patch(row.key, { name: { ...row.name, ko: event.target.value } })}
            />
            <input
              className="i"
              type="text"
              value={row.name.en}
              onChange={(event) => patch(row.key, { name: { ...row.name, en: event.target.value } })}
            />
            <div className="crb">
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button type="button" onClick={() => remove(row.key)}>
                ×
              </button>
            </div>
          </div>
        ))}
        <p className="hint-line cr-hint">
          역할은 영문으로 적습니다. Client · Media Design · Construction · Lighting 등
        </p>
      </div>
    </div>
  );
}
