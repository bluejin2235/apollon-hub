"use client";

import { useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/website/toast";
import { addHomeSlot, listHomeCandidates, uploadFile, type HomeSlotWrite } from "@/lib/website/api";
import { homeTitle, type HomeCandidate, type HomeLayout } from "@/lib/website/home";
import { SPEC, SPEC_BYTES, formatThumbLargeHint, formatThumbSmallHint } from "@/lib/website/spec";
import { sanitizeUploadFilename, uploadObjectPath } from "@/lib/website/upload-path";
import { prepareImageForUpload } from "@/lib/website/prepare-upload-image";
import { describeUploadError } from "@/lib/website/upload-error";

const INTERNAL = [
  { href: "/career", label: "/career — 커리어" },
  { href: "/contact", label: "/contact — Let's Talk" },
  { href: "/about", label: "/about — About" },
  { href: "/expertise", label: "/expertise — Expertise" },
  { href: "/insight", label: "/insight — 인사이트 목록" },
  { href: "/works", label: "/works — 워크 목록" }
] as const;

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function formatDay(value: string | null) {
  if (!value) return "";
  const d = value.slice(0, 10);
  return d.replaceAll("-", ".");
}

type Tab = "pick" | "custom";
type KindFilter = "all" | "work" | "insight";
type SortKey = "recent" | "title";

export function HomePickPanel({
  siteUrl,
  layout,
  open,
  onClose,
  onAdded
}: {
  siteUrl: string;
  layout: HomeLayout;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<Tab>("pick");
  const [items, setItems] = useState<HomeCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [picked, setPicked] = useState<string | null>(null);

  const [thumb, setThumb] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [linkMode, setLinkMode] = useState<"internal" | "external">("internal");
  const [internalHref, setInternalHref] = useState<(typeof INTERNAL)[number]["href"]>("/career");
  const [externalHref, setExternalHref] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab("pick");
    setQ("");
    setKind("all");
    setSort("recent");
    setPicked(null);
    setBusy(false);
    setThumb(null);
    setVideo(null);
    setTitle("");
    setSubtitle("");
    setLinkMode("internal");
    setInternalHref("/career");
    setExternalHref("");
    setLoading(true);
    void listHomeCandidates().then((result) => {
      if (result.ok) setItems(result.data.items);
      else showToast({ message: "후보를 불러오지 못했습니다", tone: "error" });
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = items.filter((item) => {
      if (kind !== "all" && item.target_type !== kind) return false;
      if (!query) return true;
      return homeTitle(item).toLowerCase().includes(query);
    });
    rows.sort((a, b) => {
      if (sort === "title") return homeTitle(a).localeCompare(homeTitle(b), "ko");
      return String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""));
    });
    return rows;
  }, [items, kind, q, sort]);

  const href = linkMode === "internal" ? internalHref : externalHref.trim();
  const customReady = Boolean(thumb && title.trim() && href);
  const customHint = !thumb || !href ? "썸네일과 링크가 필요합니다" : "";
  const wide = layout === "wide";
  const videoLabel = wide ? "T-L" : "T-S";
  const videoParticle = wide ? "과" : "와";
  const videoHint = `${videoLabel} · ${wide ? formatThumbLargeHint() : formatThumbSmallHint()}`;
  const videoMaxMB = wide ? SPEC.thumbLarge.maxMB : SPEC.thumbSmall.maxMB;
  const videoMaxBytes = wide ? SPEC_BYTES.thumbLarge : SPEC_BYTES.thumbSmall;

  async function uploadMedia(file: File, kind: "image" | "video") {
    if (kind === "image") {
      const prepared = await prepareImageForUpload(file, "key");
      if (!prepared.ok) {
        showToast({ message: prepared.error, tone: "error" });
        return;
      }
      const name = sanitizeUploadFilename(prepared.data.file.name, [], prepared.data.file.type);
      const path = uploadObjectPath(`home/custom/${Date.now()}/${wide ? "tl" : "ts"}`, name);
      const result = await uploadFile(prepared.data.file, "site", path, {
        fields: { role: "key" }
      });
      if (!result.ok) {
        const parsed = describeUploadError(result.error, result.status, result.details);
        showToast({ message: parsed.message, tone: "error" });
        return;
      }
      setThumb(result.data.publicUrl);
      return;
    }
    if (file.type !== "video/mp4") {
      showToast({ message: "영상은 MP4 만 됩니다", tone: "error" });
      return;
    }
    if (file.size > videoMaxBytes) {
      showToast({ message: `영상은 ${videoMaxMB}MB 이하여야 합니다`, tone: "error" });
      return;
    }
    const name = sanitizeUploadFilename(file.name);
    const path = uploadObjectPath(`home/custom/${Date.now()}/${wide ? "tl" : "ts"}`, name);
    const result = await uploadFile(file, "site", path);
    if (!result.ok) {
      const parsed = describeUploadError(result.error, result.status, result.details);
      showToast({ message: parsed.message, tone: "error" });
      return;
    }
    setVideo(result.data.publicUrl);
  }

  async function submitPick() {
    if (!picked || busy) return;
    const item = items.find((row) => (row.work_id ?? row.insight_id) === picked);
    if (!item) return;
    setBusy(true);
    const body: HomeSlotWrite = {
      layout,
      target_type: item.target_type,
      work_id: item.work_id ?? undefined,
      insight_id: item.insight_id ?? undefined
    };
    const result = await addHomeSlot(body);
    setBusy(false);
    if (!result.ok) {
      showToast({ message: "추가하지 못했습니다", tone: "error" });
      return;
    }
    onAdded();
    onClose();
  }

  async function submitCustom() {
    if (!customReady || busy || !thumb) return;
    setBusy(true);
    const result = await addHomeSlot({
      layout,
      target_type: "custom",
      custom_title: title.trim(),
      custom_subtitle: subtitle.trim() || undefined,
      custom_image: thumb,
      custom_video: video,
      custom_href: href
    });
    setBusy(false);
    if (!result.ok) {
      showToast({ message: "추가하지 못했습니다", tone: "error" });
      return;
    }
    onAdded();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="w-full max-w-[640px] overflow-hidden rounded-[11px] border border-[#d2d7de] bg-white shadow-[0_4px_18px_rgba(0,0,0,.07)]">
        <div className="flex items-center gap-[9px] border-b border-[#e5e7eb] px-[17px] py-[13px]">
          <span className="text-[15px] font-semibold text-[#16181d]">아티클 추가</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="text-[15px] text-[#9ca3af]">
            ✕
          </button>
        </div>
        <div className="flex gap-0.5 border-b border-[#e5e7eb] px-[17px]">
          {(
            [
              ["pick", "콘텐츠에서 고르기"],
              ["custom", "직접 만들기"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`mb-[-1px] px-[14px] py-[9px] text-[12.5px] ${
                tab === id
                  ? "border-b-2 border-[#534AB7] font-semibold text-[#534AB7]"
                  : "border-b-2 border-transparent text-[#6b7280]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "pick" ? (
          <>
            <div className="max-h-[430px] overflow-y-auto px-[17px] py-[15px]">
              <div className="mb-3 flex flex-wrap gap-1.5">
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="제목으로 찾기"
                  className="min-w-[180px] flex-1 rounded-[7px] border border-[#dde1e6] bg-white px-[11px] py-1.5 text-[12.5px] text-[#3a4049]"
                />
                {(
                  [
                    ["all", "전체"],
                    ["work", "워크"],
                    ["insight", "인사이트"]
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={`rounded-full px-[11px] py-1 text-[11.5px] ${
                      kind === id
                        ? "font-semibold text-[#16181d] shadow-[inset_0_0_0_2px_#16181d]"
                        : "text-[#6b7280] shadow-[inset_0_0_0_1px_#dde1e6]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="rounded-[7px] border border-[#dde1e6] bg-white px-2.5 py-1.5 text-[12.5px] text-[#4a515b]"
                >
                  <option value="recent">최신순</option>
                  <option value="title">제목순</option>
                </select>
              </div>
              {loading ? <p className="text-sm text-[#9ca3af]">불러오는 중…</p> : null}
              {!loading && filtered.length === 0 ? (
                <p className="text-sm text-[#9ca3af]">고를 수 있는 콘텐츠가 없습니다</p>
              ) : null}
              {filtered.map((item) => {
                const key = item.work_id ?? item.insight_id ?? item.slug;
                const selected = picked === key;
                const thumbSrc = mediaUrl(siteUrl, item.thumbnail);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPicked(key)}
                    className={`flex w-full items-center gap-[11px] rounded-[9px] border p-[9px] text-left ${
                      selected
                        ? "border-[#d5cff2] bg-[#f2f0fc]"
                        : "border-transparent hover:border-[#e5e7eb] hover:bg-[#f8f9fb]"
                    }`}
                  >
                    {thumbSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbSrc} alt="" className="h-[42px] w-[74px] shrink-0 rounded-[5px] object-cover" />
                    ) : (
                      <span className="h-[42px] w-[74px] shrink-0 rounded-[5px] bg-slate-200" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-[#16181d]">
                        <span
                          className={`mr-[5px] rounded-[3px] px-1.5 py-px text-[10px] font-bold ${
                            item.target_type === "work"
                              ? "bg-[#eef0fb] text-[#4b5bb5]"
                              : "bg-[#f3eefb] text-[#7c3aed]"
                          }`}
                        >
                          {item.target_type === "work" ? "워크" : "인사이트"}
                        </span>
                        {homeTitle(item)}
                      </span>
                      <span className="mt-px block text-[11px] text-[#9ca3af]">{item.meta.replace(/^[^·]+·\s*/, "")}</span>
                    </span>
                    <span className="whitespace-nowrap text-[11px] text-[#9ca3af]">{formatDay(item.published_at)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-[#e5e7eb] bg-[#f8f9fb] px-[17px] py-3">
              <span className="text-[11.5px] text-[#6b7280]">{picked ? "고른 것 1개" : "하나를 고르면 추가할 수 있습니다"}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded-[7px] border border-[#dde1e6] bg-white px-[13px] py-1.5 text-[12.5px] text-[#3a4049]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!picked || busy}
                onClick={() => void submitPick()}
                className={`rounded-[7px] px-[13px] py-1.5 text-[12.5px] font-semibold text-white ${
                  picked ? "bg-[#534AB7]" : "cursor-not-allowed bg-[#cbd2da]"
                }`}
              >
                추가
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="max-h-[430px] overflow-y-auto px-[17px] py-[15px]">
              <div className="mb-[14px] grid grid-cols-2 gap-2.5">
                <div>
                  <div className="mb-[5px] flex items-center gap-1.5">
                    <b className="text-xs font-semibold">썸네일</b>
                    <span className="text-[11px] text-[#b0231e]">*</span>
                  </div>
                  {thumb ? (
                    <div className="relative aspect-video overflow-hidden rounded-[9px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setThumb(null)}
                        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs text-white"
                      >
                        ✕
                      </button>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-[13px] py-[11px]">
                        <p className="m-0 line-clamp-2 text-[12.5px] font-semibold text-white">{title || "제목"}</p>
                        <p className="mt-0.5 line-clamp-1 text-[10.5px] text-white/75">{subtitle || "한 줄 설명"}</p>
                      </div>
                    </div>
                  ) : (
                    <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-[3px] rounded-[9px] border-[1.5px] border-dashed border-[#d3d8de] bg-[#fcfcfd] text-[11.5px] text-[#9ca3af] hover:border-[#d5cff2] hover:bg-[#f2f0fc] hover:text-[#534AB7]">
                      <span className="text-xl">＋</span>
                      이미지를 올립니다
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadMedia(file, "image");
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <div className="mt-[5px] rounded-r-[5px] border-l-2 border-[#d5cff2] bg-[#f8f9fb] px-2.5 py-[7px] text-[11px] leading-[1.65] text-[#6b7280]">
                    <b>긴 변 1600 이상.</b>
                    <br />
                    영상도 됩니다. {videoHint}
                  </div>
                </div>
                <div>
                  <div className="mb-[5px] flex items-center gap-1.5">
                    <b className="text-xs font-semibold">영상 (선택)</b>
                  </div>
                  {video ? (
                    <div className="relative aspect-video overflow-hidden rounded-[9px] bg-black">
                      <video src={video} muted loop playsInline className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setVideo(null)}
                        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs text-white"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-[3px] rounded-[9px] border-[1.5px] border-dashed border-[#d3d8de] bg-[#fcfcfd] text-[11.5px] text-[#9ca3af] hover:border-[#d5cff2] hover:bg-[#f2f0fc] hover:text-[#534AB7]">
                      <span className="text-xl">＋</span>
                      마우스를 올리면 재생됩니다
                      <input
                        type="file"
                        accept="video/mp4"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadMedia(file, "video");
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <div className="mt-[5px] rounded-r-[5px] border-l-2 border-[#d5cff2] bg-[#f8f9fb] px-2.5 py-[7px] text-[11px] leading-[1.65] text-[#6b7280]">
                    없으면 이미지만 나옵니다.
                    <br />
                    워크 카드의 {videoLabel} {videoParticle} 같은 규격입니다.
                  </div>
                </div>
              </div>

              <div className="mb-[14px]">
                <div className="mb-[5px] flex items-center gap-1.5">
                  <b className="text-xs font-semibold">제목</b>
                  <span className="text-[11px] text-[#b0231e]">*</span>
                  <span className="ml-auto text-[10.5px] text-[#9ca3af]">국문 {title.trim().length}</span>
                </div>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-[7px] border border-[#dde1e6] bg-white px-[11px] py-1.5 text-[12.5px] text-[#3a4049]"
                />
                <div className="mt-[5px] rounded-r-[5px] border-l-2 border-[#d5cff2] bg-[#f8f9fb] px-2.5 py-[7px] text-[11px] text-[#6b7280]">
                  카드 아래쪽에 굵게 나옵니다.
                </div>
              </div>

              <div className="mb-[14px]">
                <div className="mb-[5px] flex items-center gap-1.5">
                  <b className="text-xs font-semibold">한 줄 설명</b>
                  <span className="ml-auto text-[10.5px] text-[#9ca3af]">국문 {subtitle.trim().length}</span>
                </div>
                <input
                  value={subtitle}
                  onChange={(event) => setSubtitle(event.target.value)}
                  className="w-full rounded-[7px] border border-[#dde1e6] bg-white px-[11px] py-1.5 text-[12.5px] text-[#3a4049]"
                />
                <div className="mt-[5px] rounded-r-[5px] border-l-2 border-[#d5cff2] bg-[#f8f9fb] px-2.5 py-[7px] text-[11px] text-[#6b7280]">
                  제목 아래 작게. 워크는 여기에 카테고리가 나옵니다.
                </div>
              </div>

              <div>
                <div className="mb-[5px] flex items-center gap-1.5">
                  <b className="text-xs font-semibold">링크</b>
                  <span className="text-[11px] text-[#b0231e]">*</span>
                </div>
                <div className="mb-1.5 flex gap-1.5">
                  {(
                    [
                      ["internal", "사이트 안"],
                      ["external", "바깥 주소"]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLinkMode(id)}
                      className={`rounded-full px-[11px] py-1 text-[11.5px] ${
                        linkMode === id
                          ? "font-semibold text-[#16181d] shadow-[inset_0_0_0_2px_#16181d]"
                          : "text-[#6b7280] shadow-[inset_0_0_0_1px_#dde1e6]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {linkMode === "internal" ? (
                  <select
                    value={internalHref}
                    onChange={(event) => setInternalHref(event.target.value as (typeof INTERNAL)[number]["href"])}
                    className="w-full rounded-[7px] border border-[#dde1e6] bg-white px-2.5 py-1.5 text-[12.5px] text-[#4a515b]"
                  >
                    {INTERNAL.map((item) => (
                      <option key={item.href} value={item.href}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={externalHref}
                    onChange={(event) => setExternalHref(event.target.value)}
                    placeholder="https://"
                    className="w-full rounded-[7px] border border-[#dde1e6] bg-white px-[11px] py-1.5 text-[12.5px] text-[#3a4049]"
                  />
                )}
                <div className="mt-[5px] rounded-r-[5px] border-l-2 border-[#d5cff2] bg-[#f8f9fb] px-2.5 py-[7px] text-[11px] text-[#6b7280]">
                  「바깥 주소」를 고르면 새 창으로 열립니다. 기사나 다른 사이트를 걸 때 씁니다.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-[#e5e7eb] bg-[#f8f9fb] px-[17px] py-3">
              <span className="text-[11.5px] text-[#a35a08]">{customHint}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="rounded-[7px] border border-[#dde1e6] bg-white px-[13px] py-1.5 text-[12.5px] text-[#3a4049]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!customReady || busy}
                onClick={() => void submitCustom()}
                className={`rounded-[7px] px-[13px] py-1.5 text-[12.5px] font-semibold text-white ${
                  customReady ? "bg-[#534AB7]" : "cursor-not-allowed bg-[#cbd2da]"
                }`}
              >
                추가
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
