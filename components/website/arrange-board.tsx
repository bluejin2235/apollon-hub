"use client";

/**
 * 홈 · 워크 · 인사이트 편성 화면이 같이 쓰는 조각.
 * - 카드 격자 (끌어 놓기, 핀, 크게/작게, 홈에서 숨기기 메뉴)
 * - 저장 상태 줄 「저장 중… / 저장됨 방금」
 * - 저장 요청을 한 줄로 세우는 훅 (끌 때마다 바로 저장)
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import "@/components/website/ui/work-admin.css";
import { groupHomeRows, type HomeCardLayout } from "@/lib/website/home";

export type ArrangeCard = {
  key: string;
  title: string;
  /** 홈 카드에서만 쓴다. 「워크」 「인사이트」 */
  kind?: string;
  thumb: string | null;
  pinned: boolean;
  layout: HomeCardLayout;
};

export function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

/** key 로 찾아 from 자리의 것을 to 자리로 옮긴다. 옮길 게 없으면 null */
export function moveByKey<T>(
  list: T[],
  keyOf: (item: T) => string,
  fromKey: string,
  toKey: string
): { next: T[]; from: number; to: number } | null {
  if (fromKey === toKey) return null;
  const from = list.findIndex((row) => keyOf(row) === fromKey);
  const to = list.findIndex((row) => keyOf(row) === toKey);
  if (from < 0 || to < 0) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { next, from, to };
}

export type ArrangeSaveState = "idle" | "saving" | "saved" | "error";

/**
 * 저장을 한 줄로 세운다. 끌기 · 핀 · 크기를 연달아 해도 순서대로 하나씩 나간다.
 * task 는 성공 여부를 돌려준다. isLatest() 가 참일 때만 서버 응답으로 화면을 덮어쓴다.
 */
export function useArrangeSave() {
  const [state, setState] = useState<ArrangeSaveState>("idle");
  const seqRef = useRef(0);
  const pendingRef = useRef(0);
  const failedRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const submit = useCallback((task: (isLatest: () => boolean) => Promise<boolean>) => {
    const seq = ++seqRef.current;
    if (pendingRef.current === 0) failedRef.current = false;
    pendingRef.current += 1;
    setState("saving");
    const run = chainRef.current.then(async () => {
      let ok = false;
      try {
        ok = await task(() => seq === seqRef.current);
      } catch {
        ok = false;
      }
      pendingRef.current -= 1;
      if (!ok) failedRef.current = true;
      if (pendingRef.current === 0) setState(failedRef.current ? "error" : "saved");
      return ok;
    });
    chainRef.current = run;
    return run;
  }, []);

  return { state, submit };
}

export function ArrangeStatus({ state }: { state: ArrangeSaveState }) {
  return (
    <div className={`ha-saved is-${state}`} role="status" aria-live="polite">
      <i />
      {state === "saving" ? (
        <b>저장 중…</b>
      ) : state === "error" ? (
        <b>저장하지 못했습니다</b>
      ) : state === "saved" ? (
        <>
          <b>저장됨</b> 방금
        </>
      ) : (
        <b>저장됨</b>
      )}
    </div>
  );
}

export type ArrangeTab = "list" | "arrange";

/** 목록 | 편성 */
export function ArrangeTabs({ tab, onChange }: { tab: ArrangeTab; onChange: (tab: ArrangeTab) => void }) {
  return (
    <div className="ha-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "list"} onClick={() => onChange("list")}>
        목록
      </button>
      <button type="button" role="tab" aria-selected={tab === "arrange"} onClick={() => onChange("arrange")}>
        편성
      </button>
    </div>
  );
}

