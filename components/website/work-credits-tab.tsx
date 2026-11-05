"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useFullSave } from "@/components/website/full-save-registry";
import { replaceCredits } from "@/lib/website/api";
import { apiFailMessage } from "@/lib/website/api-fail-message";
import { asLoc, emptyLoc, type Loc, type WorkCredit, type WorkDetail } from "@/lib/website/work-detail";
import { PartialSaveBtn } from "@/components/website/partial-save-btn";
import { useAutoPartialSave } from "@/components/website/use-auto-partial-save";
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
  if (error === "credit_name_ko_required") return "이름 국문은 필수입니다";
  if (error === "credit_role_required") return "역할을 적어 주세요";
  if (error === "invalid_name") return "이름 형식이 올바르지 않습니다";
  if (error === "invalid_items") return "크레딧 목록 형식이 올바르지 않습니다";
  if (error === "request_failed") return "서버가 크레딧 저장을 거절했습니다";
  return apiFailMessage({ error, details });
}

export function WorkCreditsTab({ work, onReload, onDirtyChange, saveRef }: Props) {
  const { registerFlush } = useFullSave();
  const saved = useMemo(() => fromWork(work.work_credits ?? []), [work.work_credits]);
  const [rows, setRows] = useState<Draft[]>(saved);
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const dirty = !sameRows(rows, saved);

  const auto = useAutoPartialSave({
    flushId: "work-credits-auto",
    persist: async () => {
      setError(null);
      const current = rowsRef.current;
      for (let i = 0; i < current.length; i++) {
        const row = current[i]!;
        if (!row.role.trim()) {
          setError(`${i + 1}번째 줄: 역할을 적어 주세요`);
          return false;
        }
        if (!row.name.ko.trim()) {
          setError(`${i + 1}번째 줄: 이름 국문은 필수입니다`);
          return false;
        }
      }
      const items = current.map((row, i) => ({
        ...(row.id ? { id: row.id } : {}),
        role: row.role.trim(),
        name: { ko: row.name.ko.trim(), en: row.name.en.trim() },
        sort: i
      }));
      const res = await replaceCredits(work.id, items);
      if (!res.ok) {
        setError(describeCreditError(res.error, res.details));
        return false;
      }
      await onReload();
      return true;
    }
  });

  useEffect(() => {
    if (dirty) return;
    setRows(saved);
    auto.resetFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty || auto.state === "dirty" || auto.state === "error");
  }, [dirty, auto.state, onDirtyChange]);

  useEffect(
    () =>
      registerFlush("work-credits", async () => {
        if (!dirty && auto.state !== "dirty" && auto.state !== "error") return true;
        return auto.flush();
      }),
    [registerFlush, dirty, auto]
  );

  useImperativeHandle(
    saveRef,
    () => ({
      isDirty: () => dirty || auto.state === "dirty" || auto.state === "error",
      save: () => auto.flush()
    }),
    [dirty, auto]
  );

  const commitRows = useCallback(
    (next: Draft[]) => {
      rowsRef.current = next;
      setRows(next);
      auto.schedule();
    },
    [auto]
  );

  const add = useCallback(() => {
    commitRows([
      ...rowsRef.current,
      { key: `new-${Date.now()}`, id: null, role: "", name: emptyLoc() }
    ]);
  }, [commitRows]);

  function patch(key: string, next: Partial<Draft>) {
    commitRows(
      rowsRef.current.map((row) => (row.key === key ? { ...row, ...next } : row))
    );
  }

  function move(index: number, dir: -1 | 1) {
    const current = rowsRef.current;
    const to = index + dir;
    if (to < 0 || to >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    commitRows(next);
  }

  function remove(key: string) {
    commitRows(rowsRef.current.filter((row) => row.key !== key));
  }

  return (
    <div className="wa">
      <div className="grph">
        <h3>크레딧</h3>
        <div className="grpr">
          <button type="button" className="btn sm" onClick={add}>
            ＋ 크레딧 추가
          </button>
          <PartialSaveBtn state={auto.buttonState} onClick={() => void auto.flush()} />
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
              onBlur={() => void auto.flush()}
            />
            <input
              className="i"
              type="text"
              value={row.name.ko}
              onChange={(event) => patch(row.key, { name: { ...row.name, ko: event.target.value } })}
              onBlur={() => void auto.flush()}
            />
            <input
              className="i"
              type="text"
              value={row.name.en}
              onChange={(event) => patch(row.key, { name: { ...row.name, en: event.target.value } })}
              onBlur={() => void auto.flush()}
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
