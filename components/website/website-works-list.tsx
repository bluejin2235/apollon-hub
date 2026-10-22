"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  ArrangeGrid,
  ArrangeStatus,
  ArrangeTabs,
  mediaUrl,
  moveByKey,
  useArrangeSave,
  type ArrangeCard,
  type ArrangeTab
} from "@/components/website/arrange-board";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { showToast } from "@/components/website/toast";
import {
  createWork,
  cloneWork,
  deleteWork,
  hideWork,
  unhideWork,
  getMeta,
  listWorks,
  reorderWorks
} from "@/lib/website/api";
import { apiFailMessage } from "@/lib/website/api-fail-message";
import { fillBasic, fillBody, fillFaq, fillRelated, workTitle } from "@/lib/website/checks";
import type { ApiErr, WebsiteCategory, WorkListItem, WorkSiteVisibility } from "@/lib/website/types";
import {
  categoryIdsFromMap,
  categoryLabelsFromIds
} from "@/lib/website/work-detail";
import { openPreview, PREVIEW_POPUP_BLOCKED } from "@/lib/website/preview-window";

const PUBLISH_REDIRECT_KEY = "website-publish-toast";
const WEBSITE_DOWN_MESSAGE =
  "홈페이지 개발 서버(localhost:3100)가 응답하지 않습니다. 서버가 떠 있는지 확인한 뒤 다시 시도하세요.";

function isWebsiteDown(result: ApiErr) {
  return (
    result.error === "website_timeout" ||
    result.error === "website_unreachable" ||
    result.error === "network_error"
  );
}

type SortKey = "recent" | "views" | "updated";

function formatOpen(year: string | null, month: number | null | undefined) {
  const y = (year ?? "").trim();
  if (!y) return "—";
  const m = month != null && month >= 1 && month <= 12 ? month : 1;
  return `${y}.${String(m).padStart(2, "0")}`;
}

function formatViews(value: number | null | undefined) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return n.toLocaleString("ko-KR");
}

