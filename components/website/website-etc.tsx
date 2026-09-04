"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import { showToast } from "@/components/website/toast";
import {
  generatePageMetaDraft,
  listPageMeta,
  updatePageMeta,
  type PageMetaRow,
  type PageSchemaType
} from "@/lib/website/api";
import { mediaUrl } from "@/lib/website/work-detail";
import "@/components/website/ui/etc-admin.css";

type Loc = { ko: string; en: string };

type TabKey =
  | "site"
  | "home"
  | "works"
  | "insight"
  | "career"
  | "contact"
  | "about"
  | "expertise"
  | "privacy"
  | "notfound";

const TAB_ORDER: { key: TabKey; label: string; sepAfter?: boolean }[] = [
  { key: "site", label: "사이트 공통", sepAfter: true },
  { key: "home", label: "홈" },
  { key: "works", label: "Works 목록" },
  { key: "insight", label: "Insight 목록" },
  { key: "career", label: "Career" },
  { key: "contact", label: "Let's Talk", sepAfter: true },
  { key: "about", label: "About" },
  { key: "expertise", label: "Expertise" },
  { key: "privacy", label: "Privacy" },
  { key: "notfound", label: "404" }
];

const PATHS: Record<TabKey, string> = {
  site: "전체",
  home: "apollonworks.com",
  works: "apollonworks.com/works",
  insight: "apollonworks.com/insight",
  career: "apollonworks.com/career",
  contact: "apollonworks.com/contact",
  about: "apollonworks.com/about",
  expertise: "apollonworks.com/expertise",
  privacy: "apollonworks.com/privacy",
  notfound: "—"
};

const PREVIEW_PATH: Record<TabKey, string> = {
  site: "/",
  home: "/",
  works: "/works",
  insight: "/insight",
  career: "/career",
  contact: "/contact",
  about: "/about",
  expertise: "/expertise",
  privacy: "/privacy",
  notfound: "/not-a-real-page"
};

const HELP = {
  title:
    "검색 결과의 파란 제목이자 브라우저 탭 글자입니다. 「| 아폴론이머시브웍스」는 자동으로 붙습니다",
  siteTitle: "모든 페이지 제목 뒤에 「| 아폴론이머시브웍스」로 붙습니다",
  desc: "검색 결과에 제목 아래 나오는 두 줄",
  siteDesc: "페이지에 설명이 없으면 이것이 나갑니다",
  og: "카톡 · 슬랙 · SNS 에 링크를 붙일 때 뜨는 그림입니다",
  ai: "AI 가 회사를 설명할 때 근거로 씁니다. 사실만 담으세요",
  schema: "검색엔진이 회사 정보를 알아보게 하는 표시입니다. 회사 소개는 Organization 이 맞습니다"
} as const;

const TITLE_KO_MAX = 30;
const DESC_KO_MAX = 80;
const DESC_EN_MAX = 155;

function emptyLoc(): Loc {
  return { ko: "", en: "" };
}

function asLoc(value: Loc | null | undefined): Loc {
  return { ko: value?.ko ?? "", en: value?.en ?? "" };
}

function filledLoc(value: Loc | null | undefined): boolean {
  return Boolean(value && (value.ko.trim() || value.en.trim()));
}

