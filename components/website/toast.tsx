"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type ToastTone = "ok" | "warn" | "error";

export type ToastAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type ShowToastInput = {
  message: string;
  action?: ToastAction;
  actions?: ToastAction[];
  tone: ToastTone;
  /** 기본 3000ms */
  durationMs?: number;
};

type ToastItem = {
  id: string;
  message: string;
  actions: ToastAction[];
  tone: ToastTone;
  durationMs: number;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, number>();
let seq = 0;

function emit() {
  for (const listener of listeners) listener(items);
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
}

export function dismissToast(id: string) {
  clearTimer(id);
  items = items.filter((item) => item.id !== id);
  emit();
}

export function showToast(input: ShowToastInput): string {
  const id = `toast-${++seq}`;
  const actions = [
    ...(input.action ? [input.action] : []),
    ...(input.actions ?? [])
  ];
  const durationMs = input.durationMs ?? 3000;
  items = [...items, { id, message: input.message, actions, tone: input.tone, durationMs }];
  emit();

  if (durationMs > 0 && typeof window !== "undefined") {
    timers.set(
      id,
      window.setTimeout(() => {
        dismissToast(id);
      }, durationMs)
    );
  }

  return id;
}

function toneClass(tone: ToastTone) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

function actionClass(tone: ToastTone) {
  if (tone === "ok") return "text-emerald-800 underline decoration-emerald-400 hover:text-emerald-950";
  if (tone === "warn") return "text-amber-800 underline decoration-amber-400 hover:text-amber-950";
  return "text-rose-800 underline decoration-rose-400 hover:text-rose-950";
}

export function WebsiteToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>(items);

  const sync = useCallback((next: ToastItem[]) => {
    setToasts(next);
  }, []);

  useEffect(() => {
    listeners.add(sync);
    setToasts(items);
    return () => {
      listeners.delete(sync);
    };
  }, [sync]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || items.length === 0) return;
      const last = items[items.length - 1];
      if (last) dismissToast(last.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-4 z-[70] flex w-[min(100vw-2rem,22rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-3 py-2.5 text-sm shadow-md ${toneClass(toast.tone)}`}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{toast.message}</p>
              {toast.actions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {toast.actions.map((action) =>
                    action.href ? (
                      <Link
                        key={action.label}
                        href={action.href}
                        target={action.href.startsWith("http") ? "_blank" : undefined}
                        rel={action.href.startsWith("http") ? "noreferrer" : undefined}
                        className={`text-xs font-semibold ${actionClass(toast.tone)}`}
                        onClick={() => {
                          action.onClick?.();
                          dismissToast(toast.id);
                        }}
                      >
                        {action.label}
                      </Link>
                    ) : (
                      <button
                        key={action.label}
                        type="button"
                        className={`text-xs font-semibold ${actionClass(toast.tone)}`}
                        onClick={() => {
                          action.onClick?.();
                          dismissToast(toast.id);
                        }}
                      >
                        {action.label}
                      </button>
                    )
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="닫기"
              className="shrink-0 text-base leading-none opacity-60 hover:opacity-100"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
