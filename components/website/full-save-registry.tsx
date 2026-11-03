"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

export type FlushFn = () => Promise<boolean>;
export type DirtyFn = () => boolean;

type FullSaveApi = {
  registerFlush: (id: string, fn: FlushFn) => () => void;
  registerDirty: (id: string, fn: DirtyFn) => () => void;
  runFlushes: () => Promise<boolean>;
  hasDirty: () => boolean;
  savedTick: number;
  markSaved: () => void;
};

const FullSaveContext = createContext<FullSaveApi | null>(null);

export function FullSaveProvider({ children }: { children: ReactNode }) {
  const flushes = useRef(new Map<string, FlushFn>());
  const dirties = useRef(new Map<string, DirtyFn>());
  const [savedTick, setSavedTick] = useState(0);

  const registerFlush = useCallback((id: string, fn: FlushFn) => {
    flushes.current.set(id, fn);
    return () => {
      if (flushes.current.get(id) === fn) flushes.current.delete(id);
    };
  }, []);

  const registerDirty = useCallback((id: string, fn: DirtyFn) => {
    dirties.current.set(id, fn);
    return () => {
      if (dirties.current.get(id) === fn) dirties.current.delete(id);
    };
  }, []);

  const hasDirty = useCallback(() => {
    for (const fn of dirties.current.values()) {
      try {
        if (fn()) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }, []);

  const runFlushes = useCallback(async () => {
    for (const fn of [...flushes.current.values()]) {
      try {
        if (!(await fn())) return false;
      } catch {
        return false;
      }
    }
    return true;
  }, []);

  const markSaved = useCallback(() => {
    setSavedTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDirty]);

  const value = useMemo(
    () => ({
      registerFlush,
      registerDirty,
      runFlushes,
      hasDirty,
      savedTick,
      markSaved
    }),
    [registerFlush, registerDirty, runFlushes, hasDirty, savedTick, markSaved]
  );

  return <FullSaveContext.Provider value={value}>{children}</FullSaveContext.Provider>;
}

export function useFullSave(): FullSaveApi {
  const ctx = useContext(FullSaveContext);
  if (!ctx) {
    throw new Error("useFullSave must be used within FullSaveProvider");
  }
  return ctx;
}

/** Provider 밖(페이지 메타 등)에서는 null */
export function useFullSaveOptional(): FullSaveApi | null {
  return useContext(FullSaveContext);
}