function useFoldPartialSave(onReload: () => Promise<void>) {
  const [state, setState] = useState<PartialSaveState>("idle");
  const markDirty = useCallback(() => {
    setState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);
  const save = useCallback(
    async (build: () => Promise<boolean>) => {
      setState("saving");
      const ok = await build();
      if (!ok) {
        setState("dirty");
        return false;
      }
      setState("saved");
      window.setTimeout(() => setState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      await onReload();
      return true;
    },
    [onReload]
  );
  return { state, markDirty, save };
}

function tabDot(row: PageMetaRow | undefined, site: PageMetaRow | undefined): "ok" | "warn" | "" {
  if (!row) return "";
  const ownTitle = filledLoc(row.title);
  const ownDesc = filledLoc(row.search_description);
  const ownOg = Boolean(row.og_image?.trim());
  const ownAi = filledLoc(row.ai_summary);
  const anyOwn = ownTitle || ownDesc || ownOg || ownAi || row.schema_type !== "none";

  if (row.key === "site") {
    if (ownTitle && ownDesc && ownOg) return ownAi ? "ok" : "warn";
    if (!anyOwn) return "";
    return ownTitle && ownDesc ? "warn" : "";
  }

  if (!anyOwn) return "";

  const titleOk = ownTitle || filledLoc(site?.title);
  const descOk = ownDesc || filledLoc(site?.search_description);
  const ogOk = ownOg || Boolean(site?.og_image?.trim());
  if (titleOk && descOk && ogOk && ownAi) return "ok";
  if (titleOk && descOk && ogOk) return "warn";
  return "warn";
}

type Draft = {
  title: Loc;
  search_description: Loc;
  ai_summary: Loc;
  schema_type: PageSchemaType;
  og_image: string | null;
  og_image_width: number | null;
  og_image_height: number | null;
};

function rowToDraft(row: PageMetaRow): Draft {
  return {
    title: asLoc(row.title),
    search_description: asLoc(row.search_description),
    ai_summary: asLoc(row.ai_summary),
    schema_type: row.schema_type,
    og_image: row.og_image,
    og_image_width: row.og_image_width,
    og_image_height: row.og_image_height
  };
}

export function WebsiteEtc({ siteUrl }: { siteUrl: string }) {
  const [rows, setRows] = useState<PageMetaRow[]>([]);
  const [tab, setTab] = useState<TabKey>("about");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [descOpen, setDescOpen] = useState(false);
  const [lunaBusy, setLunaBusy] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const siteRow = rows.find((r) => r.key === "site");

  const reload = useCallback(async () => {
    const res = await listPageMeta();
    if (!res.ok) {
      showToast({ message: res.error, tone: "error" });
      return;
    }
    setRows(res.data.items);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await listPageMeta();
      if (!alive) return;
      if (!res.ok) {
        showToast({ message: res.error, tone: "error" });
        setLoading(false);
        return;
      }
      setRows(res.data.items);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const row = rows.find((r) => r.key === tab);
    if (row) setDraft(rowToDraft(row));
  }, [rows, tab]);

  const searchPartial = useFoldPartialSave(reload);
  const aiPartial = useFoldPartialSave(reload);

  function patchDraft(next: Partial<Draft>, fold: "search" | "ai") {
    setDraft((cur) => (cur ? { ...cur, ...next } : cur));
    if (fold === "search") searchPartial.markDirty();
    else aiPartial.markDirty();
  }

  const searchDone = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    if (draft.title.ko.trim() || draft.title.en.trim()) n += 1;
    if (draft.search_description.ko.trim() || draft.search_description.en.trim()) n += 1;
    if (draft.og_image?.trim()) n += 1;
    return n;
  }, [draft]);

  const aiDone = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    if (draft.ai_summary.ko.trim() || draft.ai_summary.en.trim()) n += 1;
    if (draft.schema_type !== "none") n += 1;
    return n;
  }, [draft]);

  async function saveSearch() {
    return searchPartial.save(async () => {
      const d = draftRef.current;
      if (!d) return false;
      const res = await updatePageMeta(tab, {
        title: d.title,
        search_description: {
          ko: d.search_description.ko,
          en: d.search_description.en
        },
        og_image: d.og_image,
        og_image_width: d.og_image_width,
        og_image_height: d.og_image_height
      });
      if (!res.ok) {
        showToast({ message: res.error, tone: "error" });
        return false;
      }
      showToast({ message: "저장되었습니다", tone: "ok" });
      return true;
    });
  }

  async function saveAi() {
    return aiPartial.save(async () => {
      const d = draftRef.current;
      if (!d) return false;
      const res = await updatePageMeta(tab, {
        ai_summary: d.ai_summary,
        schema_type: d.schema_type
      });
      if (!res.ok) {
        showToast({ message: res.error, tone: "error" });
        return false;
      }
      showToast({ message: "저장되었습니다", tone: "ok" });
      return true;
    });
  }

  async function saveAll() {
    const a = await saveSearch();
    const b = await saveAi();
    if (a && b) showToast({ message: "전체 저장되었습니다", tone: "ok" });
  }

  async function runLuna() {
    setLunaBusy(true);
    const res = await generatePageMetaDraft(tab);
    setLunaBusy(false);
    if (!res.ok) {
      patchDraft({ ai_summary: emptyLoc() }, "ai");
      showToast({ message: res.reason, tone: "error" });
      return;
    }
    patchDraft({ ai_summary: res.data }, "ai");
    showToast({ message: "루나 초안을 넣었습니다", tone: "ok" });
  }

  function openPreview() {
    const path = PREVIEW_PATH[tab];
    const base = (siteUrl || "http://localhost:3100").replace(/\/$/, "");
    window.open(`${base}${path}`, "_blank", "noopener,noreferrer");
  }

  const inheritTitle = tab !== "site" && draft && !filledLoc(draft.title);
  const inheritDesc = tab !== "site" && draft && !filledLoc(draft.search_description);
  const inheritOg = tab !== "site" && draft && !draft.og_image?.trim();

  const serpTitle =
    draft?.title.ko.trim() ||
    (tab !== "site" ? siteRow?.title.ko.trim() : "") ||
    "제목";
  const serpDesc =
    draft?.search_description.ko.trim() ||
    (tab !== "site" ? siteRow?.search_description?.ko?.trim() : "") ||
    "";

  const ogPreview = draft?.og_image
    ? mediaUrl(siteUrl, draft.og_image)
    : inheritOg && siteRow?.og_image
      ? mediaUrl(siteUrl, siteRow.og_image)
      : null;

  if (loading || !draft) {
    return <div className="etc loading">불러오는 중…</div>;
  }

  const isSite = tab === "site";
  const titleLabel = isSite ? "사이트 이름" : "브라우저 탭 제목";
  const descLabel = isSite ? "기본 검색 설명" : "검색 설명";
  const ogLabel = isSite ? "기본 공유 이미지" : "공유 이미지";

  return (
    <div className="etc">
      <div className="box">
        <div className="hd">
          <div>
            <h3>검색과 AI 설정</h3>
            <div className="sub">페이지마다 검색엔진과 AI 가 읽는 값을 고칩니다</div>
          </div>
          <button type="button" className="b" onClick={openPreview}>
            미리보기 ↗
          </button>
        </div>

        <div className="tabs">
          {TAB_ORDER.flatMap((item) => {
            const btn = (
              <button
                key={item.key}
                type="button"
                className={tab === item.key ? "on" : undefined}
                onClick={() => setTab(item.key)}
              >
                <span
                  className={`st ${tabDot(
                    rows.find((r) => r.key === item.key),
                    siteRow
                  )}`}
                />
                {item.label}
              </button>
            );
            return item.sepAfter
              ? [btn, <span className="sep" key={`sep-${item.key}`} />]
              : [btn];
          })}
        </div>

        <div className="path">{PATHS[tab]}</div>

        <div className="grp">
          <div className="grph">
            <h4>검색이 읽는 것</h4>
            <div className="grpr">
              <span className={searchDone >= 3 ? "cnt" : "cnt warn"}>{searchDone} / 3</span>
              <PartialSaveBtn state={searchPartial.state} onClick={() => void saveSearch()} />
            </div>
          </div>
          <p className="grpd">구글 검색 결과와 링크 공유에 그대로 나옵니다.</p>

          <div className="box-inner">
            <div className="f">
              <div className="fl">
                <span className="nm">{titleLabel}</span>
                <span className="rq">*</span>
                <button type="button" className="q" title={isSite ? HELP.siteTitle : HELP.title}>
                  ?
                </button>
                {inheritTitle ? <span className="inherit">사이트 공통을 씁니다</span> : null}
                <span className="cc">
                  국문 <b>{draft.title.ko.length}</b> / {TITLE_KO_MAX}
                </span>
              </div>
              <div className="lang">
                <span className="tag">국문</span>
                <input
                  type="text"
                  value={draft.title.ko}
                  placeholder={inheritTitle ? siteRow?.title.ko || undefined : undefined}
                  onChange={(e) =>
                    patchDraft({ title: { ...draft.title, ko: e.target.value } }, "search")
                  }
                />
              </div>
              <div className="lang">
                <span className="tag">영문</span>
                <input
                  type="text"
                  value={draft.title.en}
                  placeholder={inheritTitle ? siteRow?.title.en || undefined : undefined}
                  onChange={(e) =>
                    patchDraft({ title: { ...draft.title, en: e.target.value } }, "search")
                  }
                />
              </div>
              <p className="hint">{isSite ? HELP.siteTitle : HELP.title}</p>
            </div>

            <div className="f">
              <div className="fl">
                <span className="nm">{descLabel}</span>
                <span className="rq">*</span>
                <button type="button" className="q" title={isSite ? HELP.siteDesc : HELP.desc}>
                  ?
                </button>
                {inheritDesc ? <span className="inherit">사이트 공통을 씁니다</span> : null}
                <button type="button" className="b sm" onClick={() => setDescOpen(true)}>
                  ⤢ 크게 열기
                </button>
              </div>
              <div className="lang">
                <span className="tag">국문</span>
                <textarea
                  rows={2}
                  value={draft.search_description.ko}
                  placeholder={
                    inheritDesc ? siteRow?.search_description?.ko || undefined : undefined
                  }
                  onChange={(e) =>
                    patchDraft(
                      {
                        search_description: {
                          ...draft.search_description,
                          ko: e.target.value
                        }
                      },
                      "search"
                    )
                  }
                />
              </div>
              <div className="lang">
                <span className="tag">영문</span>
                <textarea
                  rows={2}
                  value={draft.search_description.en}
                  placeholder={
                    inheritDesc ? siteRow?.search_description?.en || undefined : undefined
                  }
                  onChange={(e) =>
                    patchDraft(
                      {
                        search_description: {
                          ...draft.search_description,
                          en: e.target.value
                        }
                      },
                      "search"
                    )
                  }
                />
              </div>
              <div className="hint-row">
                <p className="hint">{isSite ? HELP.siteDesc : HELP.desc}</p>
                <span className="cc">
                  국문 <b>{draft.search_description.ko.length}</b>/{DESC_KO_MAX} · 영문{" "}
                  <b>{draft.search_description.en.length}</b>/{DESC_EN_MAX}
                </span>
              </div>
            </div>

            <div className="f">
              <div className="fl">
                <span className="nm">{ogLabel}</span>
                <span className="rq">*</span>
                <button type="button" className="q" title={HELP.og}>
                  ?
                </button>
                {inheritOg ? <span className="inherit">사이트 공통을 씁니다</span> : null}
              </div>
              {ogPreview ? (
                <div className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ogPreview} alt="" />
                </div>
              ) : (
                <div className="thumb empty">
                  <span aria-hidden>⬆</span>
                  <span>올리기</span>
                </div>
              )}
              <div className="thumb-actions">
                <ImageUploader
                  bucket="site"
                  folder="page-meta"
                  accept="image"
                  kind="key"
                  siteUrl={siteUrl}
                  value={draft.og_image}
                  emptyHint="올리기"
                  onUploaded={(items: UploadedMedia[]) => {
                    const first = items[0];
                    if (!first) return;
                    patchDraft(
                      {
                        og_image: first.src,
                        og_image_width: first.width,
                        og_image_height: first.height
                      },
                      "search"
                    );
                  }}
                  onClear={() =>
                    patchDraft(
                      { og_image: null, og_image_width: null, og_image_height: null },
                      "search"
                    )
                  }
                />
              </div>
              <p className="spec">
                1200 × 630 · 지금{" "}
                {draft.og_image_width && draft.og_image_height
                  ? `${draft.og_image_width} × ${draft.og_image_height}`
                  : draft.og_image
                    ? "있음"
                    : "없음"}
              </p>
              <p className={`hint${isSite && !draft.og_image ? " warn" : ""}`}>
                {isSite && !draft.og_image
                  ? "전용 이미지가 없어 1.4MB 짜리 키비주얼이 대신 나갑니다. 오픈 전에 만들어야 합니다"
                  : HELP.og}
              </p>
            </div>
          </div>
        </div>

        <div className="grp">
          <div className="grph">
            <h4>AI 가 읽는 것</h4>
            <div className="grpr">
              <span className={aiDone >= 2 ? "cnt" : "cnt warn"}>{aiDone} / 2</span>
              <PartialSaveBtn state={aiPartial.state} onClick={() => void saveAi()} />
            </div>
          </div>
          <p className="grpd">ChatGPT · Perplexity 가 이 페이지를 읽고 답할 때 씁니다.</p>

          <div className="box-inner">
            <div className="f">
              <div className="fl">
                <span className="nm">한 문단 요약</span>
                <button type="button" className="q" title={HELP.ai}>
                  ?
                </button>
                <button
                  type="button"
                  className="b sm acc"
                  disabled={lunaBusy}
                  onClick={() => void runLuna()}
                >
                  {lunaBusy ? "만드는 중…" : "✦ 루나가 초안"}
                </button>
              </div>
              <div className="lang">
                <span className="tag">국문</span>
                <textarea
                  rows={3}
                  value={draft.ai_summary.ko}
                  onChange={(e) =>
                    patchDraft(
                      { ai_summary: { ...draft.ai_summary, ko: e.target.value } },
                      "ai"
                    )
                  }
                />
              </div>
              <div className="lang">
                <span className="tag">영문</span>
                <textarea
                  rows={3}
                  value={draft.ai_summary.en}
                  placeholder="영문 요약"
                  onChange={(e) =>
                    patchDraft(
                      { ai_summary: { ...draft.ai_summary, en: e.target.value } },
                      "ai"
                    )
                  }
                />
              </div>
              <p className="hint">{HELP.ai}</p>
            </div>

            <div className="f">
              <div className="fl">
                <span className="nm">구조화 데이터</span>
                <button type="button" className="q" title={HELP.schema}>
                  ?
                </button>
              </div>
              <div className="schema-row">
                {(
                  [
                    ["Organization", "Organization"],
                    ["WebPage", "WebPage"],
                    ["none", "넣지 않음"]
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`b sm${draft.schema_type === value ? " acc" : ""}`}
                    onClick={() => patchDraft({ schema_type: value }, "ai")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="hint">{HELP.schema}</p>
            </div>
          </div>
        </div>

        <div className="lab">검색 결과에 이렇게 보입니다</div>
        <div className="serp">
          <div className="u">
            {tab === "about" ? "apollonworks.com › about" : PATHS[tab]}
          </div>
          <div className="t">{serpTitle}</div>
          <div className="d">{serpDesc}</div>
        </div>
        <p className="note">값을 고치면 바로 반영됩니다.</p>
      </div>

      <div className="ft">
        <div className="ftrow">
          <button type="button" className="b" onClick={openPreview}>
            미리보기 ↗
          </button>
          <div className="ftr">
            <button
              type="button"
              className={`b${searchPartial.state === "dirty" || aiPartial.state === "dirty" ? "" : " off"}`}
              onClick={() => void saveAll()}
            >
              전체 저장
            </button>
            <button
              type="button"
              className="b chk"
              onClick={() =>
                showToast({
                  message:
                    searchDone < 3
                      ? "검색 필수 값이 비어 있습니다"
                      : aiDone < 2
                        ? "AI 권장 값이 비어 있습니다"
                        : "필수·권장 값이 채워져 있습니다",
                  tone: searchDone < 3 ? "error" : "ok"
                })
              }
            >
              <span className="dot2" />
              점검
            </button>
            <button
              type="button"
              className="b acc"
              onClick={() =>
                showToast({
                  message: "검색·AI 값은 저장 즉시 공개 사이트에 반영됩니다",
                  tone: "ok"
                })
              }
            >
              공개
            </button>
          </div>
        </div>
      </div>

      <div className={descOpen ? "big-ov on" : "big-ov"}>
        <div className="big-mw">
          <div className="big-mwh">
            <b>{descLabel}</b>
            <button type="button" className="xb" onClick={() => setDescOpen(false)}>
              ×
            </button>
          </div>
          <div className="lang">
            <span className="tag">국문</span>
            <textarea
              rows={6}
              value={draft.search_description.ko}
              onChange={(e) =>
                patchDraft(
                  {
                    search_description: { ...draft.search_description, ko: e.target.value }
                  },
                  "search"
                )
              }
            />
          </div>
          <div className="lang">
            <span className="tag">영문</span>
            <textarea
              rows={6}
              value={draft.search_description.en}
              onChange={(e) =>
                patchDraft(
                  {
                    search_description: { ...draft.search_description, en: e.target.value }
                  },
                  "search"
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
