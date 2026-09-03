"use client";

import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { replaceCredits } from "@/lib/website/api";
import { asLoc, emptyLoc, type Loc, type WorkCredit, type WorkDetail } from "@/lib/website/work-detail";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import "./ui/work-admin.css";

export type CreditsTabHandle = {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
};

type Props = {
  work: WorkDetail;
  onReload: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<CreditsTabHandle | null>;
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

function sameRows(a: Draft[], b: Draft[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.id !== right.id) return false;
    if (left.role !== right.role) return false;
    if (left.name.ko !== right.name.ko || left.name.en !== right.name.en) return false;
  }
  return true;
}

function describeCreditError(error: string, details?: unknown): string {
  const rec = details && typeof details === "object" ? (details as Record<string, unknown>) : null;
  const detailMessage = typeof rec?.message === "string" ? rec.message : null;
  if (detailMessage) return detailMessage;

  if (error === "credit_name_ko_required") return "이름 국문은 필수입니다";
  if (error === "credit_role_required") return "역할을 적어 주세요";
  if (error === "invalid_name") return "이름 형식이 올바르지 않습니다";
  if (error === "invalid_items") return "크레딧 목록 형식이 올바르지 않습니다";
  if (error === "database_error") {
    const msg = typeof rec?.message === "string" ? rec.message : "";
    if (msg.includes("work_credits_name_ko")) return "이름 국문은 필수입니다";
    return msg || "데이터베이스에 저장하지 못했습니다";
  }
  if (error === "request_failed") return "서버가 크레딧 저장을 거절했습니다";
  if (error === "network_error") return "연결이 끊어졌습니다";
  if (error === "unauthorized") return "로그인이 필요합니다";
  return error || "저장에 실패했습니다";
}

export function WorkCreditsTab({ work, onReload, onDirtyChange, saveRef }: Props) {
  const saved = useMemo(() => fromWork(work.work_credits ?? []), [work.work_credits]);
  const [rows, setRows] = useState<Draft[]>(saved);
  const [saveState, setSaveState] = useState<PartialSaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = !sameRows(rows, saved);

  useEffect(() => {
    if (dirty) return;
    setRows(saved);
    setSaveState("idle");
  }, [saved, dirty]);

  useEffect(() => {
    setSaveState((state) => {
      if (state === "saving") return state;
      if (dirty) return "dirty";
      if (state === "dirty") return "idle";
      return state;
    });
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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

  async function savePartial(): Promise<boolean> {
    setSaveState("saving");
    setError(null);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!row.role.trim()) {
        setError(`${i + 1}번째 줄: 역할을 적어 주세요`);
        setSaveState("dirty");
        return false;
      }
      if (!row.name.ko.trim()) {
        setError(`${i + 1}번째 줄: 이름 국문은 필수입니다`);
        setSaveState("dirty");
        return false;
      }
    }

    const items = rows.map((row, i) => ({
      ...(row.id ? { id: row.id } : {}),
      role: row.role.trim(),
      name: { ko: row.name.ko.trim(), en: row.name.en.trim() },
      sort: i
    }));

    const res = await replaceCredits(work.id, items);
    if (!res.ok) {
      setError(describeCreditError(res.error, res.details));
      setSaveState("dirty");
      return false;
    }

    setSaveState("saved");
    window.setTimeout(() => setSaveState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
    await onReload();
    return true;
  }

  useImperativeHandle(
    saveRef,
    () => ({
      isDirty: () => dirty,
      save: () => savePartial()
    }),
    // savePartial closes over rows; rebind when rows/dirty change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, rows, work.id]
  );

  return (
    <div className="wa">
      <div className="grph">
        <h3>크레딧</h3>
        <div className="grpr">
          <button type="button" className="btn sm" onClick={add}>
            ＋ 크레딧 추가
          </button>
          <PartialSaveBtn state={saveState} onClick={() => void savePartial()} />
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
