"use client";

/**
 * 홈페이지 어드민 자동 부분저장 공용 훅.
 * - 입력 멈춤 → 디바운스 후 원본 저장
 * - blur / 「부분 저장」 / 공개 전 flush → 대기 중인 변경을 즉시 저장
 * - 저장 중에 또 바뀌면 끝난 뒤 한 번 더 저장
 * - 실패하면 error. 다시 flush 하면 재시도
 * - 공개(스냅샷)는 호출하지 않는다
 *
 * 상태(setState)는 렌더 뒤에야 바뀐다. blur 는 그 전에 온다.
 * 그래서 "수정됨" 여부는 ref 로 바로 세고, flush 가 타이머만 지우고
 * 저장을 건너뛰지 않게 한다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useFullSaveOptional } from "@/components/website/full-save-registry";
import type { PartialSaveState } from "@/components/website/partial-save-btn";

export const AUTO_PARTIAL_SAVE_DEBOUNCE_MS = 1500;
export const AUTO_PARTIAL_SAVED_FLASH_MS = 1200;

export type AutoPartialSaveStatus = PartialSaveState | "error";

type Options = {
  /** 원본만 저장. true = 성공. 호출 시점의 ref 를 읽어야 한다. */
  persist: () => Promise<boolean>;
  /** FullSaveProvider 등록 id. 없으면 전체 저장·이탈 경고에 안 묶음 */
  flushId?: string;
  debounceMs?: number;
  /** false 면 schedule/flush no-op (모달 열린 동안 등) */
  enabled?: boolean;
};

export function useAutoPartialSave({
  persist,
  flushId,
  debounceMs = AUTO_PARTIAL_SAVE_DEBOUNCE_MS,
  enabled = true
}: Options) {
  const fullSave = useFullSaveOptional();
  const [state, setState] = useState<AutoPartialSaveStatus>("idle");
  const stateRef = useRef(state);
  stateRef.current = state;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** schedule/markDirty 할 때마다 증가. 렌더를 기다리지 않는다. */
  const editRev = useRef(0);
  /** 이 번호까지는 persist 가 성공했다. */
  const savedRev = useRef(0);
  const inflight = useRef<Promise<boolean> | null>(null);

  const hasPending = useCallback(() => editRev.current !== savedRev.current, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markDirty = useCallback(() => {
    editRev.current += 1;
    setState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  const runPersist = useCallback(async (): Promise<boolean> => {
    if (!enabledRef.current) return true;

    const running = inflight.current;
    if (running) {
      const ok = await running;
      if (!ok) return false;
      if (editRev.current === savedRev.current) return true;
    }

    if (editRev.current === savedRev.current && stateRef.current !== "error") return true;

    const captured = editRev.current;
    setState("saving");
    const job = (async () => {
      try {
        const ok = await persistRef.current();
        if (!ok) {
          setState("error");
          return false;
        }
        if (savedRev.current < captured) savedRev.current = captured;
        if (editRev.current !== savedRev.current) {
          setState((cur) => (cur === "saving" ? "dirty" : cur));
          return true;
        }
        if (savedRev.current === captured) {
          setState("saved");
          window.setTimeout(
            () => setState((cur) => (cur === "saved" ? "idle" : cur)),
            AUTO_PARTIAL_SAVED_FLASH_MS
          );
        }
        return true;
      } catch {
        setState("error");
        return false;
      }
    })();
    inflight.current = job;
    const ok = await job;
    if (inflight.current === job) inflight.current = null;
    if (!ok) return false;
    if (editRev.current !== savedRev.current) return runPersist();
    return true;
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (!enabledRef.current) return true;
    if (editRev.current === savedRev.current && stateRef.current !== "error") return true;
    return runPersist();
  }, [clearTimer, runPersist]);

  const schedule = useCallback(() => {
    if (!enabledRef.current) return;
    markDirty();
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runPersist();
    }, debounceMs);
  }, [clearTimer, debounceMs, markDirty, runPersist]);

  useEffect(() => {
    if (!flushId || !fullSave) return;
    return fullSave.registerFlush(flushId, flush);
  }, [flush, flushId, fullSave]);

  useEffect(() => {
    if (!flushId || !fullSave) return;
    return fullSave.registerDirty(flushId, () => {
      if (editRev.current !== savedRev.current) return true;
      const cur = stateRef.current;
      return cur === "dirty" || cur === "error" || cur === "saving";
    });
  }, [flushId, fullSave]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const resetFromServer = useCallback(() => {
    clearTimer();
    savedRev.current = editRev.current;
    setState("idle");
  }, [clearTimer]);

  return {
    state,
    /** PartialSaveBtn 에 그대로 넘김 (error → 「저장 실패 · 다시 시도」) */
    buttonState: state as PartialSaveState,
    hasPending,
    markDirty,
    schedule,
    flush,
    retry: runPersist,
    resetFromServer
  };
}