function ArrangeCell({
  card,
  index,
  sized,
  canManage,
  dragKey,
  menuOpen,
  onDragStart,
  onDragEnd,
  onDrop,
  onMenu,
  onPin,
  onLayout,
  onHide
}: {
  card: ArrangeCard;
  index: number;
  sized: boolean;
  canManage: boolean;
  dragKey: string | null;
  menuOpen: boolean;
  onDragStart: (key: string) => void;
  onDragEnd: () => void;
  onDrop: (key: string) => void;
  onMenu: (key: string | null) => void;
  onPin: (key: string) => void;
  onLayout: (key: string, layout: HomeCardLayout) => void;
  onHide?: (key: string) => void;
}) {
  const dragging = dragKey === card.key;
  const classes = [
    "ha-cell",
    card.pinned ? "is-pinned" : "",
    dragging ? "is-dragging" : "",
    menuOpen ? "is-menu-open" : "",
    sized ? "" : "ha-cell--tall",
    canManage ? "is-draggable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  function startDrag(event: DragEvent) {
    event.dataTransfer.setData("text/plain", card.key);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(card.key);
  }

  return (
    <div
      className={classes}
      draggable={canManage}
      onDragStart={canManage ? startDrag : undefined}
      onDragEnd={canManage ? onDragEnd : undefined}
      onDragOver={(event) => {
        if (!canManage) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!canManage) return;
        event.preventDefault();
        onDrop(card.key);
      }}
    >
      {card.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.thumb} alt="" draggable={false} className="ha-cell__bg" />
      ) : (
        <div className="ha-cell__bg ha-cell__bg--empty" />
      )}
      <div className="ha-cell__cap">
        <p className={`ha-cell__title${card.layout === "small" ? " is-small" : ""}`}>
          {card.kind ? <span className="ha-cell__kind">{card.kind}</span> : null}
          {card.title}
        </p>
      </div>
      <div className="ha-cell__tl">
        <span className="ha-chip ha-chip--no">{index + 1}</span>
        {sized ? (
          <span className="ha-chip ha-chip--sz">{card.layout === "big" ? "크게" : "작게"}</span>
        ) : null}
      </div>
      {card.pinned ? (
        <span className="ha-cell__pinbadge" role="img" aria-label="핀 꽂힘" title="핀 꽂힘">
          📌
        </span>
      ) : null}
      {canManage ? (
        <>
          <button
            type="button"
            className="ha-cell__more"
            aria-label={`${card.title} 메뉴`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-arrange-menu
            onClick={() => onMenu(menuOpen ? null : card.key)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="ha-menu" role="menu" data-arrange-menu>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onMenu(null);
                  onPin(card.key);
                }}
              >
                {card.pinned ? "핀 풀기" : "핀 꽂기"}
              </button>
              {sized ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onMenu(null);
                      onLayout(card.key, "big");
                    }}
                  >
                    크게 {card.layout === "big" ? <span className="ha-menu__ck">✓</span> : null}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onMenu(null);
                      onLayout(card.key, "small");
                    }}
                  >
                    작게 {card.layout === "small" ? <span className="ha-menu__ck">✓</span> : null}
                  </button>
                </>
              ) : null}
              {onHide ? (
                <>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => {
                      onMenu(null);
                      onHide(card.key);
                    }}
                  >
                    홈에서 숨기기
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ArrangeGrid({
  cards,
  canManage,
  sized = true,
  pageSize,
  pageStep = 5,
  onMove,
  onPin,
  onLayout,
  onHide
}: {
  cards: ArrangeCard[];
  canManage: boolean;
  /** false 면 한 크기 (인사이트). 크게/작게 메뉴와 큰 칸이 없다 */
  sized?: boolean;
  /** 주면 이만큼만 먼저 보이고 「더보기」 로 늘린다 */
  pageSize?: number;
  pageStep?: number;
  onMove: (fromKey: string, toKey: string) => void;
  onPin: (key: string) => void;
  onLayout?: (key: string, layout: HomeCardLayout) => void;
  onHide?: (key: string) => void;
}) {
  const [shown, setShown] = useState(pageSize ?? Number.POSITIVE_INFINITY);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!menuKey) return;
    function onDoc(event: MouseEvent) {
      if ((event.target as HTMLElement).closest("[data-arrange-menu]")) return;
      setMenuKey(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuKey(null);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuKey]);

  function beginDrag(key: string) {
    dragKeyRef.current = key;
    setDragKey(key);
    setMenuKey(null);
  }

  function endDrag() {
    dragKeyRef.current = null;
    setDragKey(null);
  }

  function dropOn(targetKey: string) {
    const fromKey = dragKeyRef.current;
    endDrag();
    if (!fromKey || fromKey === targetKey) return;
    onMove(fromKey, targetKey);
  }

  const visible = cards.slice(0, shown);
  const indexOf = new Map(cards.map((card, index) => [card.key, index]));

  function cell(card: ArrangeCard) {
    return (
      <ArrangeCell
        key={card.key}
        card={card}
        index={indexOf.get(card.key) ?? 0}
        sized={sized}
        canManage={canManage}
        dragKey={dragKey}
        menuOpen={menuKey === card.key}
        onDragStart={beginDrag}
        onDragEnd={endDrag}
        onDrop={dropOn}
        onMenu={setMenuKey}
        onPin={onPin}
        onLayout={(key, layout) => onLayout?.(key, layout)}
        onHide={onHide}
      />
    );
  }

  return (
    <>
      {sized ? (
        <div className="ha-rows">
          {groupHomeRows(visible).map((row, rowIndex) => {
            if (row.kind === "big") {
              return (
                <div key={row.item.key} className="ha-row ha-row--wide">
                  {cell(row.item)}
                </div>
              );
            }
            return (
              <div key={`g-${row.items[0].key}-${rowIndex}`} className="ha-row ha-row--grid">
                {row.items.map(cell)}
                {row.orphan ? <div className="ha-slot-placeholder" /> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ha-flat">{visible.map(cell)}</div>
      )}
      {shown < cards.length ? (
        <button type="button" className="ha-more" onClick={() => setShown((n) => n + pageStep)}>
          더보기 · {pageStep}개
        </button>
      ) : null}
    </>
  );
}