function formatEdited(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const month = pick("month");
  const day = pick("day");
  let hour = pick("hour");
  const minute = pick("minute");
  if (!month || !day || hour == null || minute == null) return "—";
  if (hour === "24") hour = "00";
  return `${month}.${day} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function EditedCell({ at, by }: { at: string | null | undefined; by: string | null | undefined }) {
  const who = by?.trim() ? by.trim() : "—";
  return (
    <td className="py-3 pr-3">
      <span className="block whitespace-nowrap tabular-nums text-slate-400">{formatEdited(at)}</span>
      <span className="mt-0.5 block truncate text-[11px] leading-tight text-slate-400" title={who}>
        {who}
      </span>
    </td>
  );
}

function openSortKey(item: WorkListItem) {
  const year = Number.parseInt(item.year ?? "", 10);
  const month = item.open_month >= 1 && item.open_month <= 12 ? item.open_month : 1;
  if (!Number.isFinite(year)) return 0;
  return year * 100 + month;
}

function editHref(id: string) {
  return `/website/works/${id}?tab=basic`;
}

function formatError(error: string, details?: unknown) {
  return apiFailMessage({ error, details });
}

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function FillDots({ item }: { item: WorkListItem }) {
  const dots = [
    fillBasic(item.check),
    fillBody(item.check),
    fillFaq(item.check),
    fillRelated(item.check)
  ];
  return (
    <span className="inline-flex items-center gap-1" title="기본정보 · 본문 · FAQ · 연결">
      {dots.map((state, i) => (
        <i key={i} className={`inline-block h-2 w-2 rounded-full ${dotClass(state)}`} />
      ))}
    </span>
  );
}

function itemVisibility(item: WorkListItem): WorkSiteVisibility {
  return item.site_visibility ?? (item.status === "published" ? "live" : "draft");
}

type StatusFilter = "default" | "published" | "draft" | "hidden" | "all";

function StatusBadge({ item }: { item: WorkListItem }) {
  const visibility = itemVisibility(item);
  const label = visibility === "live" ? "공개" : visibility === "hidden" ? "감춤" : "초안";
  const className =
    visibility === "live"
      ? "bg-emerald-50 text-emerald-700"
      : visibility === "hidden"
        ? "bg-slate-200 text-slate-600"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

const menuItemClass =
  "block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50";

function WorkOverflowMenu({
  item,
  open,
  onOpenChange,
  onPreview,
  onClone,
  onHide,
  onUnhide,
  onDelete,
  canManageWorks
}: {
  item: WorkListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => void;
  onClone: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onDelete: () => void;
  canManageWorks: boolean;
}) {
  const visibility = itemVisibility(item);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    place();
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChangeRef.current(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-stop-row>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="더 보기"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && pos ? (
        <div
          role="menu"
          className="fixed z-30 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
          onClick={(event) => event.stopPropagation()}
        >
          <Link href={editHref(item.id)} role="menuitem" className={menuItemClass}>
            편집
          </Link>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              onOpenChange(false);
              onPreview();
            }}
          >
            미리보기
          </button>
          {canManageWorks ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                onOpenChange(false);
                onClone();
              }}
            >
              복제
            </button>
          ) : null}
          {canManageWorks ? <div className="my-1 border-t border-slate-200" /> : null}
          {canManageWorks && visibility === "draft" ? (
            <button
              type="button"
              role="menuitem"
              className={`${menuItemClass} text-rose-600 hover:bg-rose-50`}
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
            >
              삭제
            </button>
          ) : null}
          {canManageWorks && visibility === "live" ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                onOpenChange(false);
                onHide();
              }}
            >
              감추기
            </button>
          ) : null}
          {canManageWorks && visibility === "hidden" ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                onOpenChange(false);
                onUnhide();
              }}
            >
              다시 공개
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WebsiteWorksList({ siteUrl }: { siteUrl: string }) {
  const router = useRouter();
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<WorkListItem[]>([]);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("default");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [creating, setCreating] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [hideItem, setHideItem] = useState<WorkListItem | null>(null);
  const [unhideItem, setUnhideItem] = useState<WorkListItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<WorkListItem | null>(null);
  const [tab, setTab] = useState<ArrangeTab>("list");
  const { state: saveState, submit } = useArrangeSave();

  async function reloadItems() {
    const works = await listWorks({ status: "all", limit: 100 });
    if (!works.ok) {
      setError(formatError(works.error, works.details));
      return;
    }
    setItems(works.data.items ?? []);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [works, meta] = await Promise.all([
          listWorks({ status: "all", limit: 100 }),
          getMeta()
        ]);
        if (cancelled) return;
        if (!works.ok) {
          setError(formatError(works.error, works.details));
          return;
        }
        setItems(works.data.items ?? []);
        if (meta.ok) setCategories(meta.data.workCategories ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PUBLISH_REDIRECT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PUBLISH_REDIRECT_KEY);
      const parsed = JSON.parse(raw) as { title?: string };
      const title = parsed.title?.trim();
      if (title) {
        showToast({ message: `'${title}' 이 공개되었습니다`, tone: "ok" });
      }
    } catch {
      // ignore
    }
  }, []);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.label?.ko || c.id);
    }
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    let rows = items;
    if (status === "default") {
      rows = rows.filter((row) => {
        const visibility = itemVisibility(row);
        return visibility === "live" || visibility === "draft";
      });
    } else if (status !== "all") {
      rows = rows.filter((row) => {
        const visibility = itemVisibility(row);
        if (status === "published") return visibility === "live";
        if (status === "hidden") return visibility === "hidden";
        return visibility === "draft";
      });
    }
    if (category !== "all") {
      rows = rows.filter((row) =>
        categoryIdsFromMap(row.work_categories_map, row.category_id).includes(category)
      );
    }
    if (keyword) {
      rows = rows.filter((row) => {
        const title = `${row.title?.ko ?? ""} ${row.title?.en ?? ""} ${row.slug}`.toLowerCase();
        return title.includes(keyword);
      });
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy === "views") {
        const byViews = (b.view_count ?? 0) - (a.view_count ?? 0);
        if (byViews !== 0) return byViews;
      } else if (sortBy === "updated") {
        const byUpdated = String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
        if (byUpdated !== 0) return byUpdated;
      } else {
        const byOpen = openSortKey(b) - openSortKey(a);
        if (byOpen !== 0) return byOpen;
      }
      return a.id.localeCompare(b.id);
    });
    return copy;
  }, [items, q, category, status, sortBy]);

  const liveCount = items.filter((row) => itemVisibility(row) === "live").length;
  const hiddenCount = items.filter((row) => itemVisibility(row) === "hidden").length;
  const draft = items.length - liveCount - hiddenCount;

  /** 편성: 공개된 것만, 저장된 순서(sort) 대로 */
  const arranged = useMemo(() => {
    const rows = items.filter((row) => itemVisibility(row) === "live");
    rows.sort((a, b) => {
      const bySort = (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER);
      if (bySort !== 0) return bySort;
      const byOpen = openSortKey(b) - openSortKey(a);
      if (byOpen !== 0) return byOpen;
      return a.id.localeCompare(b.id);
    });
    return rows;
  }, [items]);

  const arrangeCards: ArrangeCard[] = arranged.map((row) => ({
    key: row.id,
    title: workTitle(row),
    thumb: mediaUrl(siteUrl, row.key_image),
    pinned: Boolean(row.pinned),
    layout: row.layout === "big" ? "big" : "small"
  }));

  /** 바뀐 순서 · 핀 · 크기를 바로 저장한다 */
  function persistArrange(next: WorkListItem[]) {
    const body = next.map((row, index) => ({
      id: row.id,
      sort: index + 1,
      layout: row.layout === "big" ? ("big" as const) : ("small" as const),
      pinned: Boolean(row.pinned)
    }));
    const byId = new Map(body.map((row) => [row.id, row]));
    setItems((current) =>
      current.map((row) => {
        const patch = byId.get(row.id);
        return patch ? { ...row, sort: patch.sort, layout: patch.layout, pinned: patch.pinned } : row;
      })
    );
    void submit(async (isLatest) => {
      const res = await reorderWorks(body);
      if (!res.ok) {
        showToast({ message: "저장하지 못했습니다", tone: "error" });
        if (isLatest()) await reloadItems();
        return false;
      }
      return true;
    });
  }

  function moveArranged(fromKey: string, toKey: string) {
    const moved = moveByKey(arranged, (row) => row.id, fromKey, toKey);
    if (!moved) return;
    persistArrange(moved.next);
    showToast({ message: `${moved.from + 1}번을 ${moved.to + 1}번 자리로 옮겼습니다`, tone: "ok" });
  }

  function pinArranged(key: string) {
    const target = arranged.find((row) => row.id === key);
    if (!target) return;
    const pinned = !target.pinned;
    persistArrange(arranged.map((row) => (row.id === key ? { ...row, pinned } : row)));
    showToast({
      message: pinned ? "핀을 꽂았습니다. 새 글이 와도 이 자리를 지킵니다" : "핀을 풀었습니다",
      tone: "ok"
    });
  }

  function layoutArranged(key: string, layout: "big" | "small") {
    persistArrange(arranged.map((row) => (row.id === key ? { ...row, layout } : row)));
    showToast({ message: layout === "big" ? "크게 바꿨습니다" : "작게 바꿨습니다", tone: "ok" });
  }

  function categoryLabel(item: WorkListItem) {
    return categoryLabelsFromIds(
      categoryIdsFromMap(item.work_categories_map, item.category_id),
      labelById
    );
  }

  function goEdit(item: WorkListItem) {
    router.push(editHref(item.id));
  }

  function onRowClick(event: ReactMouseEvent, item: WorkListItem) {
    if ((event.target as HTMLElement).closest("[data-stop-row]")) return;
    goEdit(item);
  }

  function menuFor(item: WorkListItem, where: "d" | "m") {
    const id = `${where}-${item.id}`;
    return (
      <WorkOverflowMenu
        item={item}
        open={menuId === id}
        onOpenChange={(next) => setMenuId(next ? id : null)}
        onPreview={() => {
          setMenuId(null);
          void (async () => {
            try {
              const ok = await openPreview({ workId: item.id });
              if (!ok) setError(PREVIEW_POPUP_BLOCKED);
            } catch (err) {
              setError(err instanceof Error ? err.message : "preview_failed");
            }
          })();
        }}
        onClone={() => {
          void (async () => {
            const res = await cloneWork(item.id);
            if (!res.ok) {
              setError(formatError(res.error, res.details));
              return;
            }
            showToast({ message: "복제했습니다", tone: "ok" });
            router.push(editHref(res.data.id));
          })();
        }}
        onHide={() => setHideItem(item)}
        onUnhide={() => setUnhideItem(item)}
        onDelete={() => setDeleteItem(item)}
        canManageWorks={canManageWorks}
      />
    );
  }

  async function confirmHide() {
    if (!hideItem) return;
    const res = await hideWork(hideItem.id);
    setHideItem(null);
    if (!res.ok) {
      setError(formatError(res.error, res.details));
      return;
    }
    await reloadItems();
    showToast({ message: "사이트에서 감췄습니다", tone: "ok" });
  }

  async function confirmUnhide() {
    if (!unhideItem) return;
    const res = await unhideWork(unhideItem.id);
    setUnhideItem(null);
    if (!res.ok) {
      setError(formatError(res.error, res.details));
      return;
    }
    await reloadItems();
    showToast({ message: "다시 공개했습니다", tone: "ok" });
  }

  async function confirmDelete() {
    if (!deleteItem) return;
    const res = await deleteWork(deleteItem.id);
    setDeleteItem(null);
    if (!res.ok) {
      setError(formatError(res.error, res.details));
      return;
    }
    await reloadItems();
    showToast({ message: "삭제했습니다", tone: "ok" });
  }

  async function createNewProject() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createWork({
        slug: `work-${Date.now()}`,
        title: { ko: "New Project", en: "New Project" },
        summary: { ko: "작성 중입니다.", en: "" },
        key_image: "/works/placeholder-wide.svg"
      });
      if (!res.ok) {
        if (isWebsiteDown(res)) {
          setError(WEBSITE_DOWN_MESSAGE);
          return;
        }
        setError(formatError(res.error, res.details));
        return;
      }
      router.push(`/website/works/${res.data.id}?tab=basic`);
    } catch {
      setError(WEBSITE_DOWN_MESSAGE);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
            프로젝트 목록
          </h1>
          <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-sub)" }}>
            전체 {items.length} · 공개 {liveCount} · 초안 {draft} · 감춤 {hiddenCount}
          </p>
        </div>
        {canManageWorks ? (
          <button
            type="button"
            disabled={creating}
            onClick={() => void createNewProject()}
            className="rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {creating ? "만드는 중…" : "＋ 새 프로젝트"}
          </button>
        ) : null}
      </div>

      <ArrangeTabs tab={tab} onChange={setTab} />

      {tab === "list" ? (
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 · 클라이언트 검색"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="사업분야"
        >
          <option value="all">전체 사업분야</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label?.ko || c.id}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="상태"
        >
          <option value="default">기본 (공개+초안)</option>
          <option value="published">공개</option>
          <option value="draft">초안</option>
          <option value="hidden">감춤</option>
          <option value="all">전체</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="정렬"
        >
          <option value="recent">최신순 (오픈)</option>
          <option value="views">조회순</option>
          <option value="updated">수정순</option>
        </select>
      </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {tab === "arrange" && !loading && (!error || items.length > 0) ? (
        <div className="wa ha">
          <ArrangeStatus state={saveState} />
          <div className="ha-canvas">
            {arrangeCards.length === 0 ? (
              <p className="text-sm text-slate-500">공개된 프로젝트가 없습니다.</p>
            ) : (
              <ArrangeGrid
                cards={arrangeCards}
                canManage={canManageWorks}
                onMove={moveArranged}
                onPin={pinArranged}
                onLayout={layoutArranged}
              />
            )}
          </div>
        </div>
      ) : null}

      {tab === "list" && !loading && (!error || items.length > 0) ? (
        <>
          <div className="hidden md:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="w-[22%] py-2 pr-3 font-medium">프로젝트</th>
                  <th className="w-[22%] py-2 pr-3 font-medium">사업분야</th>
                  <th className="w-[11%] py-2 pr-3 font-medium">오픈</th>
                  <th className="w-[9%] py-2 pr-3 text-right font-medium">조회</th>
                  <th className="w-[10%] py-2 pr-3 font-medium">상태</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">수정</th>
                  <th className="w-[8%] py-2 pr-3 font-medium">채움</th>
                  <th className="w-[6%] py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const thumb = mediaUrl(siteUrl, item.key_image);
                  return (
                    <tr
                      key={item.id}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                        itemVisibility(item) === "hidden" ? "opacity-60" : ""
                      }`}
                      onClick={(event) => onRowClick(event, item)}
                    >
                      <td className="py-3 pr-3">
                        <Link href={editHref(item.id)} className="flex items-center gap-3">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb}
                              alt=""
                              className="h-10 w-[71px] shrink-0 rounded object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-[71px] shrink-0 place-items-center rounded bg-slate-100 text-[10px] text-slate-400">
                              —
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block line-clamp-2 font-medium text-slate-900">{workTitle(item)}</span>
                            <span className="block truncate text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
                              /works/{item.slug}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-0 py-3 pr-3 text-slate-600">
                        <span className="line-clamp-2" title={categoryLabel(item)}>
                          {categoryLabel(item)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-600">{formatOpen(item.year, item.open_month)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums text-slate-600">
                        {formatViews(item.view_count)}
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge item={item} />
                      </td>
                      <EditedCell at={item.updated_at} by={item.updated_by_name} />
                      <td className="py-3 pr-3">
                        <FillDots item={item} />
                      </td>
                      <td className="py-3 text-right" data-stop-row onClick={(event) => event.stopPropagation()}>
                        {menuFor(item, "d")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {filtered.map((item) => {
              const thumb = mediaUrl(siteUrl, item.key_image);
              return (
                <li key={item.id}>
                  <div
                    className={`apollon-card flex cursor-pointer gap-3 p-3 ${
                      itemVisibility(item) === "hidden" ? "opacity-60" : ""
                    }`}
                    onClick={(event) => onRowClick(event, item)}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-16 w-[114px] shrink-0 rounded object-cover" />
                    ) : (
                      <span className="grid h-16 w-[114px] shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-400">
                        —
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 font-medium text-slate-900">{workTitle(item)}</span>
                      <span className="mt-1 block whitespace-nowrap text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
                        {categoryLabel(item)} · {formatOpen(item.year, item.open_month)} · 조회 {formatViews(item.view_count)}
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <StatusBadge item={item} />
                        <FillDots item={item} />
                      </span>
                    </span>
                    <span className="shrink-0 self-start" data-stop-row onClick={(event) => event.stopPropagation()}>
                      {menuFor(item, "m")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500">조건에 맞는 프로젝트가 없습니다.</p>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        key={hideItem ? `hide-${hideItem.id}` : "hide"}
        open={Boolean(hideItem)}
        title="사이트에서 감출까요?"
        description={
          hideItem ? (
            <p>
              스냅샷은 그대로 남습니다. 언제든 다시 공개할 수 있습니다.
            </p>
          ) : null
        }
        confirmText="감추기"
        onConfirm={() => confirmHide()}
        onCancel={() => setHideItem(null)}
      />

      <ConfirmDialog
        key={unhideItem ? `unhide-${unhideItem.id}` : "unhide"}
        open={Boolean(unhideItem)}
        title="다시 공개할까요?"
        description={unhideItem ? <p>감춰 두었던 스냅샷이 사이트에 다시 나갑니다.</p> : null}
        confirmText="다시 공개"
        onConfirm={() => confirmUnhide()}
        onCancel={() => setUnhideItem(null)}
      />

      <ConfirmDialog
        key={deleteItem ? `delete-${deleteItem.id}` : "delete"}
        open={Boolean(deleteItem)}
        title="정말 지울까요? 되돌릴 수 없습니다"
        description={
          deleteItem ? (
            <p>
              「{workTitle(deleteItem)}」와 딸린 섹션·블록·이미지·인터뷰·크레딧·FAQ·연결이 함께
              삭제됩니다.
            </p>
          ) : null
        }
        confirmText="삭제"
        danger
        onConfirm={() => confirmDelete()}
        onCancel={() => setDeleteItem(null)}
      />
    </div>
  );
}
