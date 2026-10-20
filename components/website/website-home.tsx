"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrangeGrid,
  ArrangeStatus,
  mediaUrl,
  moveByKey,
  useArrangeSave,
  type ArrangeCard
} from "@/components/website/arrange-board";
import { showToast } from "@/components/website/toast";
import "@/components/website/ui/work-admin.css";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { listHome, publishHomeFeed, saveHomeFeed, updateInsight, updateWork } from "@/lib/website/api";
import {
  homeItemKey,
  homeTitle,
  type HomeCardLayout,
  type HomeItem,
  type HomeList,
  type HomeWrite
} from "@/lib/website/home";

const PAGE_SIZE = 10;
const PAGE_STEP = 5;

function toWrite(items: HomeItem[]): HomeWrite[] {
  return items.map((item, index) => ({
    type: item.type,
    id: item.id,
    pinned: item.pinned,
    pin_sort: index + 1,
    layout: item.layout
  }));
}

function kindLabel(item: HomeItem) {
  return item.content.kind || (item.type === "work" ? "워크" : "인사이트");
}

function setHomeHidden(item: HomeItem, hidden: boolean) {
  return item.type === "work"
    ? updateWork(item.id, { home_hidden: hidden })
    : updateInsight(item.id, { home_hidden: hidden });
}

