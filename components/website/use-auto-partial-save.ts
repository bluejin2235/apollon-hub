"use client";

/**
 * 홈페이지 어드민 자동 부분저장 공용 훅.
 * - 입력 멈춤 → 디바운스 후 원본 저장
 * - blur / 「부분 저장」 → 즉시 저장(flush)
 * - 공개(스냅샷)는 호출하지 않는다
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useFullSaveOptional } from "@/components/website/full-save-registry";
import type { PartialSaveState } from "@/components/website/partial-save-btn";

export const AUTO_PARTIAL_SAVE_DEBOUNCE_MS = 1500;
export const AUTO_PARTIAL_SAVED_FLASH_MS = 1200;

export type AutoPartialSaveStatus = PartialSaveState | "error";

type Options = {
  /** 원본만 저장. true = 성공 */
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

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markDirty = useCallback(() => {
    setState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  const runPersist = useCallback(async (): Promise<boolean> => {
    if (!enabledRef.current) return true;
    if (stateRef.current === "saving") return false;
    setState("saving");
    try {
      const ok = await persistRef.current();
      if (!ok) {
        setState("error");
        return false;
      }
      setState("saved");
      window.setTimeout(
        () => setState((cur) => (cur === "saved" ? "idle" : cur)),
        AUTO_PARTIAL_SAVED_FLASH_MS
      );
      return true;
    } catch {
      setState("error");
      return false;
    }
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (!enabledRef.current) return true;
    if (stateRef.current !== "dirty" && stateRef.current !== "error") {
      return true;
    }
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
      const cur = stateRef.current;
      return cur === "dirty" || cur === "error" || cur === "saving";
    });
  }, [flushId, fullSave]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const resetFromServer = useCallback(() => {
    clearTimer();
    setState("idle");
  }, [clearTimer]);

  return {
    state,
    /** PartialSaveBtn 에 그대로 넘김 (error 포함 → 「저장 실패 · 다시 시도」) */
    buttonState: state as PartialSaveState,
    markDirty,
    schedule,
    flush,
    retry: runPersist,
    resetFromServer
  };
}
