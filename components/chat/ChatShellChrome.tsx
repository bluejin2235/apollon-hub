"use client";

import {
  type DragEventHandler,
  type ReactNode,
  type Ref
} from "react";

export type ChatShellChromeProps = {
  headerLeft?: ReactNode;
  headerTitle: ReactNode;
  headerRight?: ReactNode;
  /** Desktop-only header row (md+). When omitted, mobile header is the only chrome. */
  desktopHeader?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Forwarded to the scrollable message region */
  messagesRef?: Ref<HTMLDivElement>;
  onMessagesScroll?: () => void;
  messagesClassName?: string;
  footerRef?: Ref<HTMLDivElement>;
  /** Extra classes on the outer shell */
  className?: string;
  /** Content wrapping the message scroller (e.g. drag-drop handlers) */
  bodyClassName?: string;
  onBodyDragEnter?: DragEventHandler<HTMLDivElement>;
  onBodyDragOver?: DragEventHandler<HTMLDivElement>;
  onBodyDragLeave?: DragEventHandler<HTMLDivElement>;
  onBodyDrop?: DragEventHandler<HTMLDivElement>;
  bodyOverlay?: ReactNode;
};

/**
 * Shared chat chrome: mobile header + scrollable messages + footer.
 * Message rendering and send logic stay in the consumer.
 */
export function ChatShellChrome({
  headerLeft,
  headerTitle,
  headerRight,
  desktopHeader,
  children,
  footer,
  messagesRef,
  onMessagesScroll,
  messagesClassName = "",
  footerRef,
  className = "",
  bodyClassName = "",
  onBodyDragEnter,
  onBodyDragOver,
  onBodyDragLeave,
  onBodyDrop,
  bodyOverlay
}: ChatShellChromeProps) {
  const showMobileHeader = headerLeft != null || headerRight != null;

  return (
    <div className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white ${className}`}>
      {showMobileHeader ? (
        <header
          className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 md:hidden"
          style={{ paddingLeft: 13, paddingRight: 13 }}
        >
          {headerLeft}
          <div className="min-w-0 flex-1">{headerTitle}</div>
          {headerRight}
        </header>
      ) : null}

      {desktopHeader ? (
        <div className="hidden shrink-0 md:block">{desktopHeader}</div>
      ) : null}

      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${bodyClassName}`}
        onDragEnter={onBodyDragEnter}
        onDragOver={onBodyDragOver}
        onDragLeave={onBodyDragLeave}
        onDrop={onBodyDrop}
      >
        {bodyOverlay}
        <div
          ref={messagesRef}
          onScroll={onMessagesScroll}
          className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain py-4 max-md:pb-[calc(140px+env(safe-area-inset-bottom,0px))] md:overscroll-auto ${messagesClassName}`}
        >
          <div className="mx-auto w-full max-w-3xl">{children}</div>
        </div>
      </div>

      <div
        ref={footerRef}
        className="mx-auto w-full max-w-3xl max-md:fixed max-md:left-0 max-md:right-0 max-md:z-20 max-md:bg-white"
        style={{
          bottom: "calc(var(--mobile-subnav-h, 0px) + env(safe-area-inset-bottom, 0px))"
        }}
      >
        {footer}
      </div>
    </div>
  );
}
