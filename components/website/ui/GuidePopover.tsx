"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

import { WikiBodyMarkdown } from "@/components/wiki/WikiBodyMarkdown";
import { WEBSITE_GUIDE_DOC_SLUG } from "@/components/website/guide-doc-link";
import {
  fetchWikiSection,
  type WikiSectionResponse
} from "@/lib/wiki/guide-section-fetch";
import {
  formatGuideSectionDisplayTitle,
  formatGuideSectionSubtitle,
  guideSectionCategory
} from "@/lib/wiki/guide-section-preview";

import "./guide-popover.css";

const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 300;

type GuidePopoverProps = {
  anchorId: string;
  docSlug?: string;
  children: ReactNode;
};

function isQuestionTrigger(children: ReactNode): boolean {
  if (children === "?") return true;
  if (typeof children === "string") return children.trim() === "?";
  const only = Children.toArray(children);
  if (only.length === 1 && typeof only[0] === "string") {
    return only[0].trim() === "?";
  }
  if (
    only.length === 1 &&
    isValidElement<{ children?: ReactNode }>(only[0]) &&
    typeof only[0].props.children === "string"
  ) {
    return only[0].props.children.trim() === "?";
  }
  return false;
}

function canUseHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function GuidePopover({
  anchorId,
  docSlug = WEBSITE_GUIDE_DOC_SLUG,
  children
}: GuidePopoverProps) {
  const popId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [arrowLeft, setArrowLeft] = useState(26);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [data, setData] = useState<WikiSectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const question = isQuestionTrigger(children);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const loadSection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const section = await fetchWikiSection(docSlug, anchorId);
      setData(section);
    } catch (err) {
      setError(err instanceof Error ? err.message : "가이드를 불러오지 못했습니다.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [anchorId, docSlug]);

  const openNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(true);
    void loadSection();
  }, [clearCloseTimer, clearOpenTimer, loadSection]);

  const scheduleOpen = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    openTimerRef.current = setTimeout(() => {
      openNow();
    }, OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, openNow]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;

    const rect = trigger.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const margin = 14;
    const gap = 10;

    let left = rect.left - 20;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    if (left < margin) left = margin;

    let top = rect.bottom + gap;
    let flipAbove = false;
    if (top + height + margin > window.innerHeight) {
      top = rect.top - height - gap;
      flipAbove = true;
    }
    if (top < margin) top = margin;

    const arrow = Math.min(
      Math.max(rect.left + rect.width / 2 - left - 5, 12),
      width - 24
    );

    setCoords({ top, left });
    setAbove(flipAbove);
    setArrowLeft(arrow);
  }, []);

  useEffect(() => {
    setMounted(true);
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onReflow = () => updatePosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, data, loading, error, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || canUseHover()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onTriggerMouseEnter = () => {
    if (!canUseHover()) return;
    scheduleOpen();
  };

  const onTriggerMouseLeave = () => {
    if (!canUseHover()) return;
    clearOpenTimer();
    scheduleClose();
  };

  const onPopMouseEnter = () => {
    if (!canUseHover()) return;
    clearCloseTimer();
  };

  const onPopMouseLeave = () => {
    if (!canUseHover()) return;
    scheduleClose();
  };

  const onTriggerClick = () => {
    if (canUseHover()) return;
    if (open) {
      setOpen(false);
      return;
    }
    openNow();
  };

  const onTriggerFocus = () => {
    openNow();
  };

  const onTriggerBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && popRef.current?.contains(next)) return;
    scheduleClose();
  };

  const onPopBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && triggerRef.current?.contains(next)) return;
    if (next && popRef.current?.contains(next)) return;
    scheduleClose();
  };

  const detailHref = `/website/guide/${data?.docSlug ?? docSlug}#${data?.sectionId ?? anchorId}`;
  const displayTitle = data
    ? formatGuideSectionDisplayTitle(data.title)
    : "가이드";
  const subtitle = data ? formatGuideSectionSubtitle(data.title) : "";
  const category = guideSectionCategory(anchorId);

  const popover =
    open && mounted
      ? createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-labelledby={`${popId}-title`}
            className={above ? "gp-pop above on" : "gp-pop on"}
            style={{
              top: coords.top,
              left: coords.left,
              ["--gp-arrow-left" as string]: `${arrowLeft}px`
            }}
            onMouseEnter={onPopMouseEnter}
            onMouseLeave={onPopMouseLeave}
            onBlur={onPopBlur}
            tabIndex={-1}
          >
            <div className="gp-ph">
              <div className="gp-t">
                <b id={`${popId}-title`}>{displayTitle}</b>
                {subtitle ? <div className="gp-sub">{subtitle}</div> : null}
              </div>
              <span className="gp-cat">{category}</span>
            </div>

            {loading ? (
              <div className="gp-loading">불러오는 중…</div>
            ) : error ? (
              <div className="gp-error">{error}</div>
            ) : data ? (
              <div className="gp-pb">
                <WikiBodyMarkdown text={data.body} />
                {data.truncated ? (
                  <p className="gp-trunc">
                    <em>⋯ 자세히 보기</em>에서 전체 내용을 확인하세요.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="gp-pf">
              <a href={detailHref} target="_blank" rel="noopener noreferrer">
                자세히 보기 ↗
              </a>
              <span className="gp-src">제작·운영 가이드</span>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="gp-anchor"
        onMouseEnter={onTriggerMouseEnter}
        onMouseLeave={onTriggerMouseLeave}
        onClick={onTriggerClick}
        onFocus={onTriggerFocus}
        onBlur={onTriggerBlur}
        aria-describedby={open ? popId : undefined}
        tabIndex={0}
      >
        {question ? (
          <span className={open ? "gp-q on" : "gp-q"} aria-hidden="true">
            {children}
          </span>
        ) : (
          <span className="gp-term">{children}</span>
        )}
      </span>
      {popover}
    </>
  );
}
