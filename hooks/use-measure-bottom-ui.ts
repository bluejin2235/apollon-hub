"use client";

import { useEffect, type RefObject } from "react";

export const BOTTOM_UI_CSS_VAR = "--bottom-ui";

export function setBottomUiPx(px: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(BOTTOM_UI_CSS_VAR, `${Math.max(0, Math.round(px))}px`);
}

export function clearBottomUi() {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(BOTTOM_UI_CSS_VAR, "0px");
}

/** Measure a fixed bottom element and publish its height as --bottom-ui. */
export function useMeasureBottomUi(
  ref: RefObject<HTMLElement | null>,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) {
      clearBottomUi();
      return;
    }

    let ro: ResizeObserver | null = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      const el = ref.current;
      if (!el) {
        requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        // Distance from viewport bottom to the top of the element
        // (accounts for footers stacked above a tab bar).
        const rect = el.getBoundingClientRect();
        setBottomUiPx(window.innerHeight - rect.top);
      };
      update();
      ro = new ResizeObserver(update);
      ro.observe(el);
    };

    attach();
    return () => {
      cancelled = true;
      ro?.disconnect();
      clearBottomUi();
    };
  }, [ref, enabled]);
}

/** Publish a constant --bottom-ui while mounted. */
export function useConstantBottomUi(px: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    setBottomUiPx(px);
    return () => clearBottomUi();
  }, [px, enabled]);
}
