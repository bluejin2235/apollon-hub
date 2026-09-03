"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { NewInsightModal } from "@/components/website/new-insight-modal";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { showToast } from "@/components/website/toast";
import { getMeta, hideInsight, listInsights } from "@/lib/website/api";
import { fillInsightBasic, fillInsightBody, fillInsightRelated, insightTitle } from "@/lib/website/checks";
import type { InsightListItem, WebsiteCategory, WorkSiteVisibility } from "@/lib/website/types";

const PUBLISH_REDIRECT_KEY = "website-insight-publish-toast";

type SortKey = "recent" | "title" | "published";

const CAT_CHIP: Record<string, string> = {
  "behind-the-work": "bg-[#eef0fb] text-[#4b5bb5]",
  interview: "bg-[#eef4fb] text-[#2563a8]",
  news: "bg-[#f3eefb] text-[#7c3aed]",
  culture: "bg-[#fdf3ee] text-[#a35a08]",
  lab: "bg-[#eaf5f0] text-[#0f7a45]"
};

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function publicInsightUrl(siteUrl: string, slug: string) {
  return `${siteUrl.replace(/\/$/, "")}/insights/${slug}`;
}

function editHref(id: string) {
  return `/website/insights/${id}?tab=basic`;
}

function formatError(error: string, details?: unknown) {
  return error + (details ? ` · ${JSON.stringify(details)}` : "");
}

function formatPublished(value: string | null) {
  if (!value) return "—";
  const d = value.slice(0, 10);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${y}.${m}.${day}`;
}

function CategoryChip({ id, label }: { id: string; label: string }) {
  const chip = CAT_CHIP[id] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block whitespace-nowrap rounded-[3px] px-[7px] py-0.5 text-[10px] font-bold ${chip}`}>
      {label}
    </span>
  );
}

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-[#10b981]";
  if (state === "warn") return "bg-[#f59e0b]";
  return "bg-[#d1d5db]";
}

function FillDots({ item }: { item: InsightListItem }) {
  const dots = [fillInsightBasic(item.check), fillInsightBody(item.check), fillInsightRelated(item.check)];
  return (
    <span className="inline-flex items-center justify-center gap-[3.5px]" title="기본정보 · 본문 · 연결">
      {dots.map((state, i) => (
        <i key={i} className={`inline-block h-[7px] w-[7px] rounded-full ${dotClass(state)}`} />
      ))}
    </span>
  );
}

function itemVisibility(item: InsightListItem): WorkSiteVisibility {
  return item.site_visibility ?? (item.status === "published" ? "live" : "draft");
}

function StatusBadge({ item }: { item: InsightListItem }) {
  const visibility = itemVisibility(item);
  const label = visibility === "live" ? "공개" : visibility === "hidden" ? "감춤" : "초안";
  const className =
    visibility === "live"
      ? "bg-[#f0f9f4] text-[#0f7a45]"
      : visibility === "hidden"
        ? "bg-[#f5f0e8] text-[#8a6a2f]"
        : "bg-[#eef0f3] text-[#6b7280]";
  return (
    <span className={`inline-block rounded-[3px] px-[7px] py-0.5 text-[10px] font-bold ${className}`}>
      {label}
    </span>
  );
}

const menuItemClass = "block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50";

function InsightOverflowMenu({
  item,
  siteUrl,
  open,
  onOpenChange,
  onHide,
  canManage
}: {
  item: InsightListItem;
  siteUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHide: () => void;
  canManage: boolean;
}) {
  const liveOnSite = itemVisibility(item) === "live";
  const url = publicInsightUrl(siteUrl, item.slug);
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
          {liveOnSite ? (
            <a href={url} target="_blank" rel="noreferrer" role="menuitem" className={menuItemClass}>
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
            </span>
          )}
          <button type="button" role="menuitem" className={menuItemClass} onClick={() => void copyUrl()}>
            {copied ? "복사됨" : "주소 복사"}
          </button>
          <div className="my-1 border-t border-slate-200" />
          {canManage && liveOnSite ? (
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
        </div>
      ) : null}
    </div>
  );
}

function thumbClass(item: InsightListItem) {
  const ratio = item.key_image_ratio;
  // 폭 56px 고정. 비율은 높이만 달라지게 (3:4 ≈ 75px < 100px)
  const base = "w-14 shrink-0 rounded object-cover";
  if (ratio === "1:1") return `${base} aspect-square`;
  if (ratio === "3:4") return `${base} aspect-[3/4]`;
  if (ratio === "16:9") return `${base} aspect-video`;
  return `${base} aspect-video`;
}

function Thumb({
  src,
  item
}: {
  src: string | null;
  item: InsightListItem;
}) {
  const cls = thumbClass(item);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={cls} />
    );
  }
  return (
    <span className={`grid place-items-center bg-slate-100 text-[10px] text-slate-400 ${cls}`}>
      —
    </span>
  );
}

