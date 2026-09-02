"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { NewWorkModal } from "@/components/website/new-work-modal";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { showToast } from "@/components/website/toast";
import { deleteWork, getMeta, listWorks, updateWork } from "@/lib/website/api";
import { fillBasic, fillBody, fillFaq, fillRelated, workTitle } from "@/lib/website/checks";
import type { WebsiteCategory, WorkListItem } from "@/lib/website/types";
import {
  categoryIdsFromMap,
  categoryLabelsFromIds
} from "@/lib/website/work-detail";
import { openPreview, PREVIEW_POPUP_BLOCKED } from "@/lib/website/preview-window";

const PUBLISH_REDIRECT_KEY = "website-publish-toast";

type SortKey = "recent" | "title" | "year";

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function publicWorkUrl(siteUrl: string, slug: string) {
  return `${siteUrl.replace(/\/$/, "")}/works/${slug}`;
}

function editHref(id: string) {
  return `/website/works/${id}?tab=basic`;
}

function formatError(error: string, details?: unknown) {
  return error + (details ? ` · ${JSON.stringify(details)}` : "");
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

function StatusBadge({ status }: { status: WorkListItem["status"] }) {
  const published = status === "published";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        published ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {published ? "공개" : "초안"}
    </span>
  );
}

const menuItemClass =
  "block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50";

function WorkOverflowMenu({
  item,
  siteUrl,
  open,
  onOpenChange,
  onPreview,
  onUnpublish,
  onDelete,
  canManageWorks
}: {
  item: WorkListItem;
  siteUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  canManageWorks: boolean;
}) {
  const published = item.status === "published";
  const url = publicWorkUrl(siteUrl, item.slug);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setCopied(false);
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

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

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
          className="fixed z-30 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
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
            미리보기 ↗
          </button>
          {published ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              className={menuItemClass}
            >
              홈페이지에서 보기 ↗
            </a>
          ) : (
            <span className="group relative block" title="공개 후에 볼 수 있습니다">
              <span
                role="menuitem"
                aria-disabled="true"
                className="block w-full cursor-not-allowed px-3 py-1.5 text-left text-sm text-slate-400"
              >
                홈페이지에서 보기 ↗
              </span>
              <span className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 hidden w-max -translate-y-1/2 rounded bg-slate-800 px-2 py-1 text-[11px] text-white group-hover:block">
                공개 후에 볼 수 있습니다
              </span>
            </span>
          )}
          <button type="button" role="menuitem" className={menuItemClass} onClick={() => void copyUrl()}>
            {copied ? "복사됨" : "주소 복사"}
          </button>
          <div className="my-1 border-t border-slate-200" />
          {canManageWorks && published ? (
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                onOpenChange(false);
                onUnpublish();
              }}
            >
              비공개로 되돌리기
            </button>
          ) : null}
          {canManageWorks ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
            >
              삭제
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
  const [status, setStatus] = useState<"all" | "draft" | "published">("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [newOpen, setNewOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [unpublishItem, setUnpublishItem] = useState<WorkListItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<WorkListItem | null>(null);

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
    if (status !== "all") rows = rows.filter((row) => row.status === status);
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
      if (sortBy === "title") return workTitle(a).localeCompare(workTitle(b), "ko");
      if (sortBy === "year") return String(b.year ?? "").localeCompare(String(a.year ?? ""));
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
    return copy;
  }, [items, q, category, status, sortBy]);

  const published = items.filter((row) => row.status === "published").length;
  const draft = items.length - published;

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
        siteUrl={siteUrl}
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
        onUnpublish={() => setUnpublishItem(item)}
        onDelete={() => setDeleteItem(item)}
        canManageWorks={canManageWorks}
      />
    );
  }

  async function confirmUnpublish() {
    if (!unpublishItem) return;
    const res = await updateWork(unpublishItem.id, { status: "draft" });
    setUnpublishItem(null);
    if (!res.ok) {
      setError(formatError(res.error, res.details));
      return;
    }
    await reloadItems();
    showToast({ message: "비공개로 바뀌었습니다", tone: "ok" });
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
    showToast({ message: "삭제되었습니다", tone: "ok" });
  }

  const deleteTitleKo = deleteItem?.title?.ko?.trim() || (deleteItem ? workTitle(deleteItem) : "");

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
            프로젝트 목록
          </h1>
          <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-sub)" }}>
            전체 {items.length} · 공개 {published} · 초안 {draft}
          </p>
        </div>
        {canManageWorks ? (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white"
          >
            ＋ 새 프로젝트
          </button>
        ) : null}
      </div>

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
          onChange={(e) => setStatus(e.target.value as "all" | "draft" | "published")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="상태"
        >
          <option value="all">상태</option>
          <option value="published">공개</option>
          <option value="draft">초안</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="정렬"
        >
          <option value="recent">최신순</option>
          <option value="title">제목순</option>
          <option value="year">연도순</option>
        </select>
      </div>

      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && (!error || items.length > 0) ? (
        <>
          <div className="hidden md:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="w-[34%] py-2 pr-3 font-medium">프로젝트</th>
                  <th className="w-[32%] py-2 pr-3 font-medium">사업분야</th>
                  <th className="w-[8%] py-2 pr-3 font-medium">연도</th>
                  <th className="w-[10%] py-2 pr-3 font-medium">상태</th>
                  <th className="w-[8%] py-2 pr-3 font-medium">채움</th>
                  <th className="w-[8%] py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const thumb = mediaUrl(siteUrl, item.key_image);
                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
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
                            <span className="block font-medium text-slate-900">{workTitle(item)}</span>
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
                      <td className="py-3 pr-3 text-slate-600">{item.year ?? "—"}</td>
                      <td className="py-3 pr-3">
                        <StatusBadge status={item.status} />
                      </td>
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
                    className="apollon-card flex cursor-pointer gap-3 p-3"
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
                      <span className="block font-medium text-slate-900">{workTitle(item)}</span>
                      <span className="mt-1 block whitespace-nowrap text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
                        {categoryLabel(item)} · {item.year ?? "—"}
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <StatusBadge status={item.status} />
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

      <NewWorkModal open={newOpen} onClose={() => setNewOpen(false)} />

      <ConfirmDialog
        key={unpublishItem ? `unpub-${unpublishItem.id}` : "unpub"}
        open={Boolean(unpublishItem)}
        title="홈페이지에서 내려갑니다. 계속할까요?"
        confirmText="계속"
        onConfirm={() => confirmUnpublish()}
        onCancel={() => setUnpublishItem(null)}
      />

      <ConfirmDialog
        key={deleteItem ? `del-${deleteItem.id}` : "del"}
        open={Boolean(deleteItem)}
        title="이 프로젝트를 삭제할까요?"
        confirmText="삭제"
        confirmWord={deleteItem?.slug}
        danger
        onConfirm={() => confirmDelete()}
        onCancel={() => setDeleteItem(null)}
        description={
          deleteItem ? (
            <>
              {deleteItem.status === "published" ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  지금 홈페이지에 공개되어 있습니다. 삭제하면 페이지가 사라집니다.
                </p>
              ) : null}
              <p className="font-bold text-slate-900">{deleteTitleKo}</p>
              <p>
                블록 {deleteItem.counts.sections}개 · 이미지 {deleteItem.counts.images}장 · FAQ{" "}
                {deleteItem.counts.faqs}문항이 함께 지워집니다.
              </p>
              <p>되돌릴 수 없습니다.</p>
            </>
          ) : null
        }
      />
    </div>
  );
}