export function WebsiteHome({ siteUrl }: { siteUrl: string }) {
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<HomeItem[]>([]);
  const [hidden, setHidden] = useState<HomeItem[]>([]);
  const [unpublished, setUnpublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const { state: saveState, submit } = useArrangeSave();
  const itemsRef = useRef<HomeItem[]>([]);
  itemsRef.current = items;

  const applyFeed = useCallback((data: HomeList) => {
    setItems(data.items);
    setHidden((current) => data.hidden ?? current);
    setUnpublished(data.unpublished);
  }, []);

  const load = useCallback(async () => {
    const result = await listHome();
    if (!result.ok) {
      showToast({ message: "배치를 불러오지 못했습니다", tone: "error" });
      setLoading(false);
      return;
    }
    applyFeed({ ...result.data, hidden: result.data.hidden ?? [] });
    setLoading(false);
  }, [applyFeed]);

  useEffect(() => {
    void load();
  }, [load]);

  const mainUrl = siteUrl || "http://localhost:3100";
  const busy = saveState === "saving" || publishing;

  /** 바뀐 순서 · 핀 · 크기를 바로 저장한다. 저장 버튼은 없다 */
  function persist(next: HomeItem[]) {
    const body = toWrite(next);
    void submit(async (isLatest) => {
      const result = await saveHomeFeed(body);
      if (!result.ok) {
        showToast({ message: "저장하지 못했습니다", tone: "error" });
        if (isLatest()) await load();
        return false;
      }
      if (isLatest()) applyFeed(result.data);
      return true;
    });
  }

  function moveItem(fromKey: string, toKey: string) {
    const moved = moveByKey(itemsRef.current, homeItemKey, fromKey, toKey);
    if (!moved) return;
    const ordered = moved.next.map((item, index) => ({
      ...item,
      pin_sort: index + 1
    }));
    setItems(ordered);
    persist(ordered);
    showToast({
      message: `${moved.from + 1}번을 ${moved.to + 1}번 자리로 옮겼습니다`,
      tone: "ok"
    });
  }

  function pinItem(key: string) {
    const target = itemsRef.current.find((item) => homeItemKey(item) === key);
    if (!target) return;
    const pinned = !target.pinned;
    const next = itemsRef.current.map((item) => (homeItemKey(item) === key ? { ...item, pinned } : item));
    setItems(next);
    persist(next);
    showToast({
      message: pinned ? "핀을 꽂았습니다. 새 글이 와도 이 자리를 지킵니다" : "핀을 풀었습니다",
      tone: "ok"
    });
  }

  function changeLayout(key: string, layout: HomeCardLayout) {
    const next = itemsRef.current.map((item) => (homeItemKey(item) === key ? { ...item, layout } : item));
    setItems(next);
    persist(next);
    showToast({
      message: layout === "big" ? "크게 바꿨습니다" : "작게 바꿨습니다",
      tone: "ok"
    });
  }

  function hideItem(key: string) {
    const target = itemsRef.current.find((item) => homeItemKey(item) === key);
    if (!target) return;
    setItems(itemsRef.current.filter((item) => homeItemKey(item) !== key));
    setHidden((current) => [...current, { ...target, home_hidden: true }]);
    void submit(async (isLatest) => {
      const result = await setHomeHidden(target, true);
      if (!result.ok) {
        showToast({ message: "숨기지 못했습니다", tone: "error" });
        if (isLatest()) await load();
        return false;
      }
      if (isLatest()) await load();
      return true;
    });
    showToast({
      message: "홈에서 숨겼습니다. 목록에는 그대로 있습니다",
      tone: "ok"
    });
  }

  function showAgain(target: HomeItem) {
    setHidden((current) => current.filter((item) => homeItemKey(item) !== homeItemKey(target)));
    void submit(async (isLatest) => {
      const result = await setHomeHidden(target, false);
      if (!result.ok) {
        showToast({ message: "다시 보이게 하지 못했습니다", tone: "error" });
        if (isLatest()) await load();
        return false;
      }
      if (isLatest()) await load();
      return true;
    });
    showToast({ message: "홈에 다시 보이게 했습니다", tone: "ok" });
  }

  async function publish() {
    if (busy) return;
    setPublishing(true);
    const result = await publishHomeFeed(toWrite(itemsRef.current));
    setPublishing(false);
    if (!result.ok) {
      showToast({ message: "게시하지 못했습니다", tone: "error" });
      return;
    }
    applyFeed(result.data);
    showToast({ message: "게시했습니다", tone: "ok" });
  }

  const cards: ArrangeCard[] = items.map((item) => ({
    key: homeItemKey(item),
    title: homeTitle(item.content),
    kind: kindLabel(item),
    thumb: mediaUrl(siteUrl, item.content.thumbnail),
    pinned: item.pinned,
    layout: item.layout
  }));

  return (
    <div className="wa ha -mx-1">
      <div className="ha-ph">
        <div>
          <h1>홈</h1>
          <p className="ha-d2">
            공개하면 큰 썸네일 다음 첫 자리에 들어옵니다. 끌어서 놓으면 바로 저장됩니다.
          </p>
        </div>
        <span className="ha-sp" />
        <a href={mainUrl} target="_blank" rel="noreferrer" className="ha-btn">
          홈페이지에서 보기 ↗
        </a>
        {canManageWorks ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className={`ha-btn${unpublished && !busy ? " is-primary" : ""}`}
          >
            게시
          </button>
        ) : null}
      </div>

      <ArrangeStatus state={saveState} />

      <div className="ha-canvas">
        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <ArrangeGrid
            cards={cards}
            canManage={canManageWorks}
            pageSize={PAGE_SIZE}
            pageStep={PAGE_STEP}
            onMove={moveItem}
            onPin={pinItem}
            onLayout={changeLayout}
            onHide={hideItem}
          />
        )}
      </div>

      {unpublished && saveState !== "saving" ? (
        <div className="ha-foot">저장했지만 아직 게시되지 않았습니다</div>
      ) : null}

      {loading ? null : (
        <details className="ha-hidden" open>
          <summary>
            홈에서 숨긴 것 <span className="ha-hidden__count">{hidden.length}</span>
          </summary>
          {hidden.length === 0 ? (
            <div className="ha-hidden__empty">숨긴 글이 없습니다. 카드의 ⋯ 메뉴에서 숨길 수 있습니다.</div>
          ) : (
            hidden.map((item) => {
              const thumb = mediaUrl(siteUrl, item.content.thumbnail);
              return (
                <div key={homeItemKey(item)} className="ha-hidden__row">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="ha-hidden__th" />
                  ) : (
                    <span className="ha-hidden__th ha-hidden__th--empty" />
                  )}
                  <span className="ha-hidden__nm">
                    {kindLabel(item)} · {homeTitle(item.content)}
                  </span>
                  {canManageWorks ? (
                    <button type="button" className="ha-btn" onClick={() => showAgain(item)}>
                      다시 보이기
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </details>
      )}
    </div>
  );
}
