"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { showToast } from "@/components/website/toast";
import "@/components/website/ui/work-admin.css";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { listHome, publishHomeFeed, saveHomeFeed } from "@/lib/website/api";
import {
  groupHomeRows,
  homeItemKey,
  homeTitle,
  type HomeCardLayout,
  type HomeItem,
  type HomeWrite
} from "@/lib/website/home";

const PAGE_SIZE = 10;
const PAGE_STEP = 5;

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function toWrite(items: HomeItem[]): HomeWrite[] {
  return items.map((item) => ({
    type: item.type,
    id: item.id,
    pinned: item.pinned,
    pin_sort: item.pinned ? item.pin_sort : null,
    layout: item.layout
  }));
}

function sameWrite(a: HomeWrite[], b: HomeWrite[]) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      item.type === other.type &&
      item.id === other.id &&
      item.pinned === other.pinned &&
      item.pin_sort === other.pin_sort &&
      item.layout === other.layout
    );
  });
}

function Cell({
  item,
  siteUrl,
  canManage,
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
  onPin,
  onLayout
}: {
  item: HomeItem;
  siteUrl: string;
  canManage: boolean;
  dragId: string | null;
  onDragStart: (key: string) => void;
  onDragEnd: () => void;
  onDrop: (key: string) => void;
  onPin: (item: HomeItem) => void;
  onLayout: (item: HomeItem, layout: HomeCardLayout) => void;
}) {
  const key = homeItemKey(item);
  const thumb = mediaUrl(siteUrl, item.content.thumbnail);
  const nextLayout: HomeCardLayout = item.layout === "big" ? "small" : "big";
  const layoutLabel = item.layout === "big" ? "큰 칸" : "작은 칸";
  const swapLabel = nextLayout === "small" ? "작은 칸으로" : "큰 칸으로";
  const dragging = dragId === key;

  function startDrag(event: DragEvent) {
    event.dataTransfer.setData("text/plain", key);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(key);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(key);
      }}
      className={`ha-cell${item.pinned ? " is-pinned" : ""}${dragging ? " is-dragging" : ""}`}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" draggable={false} className="ha-cell__bg" />
      ) : (
        <div className="ha-cell__bg ha-cell__bg--empty" />
      )}
      <div className="ha-cell__cap">
        <p className={`ha-cell__title${item.layout === "small" ? " is-small" : ""}`}>
          {homeTitle(item.content)}
        </p>
        <p className="ha-cell__meta">{item.content.meta}</p>
      </div>
      <div className="ha-cell__tl">
        <span className={`ha-chip${item.pinned ? " is-pin" : ""}`}>{layoutLabel}</span>
      </div>
      {canManage ? (
        <>
          <div className="ha-cell__pin">
            <div
              role="button"
              title="끌기"
              tabIndex={0}
              draggable
              onDragStart={startDrag}
              onDragEnd={onDragEnd}
              className="ha-chip ha-chip--sq ha-chip--drag"
            >
              ⠿
            </div>
            <button
              type="button"
              title="고정"
              onClick={() => onPin(item)}
              className={`ha-chip ha-chip--sq${item.pinned ? " is-pin" : " is-off"}`}
            >
              📌
            </button>
          </div>
          <div className="ha-cell__tr">
            <button type="button" title={swapLabel} onClick={() => onLayout(item, nextLayout)} className="ha-chip">
              {swapLabel}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function WebsiteHome({ siteUrl }: { siteUrl: string }) {
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<HomeItem[]>([]);
  const [saved, setSaved] = useState<HomeWrite[]>([]);
  const [unpublished, setUnpublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const itemsRef = useRef<HomeItem[]>([]);
  itemsRef.current = items;

  const load = useCallback(async () => {
    const result = await listHome();
    if (!result.ok) {
      showToast({ message: "배치를 불러오지 못했습니다", tone: "error" });
      setLoading(false);
      return;
    }
    setItems(result.data.items);
    setSaved(toWrite(result.data.items));
    setUnpublished(result.data.unpublished);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = groupHomeRows(items.slice(0, shown));
  const pinnedCount = items.filter((item) => item.pinned).length;
  const autoCount = items.length - pinnedCount;
  const dirty = !sameWrite(toWrite(items), saved);
  const saveEmphasized = dirty;
  const publishEmphasized = !dirty && unpublished;
  const mainUrl = siteUrl || "http://localhost:3100";

  function applyFeed(data: { items: HomeItem[]; unpublished: boolean }) {
    setItems(data.items);
    setSaved(toWrite(data.items));
    setUnpublished(data.unpublished);
  }

  function beginDrag(key: string) {
    dragIdRef.current = key;
    setDragId(key);
  }

  function endDrag() {
    dragIdRef.current = null;
    setDragId(null);
  }

  function dropOn(targetKey: string) {
    const fromKey = dragIdRef.current;
    if (!fromKey || fromKey === targetKey) {
      endDrag();
      return;
    }
    const current = itemsRef.current;
    const from = current.findIndex((row) => homeItemKey(row) === fromKey);
    const to = current.findIndex((row) => homeItemKey(row) === targetKey);
    endDrag();
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(
      next.map((item, index) => {
        if (homeItemKey(item) === fromKey) {
          return { ...item, pinned: true, pin_sort: index + 1 };
        }
        if (item.pinned) {
          return { ...item, pin_sort: index + 1 };
        }
        return item;
      })
    );
  }

  function pinItem(target: HomeItem) {
    setItems((current) =>
      current.map((item, index) => {
        if (homeItemKey(item) !== homeItemKey(target)) return item;
        const pinned = !item.pinned;
        return {
          ...item,
          pinned,
          pin_sort: pinned ? index + 1 : null
        };
      })
    );
  }

  function changeLayout(target: HomeItem, layout: HomeCardLayout) {
    setItems((current) =>
      current.map((item) => (homeItemKey(item) === homeItemKey(target) ? { ...item, layout } : item))
    );
  }

  async function save() {
    if (busy) return;
    setBusy("save");
    const result = await saveHomeFeed(toWrite(items));
    if (!result.ok) {
      showToast({ message: "저장하지 못했습니다", tone: "error" });
      setBusy(null);
      return;
    }
    applyFeed(result.data);
    showToast({ message: "저장했습니다", tone: "ok" });
    setBusy(null);
  }

  async function publish() {
    if (busy) return;
    setBusy("publish");
    const result = await publishHomeFeed(toWrite(items));
    if (!result.ok) {
      showToast({ message: "게시하지 못했습니다", tone: "error" });
      setBusy(null);
      return;
    }
    applyFeed(result.data);
    showToast({ message: "게시했습니다", tone: "ok" });
    setBusy(null);
  }

  return (
    <div className="wa ha -mx-1">
      <div className="ha-ph">
        <div>
          <h1>홈</h1>
          <p className="ha-d2">
            메인에 나오는 그대로 보입니다 · 고정 {pinnedCount} · 자동 {autoCount}
          </p>
        </div>
        <span className="ha-sp" />
        <a href={mainUrl} target="_blank" rel="noreferrer" className="ha-btn">
          미리보기 ↗
        </a>
        {canManageWorks ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void save()}
              className={`ha-btn${saveEmphasized ? " is-primary" : ""}`}
            >
              저장
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void publish()}
              className={`ha-btn${publishEmphasized ? " is-primary" : ""}`}
            >
              게시
            </button>
          </>
        ) : null}
      </div>

      <div className="ha-tool">
        <span className="ha-sp" />
        <span className="ha-hint">
          <span className="ha-hint-pin">📌</span> 핀을 꽂으면 새 글이 올라와도 자리를 지킵니다 · ⠿ 로 끌어 옮기면 핀이
          꽂힙니다
        </span>
      </div>

      <div className="ha-canvas">
        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <div className="ha-rows">
            {rows.map((row, rowIndex) => {
              if (row.kind === "big") {
                return (
                  <div key={homeItemKey(row.item)} className="ha-row ha-row--wide">
                    <Cell
                      item={row.item}
                      siteUrl={siteUrl}
                      canManage={canManageWorks}
                      dragId={dragId}
                      onDragStart={beginDrag}
                      onDragEnd={endDrag}
                      onDrop={dropOn}
                      onPin={pinItem}
                      onLayout={changeLayout}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={`g-${homeItemKey(row.items[0])}-${rowIndex}`}
                  className="ha-row ha-row--grid"
                >
                  {row.items.map((item) => (
                    <Cell
                      key={homeItemKey(item)}
                      item={item}
                      siteUrl={siteUrl}
                      canManage={canManageWorks}
                      dragId={dragId}
                      onDragStart={beginDrag}
                      onDragEnd={endDrag}
                      onDrop={dropOn}
                      onPin={pinItem}
                      onLayout={changeLayout}
                    />
                  ))}
                  {row.orphan ? <div className="ha-slot-placeholder" /> : null}
                </div>
              );
            })}
          </div>
        )}

        {shown < items.length ? (
          <button type="button" className="ha-more" onClick={() => setShown((n) => n + PAGE_STEP)}>
            더보기 · 5개
          </button>
        ) : null}
      </div>

      <div className="ha-foot">
        <span className="ha-pinmark">📌 고정</span> 은 그 자리를 지킵니다. 새 글이 올라와도 밀리지
        않습니다.
        <br />
        나머지 칸은 <b>고정을 건너뛰고 최신순으로</b> 채워집니다.
        <br />
        오래된 글은 아래로 내려가고 마지막 칸을 넘으면 사라집니다.
        {unpublished && !dirty ? (
          <>
            <br />
            저장했지만 아직 게시되지 않았습니다
          </>
        ) : null}
      </div>
    </div>
  );
}
