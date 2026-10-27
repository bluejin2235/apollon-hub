"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

export type FlushFn = () => Promise<boolean>;

type FullSaveApi = {
  registerFlush: (id: string, fn: FlushFn) => () => void;
  runFlushes: () => Promise<boolean>;
  savedTick: number;
  markSaved: () => void;
};

const FullSaveContext = createContext<FullSaveApi | null>(null);

export function FullSaveProvider({ children }: { children: ReactNode }) {
  const flushes = useRef(new Map<string, FlushFn>());
  const [savedTick, setSavedTick] = useState(0);

  const registerFlush = useCallback((id: string, fn: FlushFn) => {
    flushes.current.set(id, fn);
    return () => {
      if (flushes.current.get(id) === fn) flushes.current.delete(id);
    };
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

  const value = useMemo(
    () => ({ registerFlush, runFlushes, savedTick, markSaved }),
    [registerFlush, runFlushes, savedTick, markSaved]
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
