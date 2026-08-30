"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { HomePickPanel } from "@/components/website/home-pick-panel";
import { showToast } from "@/components/website/toast";
import "@/components/website/ui/work-admin.css";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { deleteHomeSlot, listHome, reorderHome, updateHomeSlot } from "@/lib/website/api";
import { groupHomeRows, homeTitle, type HomeLayout, type HomeSlot } from "@/lib/website/home";

function keepClick(event: MouseEvent) {
  event.stopPropagation();
}

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function isLargeCustomVideo(url: string, fromWide: boolean) {
  if (/\/ts\//.test(url)) return false;
  if (/\/tl\//.test(url)) return true;
  return fromWide;
}

function ChipBtn({
  title,
  onClick,
  className,
  children
}: {
  title: string;
  onClick?: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      draggable={false}
      onMouseDown={keepClick}
      onClick={(event) => {
        keepClick(event);
        onClick?.();
      }}
      className={className}
    >
      {children}
    </button>
  );
}

function Cell({
  item,
  siteUrl,
  canManage,
  dragId,
  onDragStart,
  onDragEnd,
  onDrop,
  onSwap,
  onRemove
}: {
  item: HomeSlot;
  siteUrl: string;
  canManage: boolean;
  dragId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (id: string) => void;
  onSwap: (item: HomeSlot) => void;
  onRemove: (item: HomeSlot) => void;
}) {
  const content = item.content;
  const thumb = mediaUrl(siteUrl, content?.thumbnail ?? item.custom_image);
  const dragging = dragId === item.id;
  const custom = item.target_type === "custom";

  function startDrag(event: DragEvent) {
    event.dataTransfer.setData("text/plain", item.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(item.id);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(item.id);
      }}
      className={`group relative aspect-video overflow-hidden rounded-[10px] transition hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(0,0,0,.14)] ${
        dragging ? "opacity-40" : ""
      }`}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-slate-200" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-[15px] pb-[13px] pt-8">
        <p className={`m-0 font-semibold text-white ${item.layout === "wide" ? "text-[13px]" : "text-[11.5px]"}`}>
          {content ? homeTitle(content) : item.custom_title || ""}
          {custom ? (
            <span className="ml-1 rounded-[3px] bg-white/20 px-1.5 py-px text-[10px] font-medium">직접</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[10.5px] text-white/75">{content?.meta ?? item.custom_subtitle ?? ""}</p>
      </div>
      <div className="absolute left-[9px] top-[9px] z-[3] flex gap-1">
        <span className="flex h-6 items-center rounded-md bg-black/50 px-2 text-[10px] font-medium text-white backdrop-blur-sm">
          {item.layout === "wide" ? "큰 칸" : "작은 칸"}
        </span>
      </div>
      {canManage ? (
        <div className="absolute right-[9px] top-[9px] z-[3] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <div
            role="button"
            title="끌기"
            tabIndex={0}
            draggable
            onDragStart={startDrag}
            onDragEnd={onDragEnd}
            className="flex h-6 w-6 cursor-grab items-center justify-center rounded-md bg-black/50 text-xs text-white backdrop-blur-sm active:cursor-grabbing"
          >
            ⋮⋮
          </div>
          <ChipBtn
            title="칸 크기 바꾸기"
            onClick={() => onSwap(item)}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs text-white backdrop-blur-sm hover:bg-black/70"
          >
            ⇔
          </ChipBtn>
          <ChipBtn
            title="빼기"
            onClick={() => onRemove(item)}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs text-white backdrop-blur-sm hover:bg-black/70"
          >
            ✕
          </ChipBtn>
        </div>
      ) : null}
    </div>
  );
}

export function WebsiteHome({ siteUrl }: { siteUrl: string }) {
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<HomeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pickLayout, setPickLayout] = useState<HomeLayout | null>(null);
  const [insertAt, setInsertAt] = useState<number | undefined>(undefined);
  const dragIdRef = useRef<string | null>(null);
  const itemsRef = useRef<HomeSlot[]>([]);
  itemsRef.current = items;

  const load = useCallback(async () => {
    const result = await listHome();
    if (result.ok) setItems(result.data.items);
    else showToast({ message: "배치를 불러오지 못했습니다", tone: "error" });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = groupHomeRows(items);
  const mainUrl = siteUrl || "http://localhost:3100";

  function beginDrag(id: string) {
    dragIdRef.current = id;
    setDragId(id);
  }

  function endDrag() {
    dragIdRef.current = null;
    setDragId(null);
  }

  async function persistOrder(next: HomeSlot[]) {
    setItems(next);
    const result = await reorderHome(next.map((item, index) => ({ id: item.id, sort: index + 1 })));
    if (!result.ok) {
      showToast({ message: "순서를 바꾸지 못했습니다", tone: "error" });
      await load();
      return;
    }
    await load();
  }

  function dropOn(id: string) {
    const fromId = dragIdRef.current;
    if (!fromId || fromId === id) {
      endDrag();
      return;
    }
    const current = itemsRef.current;
    const from = current.findIndex((row) => row.id === fromId);
    const to = current.findIndex((row) => row.id === id);
    endDrag();
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistOrder(next);
  }

  function openPick(layout: HomeLayout, at?: number) {
    setInsertAt(at);
    setPickLayout(layout);
  }

  async function afterAdded() {
    const before = new Set(itemsRef.current.map((item) => item.id));
    const at = insertAt;
    const result = await listHome();
    if (!result.ok) {
      showToast({ message: "배치를 불러오지 못했습니다", tone: "error" });
      return;
    }
    setItems(result.data.items);
    if (at === undefined) return;
    const added = result.data.items.find((item) => !before.has(item.id));
    if (!added) return;
    const without = result.data.items.filter((item) => item.id !== added.id);
    const next = [...without.slice(0, at), added, ...without.slice(at)];
    await persistOrder(next);
  }

  async function swapLayout(item: HomeSlot) {
    if (busy) return;
    setBusy(true);
    const next = item.layout === "wide" ? "grid" : "wide";
    const result = await updateHomeSlot(item.id, { layout: next });
    if (!result.ok) {
      showToast({ message: "칸 크기를 바꾸지 못했습니다", tone: "error" });
      setBusy(false);
      return;
    }
    if (next === "grid" && item.custom_video && isLargeCustomVideo(item.custom_video, item.layout === "wide")) {
      showToast({
        message: "작은 칸인데 큰 칸용 영상입니다. 용량이 큽니다.",
        tone: "warn",
        durationMs: 5000
      });
    }
    await load();
    setBusy(false);
  }

  async function removeCell(item: HomeSlot) {
    if (busy) return;
    setBusy(true);
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    const result = await deleteHomeSlot(item.id);
    if (!result.ok) {
      showToast({ message: "빼지 못했습니다", tone: "error" });
      await load();
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  }

  return (
    <div className="wa -mx-1">
      <div className="flex flex-wrap items-center gap-2.5 px-1 pb-3 pt-1">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">홈</h1>
          <p className="mt-0.5 text-xs text-slate-500">메인에 나오는 그대로 보입니다 · {items.length}칸</p>
        </div>
        <span className="flex-1" />
        <a
          href={mainUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-[7px] bg-[var(--ap)] px-3 py-[5px] text-xs font-semibold text-white hover:bg-[#463d9e]"
        >
          메인 새로고침
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-[7px] border-y border-slate-200 bg-[#f8f9fb] px-1 py-2.5">
        {canManageWorks ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => openPick("wide")}
              className="rounded-[7px] border border-[#dde1e6] bg-white px-3 py-[5px] text-xs text-[#3a4049] hover:bg-[#f8f9fb] disabled:opacity-50"
            >
              ＋ 큰 칸
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => openPick("grid")}
              className="rounded-[7px] border border-[#dde1e6] bg-white px-3 py-[5px] text-xs text-[#3a4049] hover:bg-[#f8f9fb] disabled:opacity-50"
            >
              ＋ 작은 칸
            </button>
          </>
        ) : null}
        <span className="flex-1" />
        <span className="text-[11px] text-slate-500">메인에 올릴 것을 여기서 고릅니다</span>
      </div>

      <div className="bg-[#f8f9fb] px-1 py-[18px]">
        {loading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-slate-200 bg-white px-3 py-10 text-center text-sm text-slate-400">
            칸이 없습니다. 큰 칸이나 작은 칸을 추가하세요.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((row, rowIndex) => {
              if (row.kind === "wide") {
                return (
                  <div key={row.item.id} className="grid grid-cols-1">
                    <Cell
                      item={row.item}
                      siteUrl={siteUrl}
                      canManage={canManageWorks}
                      dragId={dragId}
                      onDragStart={beginDrag}
                      onDragEnd={endDrag}
                      onDrop={dropOn}
                      onSwap={(item) => void swapLayout(item)}
                      onRemove={(item) => void removeCell(item)}
                    />
                  </div>
                );
              }
              const at = items.findIndex((item) => item.id === row.items[0].id) + 1;
              return (
                <div key={`g-${row.items[0].id}-${rowIndex}`} className="grid grid-cols-2 gap-2.5">
                  {row.items.map((item) => (
                    <Cell
                      key={item.id}
                      item={item}
                      siteUrl={siteUrl}
                      canManage={canManageWorks}
                      dragId={dragId}
                      onDragStart={beginDrag}
                      onDragEnd={endDrag}
                      onDrop={dropOn}
                      onSwap={(slot) => void swapLayout(slot)}
                      onRemove={(slot) => void removeCell(slot)}
                    />
                  ))}
                  {row.orphan && canManageWorks ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openPick("grid", at)}
                      className="flex aspect-video flex-col items-center justify-center gap-[3px] rounded-[10px] border-[1.5px] border-dashed border-[#e3e6ea] bg-[#fafbfc] text-[#c3c9d1] hover:border-[var(--apln)] hover:bg-[var(--apbg)] hover:text-[var(--ap)] disabled:opacity-50"
                    >
                      <div className="text-[19px]">＋</div>
                      <div className="text-[10.5px]">여기에 작은 칸이 들어갑니다</div>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 px-1 py-[13px] text-[11.5px] leading-[1.9] text-slate-500">
        워크·인사이트를 등록해도 메인에는 나오지 않습니다.
        <br />
        여기서 <b className="font-semibold text-[#3a4049]">따로 고른 칸만</b> 메인에 나갑니다. 끌어서 순서를 바꾸면 바로 저장됩니다.
      </div>

      <HomePickPanel
        siteUrl={siteUrl}
        layout={pickLayout ?? "grid"}
        open={Boolean(pickLayout)}
        onClose={() => {
          setPickLayout(null);
          setInsertAt(undefined);
        }}
        onAdded={() => void afterAdded()}
      />
    </div>
  );
}