export function WebsiteInsightsList({ siteUrl }: { siteUrl: string }) {
  const router = useRouter();
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | "draft" | "published" | "hidden">("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [newOpen, setNewOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [hideItem, setHideItem] = useState<InsightListItem | null>(null);

  async function reloadItems() {
    const insights = await listInsights({ status: "all", limit: 100 });
    if (!insights.ok) {
      setError(formatError(insights.error, insights.details));
      return;
    }
    setItems(insights.data.items ?? []);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [insights, meta] = await Promise.all([listInsights({ status: "all", limit: 100 }), getMeta()]);
        if (cancelled) return;
        if (!insights.ok) {
          setError(formatError(insights.error, insights.details));
          return;
        }
        setItems(insights.data.items ?? []);
        if (meta.ok) setCategories(meta.data.insightCategories ?? []);
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
      map.set(c.id, c.id === "behind-the-work" ? "비하인드 워크" : c.label?.ko || c.id);
    }
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    let rows = items;
    if (status !== "all") {
      rows = rows.filter((row) => {
        const visibility = itemVisibility(row);
        if (status === "published") return visibility === "live";
        if (status === "hidden") return visibility === "hidden";
        return visibility === "draft";
      });
    }
    if (category !== "all") rows = rows.filter((row) => row.category_id === category);
    if (keyword) {
      rows = rows.filter((row) => {
        const title = `${row.title?.ko ?? ""} ${row.title?.en ?? ""} ${row.slug}`.toLowerCase();
        return title.includes(keyword);
      });
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy === "title") return insightTitle(a).localeCompare(insightTitle(b), "ko");
      if (sortBy === "published") {
        return String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""));
      }
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
    return copy;
  }, [items, q, category, status, sortBy]);

  const liveCount = items.filter((row) => itemVisibility(row) === "live").length;
  const hiddenCount = items.filter((row) => itemVisibility(row) === "hidden").length;
  const draft = items.length - liveCount - hiddenCount;

  function goEdit(item: InsightListItem) {
    router.push(editHref(item.id));
  }

  function onRowClick(event: ReactMouseEvent, item: InsightListItem) {
    if ((event.target as HTMLElement).closest("[data-stop-row]")) return;
    goEdit(item);
  }

  function menuFor(item: InsightListItem, where: "d" | "m") {
    const id = `${where}-${item.id}`;
    return (
      <InsightOverflowMenu
        item={item}
        siteUrl={siteUrl}
        open={menuId === id}
        onOpenChange={(next) => setMenuId(next ? id : null)}
        onHide={() => setHideItem(item)}
        canManage={canManageWorks}
      />
    );
  }

  async function confirmHide() {
    if (!hideItem) return;
    const res = await hideInsight(hideItem.id);
    setHideItem(null);
    if (!res.ok) {
      setError(formatError(res.error, res.details));
      return;
    }
    await reloadItems();
    showToast({ message: "사이트에서 감췄습니다", tone: "ok" });
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
            인사이트
          </h1>
          <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-sub)" }}>
            전체 {items.length} · 공개 {liveCount} · 초안 {draft} · 감춤 {hiddenCount}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-[7px] border border-[#dde1e6] bg-white px-3 py-[5px] text-xs text-[#3a4049]"
            title="다음 단계에서 엽니다"
          >
            카테고리 · 태그
          </button>
          {canManageWorks ? (
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="rounded-[7px] bg-apollon-500 px-3 py-[5px] text-xs font-semibold text-white"
            >
              ＋ 새 글
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 · 태그로 찾기"
          className="min-w-[180px] flex-1 rounded-[7px] border border-[#dde1e6] bg-white px-2.5 py-[5px] text-xs text-[#3a4049]"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-[7px] border border-[#dde1e6] bg-white px-2 py-[5px] text-xs text-[#4a515b]"
          aria-label="카테고리"
        >
          <option value="all">카테고리 전체</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label?.ko || c.id}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | "draft" | "published" | "hidden")}
          className="rounded-[7px] border border-[#dde1e6] bg-white px-2 py-[5px] text-xs text-[#4a515b]"
          aria-label="상태"
        >
          <option value="all">상태 전체</option>
          <option value="published">공개</option>
          <option value="draft">초안</option>
          <option value="hidden">감춤</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-[7px] border border-[#dde1e6] bg-white px-2 py-[5px] text-xs text-[#4a515b]"
          aria-label="정렬"
        >
          <option value="recent">최신순</option>
          <option value="title">제목순</option>
          <option value="published">공개일순</option>
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
                  <th className="w-[40%] py-2 pr-3 font-medium">제목</th>
                  <th className="w-[18%] py-2 pr-3 font-medium">카테고리</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">공개일</th>
                  <th className="w-[12%] py-2 pr-3 font-medium">상태</th>
                  <th className="w-[10%] py-2 pr-3 font-medium">채움</th>
                  <th className="w-[8%] py-2 font-medium" />
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
                      <td className="max-w-0 py-3 pr-3">
                        <Link href={editHref(item.id)} className="flex items-center gap-3">
                          <Thumb src={thumb} item={item} />
                          <span className="min-w-0">
                            <span className="line-clamp-2 block font-medium text-slate-900">
                              {insightTitle(item)}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              /insight/{item.slug}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-0 py-3 pr-3">
                        <CategoryChip
                          id={item.category_id}
                          label={labelById.get(item.category_id) ?? item.category_id}
                        />
                      </td>
                      <td className="py-3 pr-3 text-slate-600">
                        {formatPublished(item.published_at)}
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge item={item} />
                      </td>
                      <td className="py-3 pr-3">
                        <FillDots item={item} />
                      </td>
                      <td
                        className="py-3 text-right"
                        data-stop-row
                        onClick={(event) => event.stopPropagation()}
                      >
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
                    <Thumb src={thumb} item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block font-medium text-slate-900">{insightTitle(item)}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {labelById.get(item.category_id) ?? item.category_id} · {formatPublished(item.published_at)}
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
            <p className="text-sm text-slate-500">
              {items.length === 0 ? "아직 글이 없습니다." : "조건에 맞는 글이 없습니다."}
            </p>
          ) : null}
        </>
      ) : null}

      <NewInsightModal open={newOpen} onClose={() => setNewOpen(false)} />

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

    </div>
  );
}
