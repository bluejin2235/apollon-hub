"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageUploader } from "@/components/website/image-uploader";
import {
  InsightCropModal,
  ratioFromSize,
  ratioMeta,
  type InsightCropRatio
} from "@/components/website/insight-crop-modal";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import { TagPicker } from "@/components/website/tag-picker";
import { showToast } from "@/components/website/toast";
import { locField } from "@/components/website/work-editor-ui";
import { setInsightTags, updateInsight, generateInsightSlug } from "@/lib/website/api";
import {
  isNewsCategory,
  type InsightBasicDraft,
  type InsightDetail,
  type KeyImageRatio
} from "@/lib/website/insight-detail";
import type { WebsiteCategory } from "@/lib/website/types";
import { workFolderPrefix } from "@/lib/website/upload-path";
import { mediaUrl } from "@/lib/website/work-detail";
import "./ui/work-admin.css";

type Props = {
  draft: InsightBasicDraft;
  onChange: (patch: Partial<InsightBasicDraft>) => void;
  insight: InsightDetail;
  categories: WebsiteCategory[];
  siteUrl: string;
  onReload: () => Promise<void>;
};

type HelpBody = {
  title: string;
  use: string;
  rule: string;
  note: React.ReactNode;
  empty: string;
};

const HELP = {
  cat: {
    title: "분류",
    use: "목록 필터와 상세 상단에 나옵니다",
    rule: "목록 필터와 상세 상단에 나옵니다",
    note: "분류에 따라 달라지는 칸은 뉴스 하나뿐입니다.",
    empty: "공개할 수 없습니다"
  },
  title: {
    title: "제목",
    use: "목록 카드 · 상세 맨 위 · 브라우저 탭 · 검색 결과 제목 · 링크 공유 제목",
    rule: "목록 카드 · 상세 맨 위 · 브라우저 탭 · 검색 결과 제목 · 링크 공유 제목",
    note: "검색 결과에는 앞부분만 표시됩니다",
    empty: "공개할 수 없습니다"
  },
  sub: {
    title: "부제",
    use: "제목 아래. 줄바꿈이 그대로 나옵니다",
    rule: "줄바꿈이 그대로 나옵니다",
    note: "제목 아래. 줄바꿈이 그대로 나옵니다",
    empty: "그 칸은 라벨만 남고 값이 빈칸으로 나옵니다"
  },
  pub: {
    title: "공개일",
    use: "목록 정렬 기준",
    rule: "목록 정렬 기준",
    note: "목록 정렬 기준",
    empty: "공개할 수 없습니다"
  },
  tag: {
    title: "태그",
    use: "워크 목록 위 필터. 상세 페이지에는 나오지 않습니다",
    rule: "3~6개. 너무 많으면 필터가 지저분해집니다",
    note: "없는 태그를 치면 새로 만들 수 있습니다. 이미 있는 것을 쓰는 편이 낫습니다",
    empty: "필터에서 이 워크를 찾을 수 없습니다"
  },
  news: {
    title: "뉴스일 때만 나오는 칸",
    use: "상세 상단에 「Press 서울경제 · 원문보기」로 나옵니다",
    rule: "뉴스일 때만 나오는 칸",
    note: "매체 이름 · 원문 주소 · 보도일",
    empty: "상세 상단에 「Press 서울경제 · 원문보기」로 나옵니다"
  },
  key: {
    title: "대표 이미지",
    use: "목록 카드와 상세 맨 위에 쓰입니다. 인사이트는 배경 영상이 없습니다.",
    rule: "올릴 때 — 비율·크기 제한 없음. 자른 긴 변 800 이상. 저장 — 고른 비율로 잘라 한 장만",
    note: (
      <>
        목록은 비율이 다른 카드가 섞여 리듬을 만듭니다.
        <br />
        긴 글·인터뷰는 세로(3:4), 사진 한 장이면 정사각(1:1),
        <br />
        가볍게 지나가는 뉴스는 가로(16:9)가 어울립니다.
      </>
    ),
    empty: "공개할 수 없습니다"
  },
  slug: {
    title: "주소",
    use: "이 워크의 웹 주소. 검색엔진이 이 글자를 읽습니다",
    rule: "영문 소문자와 하이픈만. 제목의 뜻이 담기게 씁니다",
    note: "공개한 뒤에 바꾸면 그동안 쌓인 검색 순위가 사라지고, 외부에 걸린 링크가 끊깁니다",
    empty: "공개할 수 없습니다"
  },
  sum: {
    title: "한 줄 요약",
    use: "구글 검색 결과에서 제목 아래 나오는 설명문. 링크를 공유할 때도 이 글이 보입니다. 화면에는 나오지 않습니다",
    rule: "무엇을 어떻게 바꿨는지 한 문장으로. 검색하는 사람이 이 글을 보고 누를지 정합니다",
    note: "검색 결과에는 앞부분만 표시됩니다",
    empty: "공개할 수 없습니다. 검색 결과에 설명이 없으면 클릭률이 떨어집니다"
  },
  alt: {
    title: "대체 텍스트",
    use: "이미지가 안 뜰 때 그 자리에 나오는 글. 화면 읽기 프로그램이 읽어주고, 검색엔진과 AI 도 이 글로 이미지를 이해합니다",
    rule: "보이는 것을 그대로 씁니다",
    note: "「이미지」 「사진」 같은 말은 넣지 마세요. 무엇이 찍혀 있는지만 적습니다",
    empty: "공개할 수 없습니다"
  }
} satisfies Record<string, HelpBody>;

function filled(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function apiFailMessage(res: { error: string; details?: unknown }): string {
  const details = res.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return `${res.error}: ${message}`;
    }
  }
  return res.error + (details != null ? ` · ${JSON.stringify(details)}` : "");
}

function isPlaceholderKey(src: string) {
  return !src.trim() || /placeholder-wide/i.test(src);
}

function isPlaceholderSlug(slug: string) {
  return !slug.trim() || /^insight-\d+$/i.test(slug.trim());
}

function isDefaultTitle(title: { ko: string; en: string }) {
  const ko = title.ko.trim();
  const en = title.en.trim();
  if (!ko && !en) return true;
  return (ko === "새 글" || !ko) && (en === "New" || !en);
}

function useFoldPartialSave(onReload: () => Promise<void>) {
  const [state, setState] = useState<PartialSaveState>("idle");

  const markDirty = useCallback(() => {
    setState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  const save = useCallback(
    async (build: () => Promise<boolean> | boolean) => {
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

function HelpPanel({
  open,
  body,
  onClose
}: {
  open: boolean;
  body: HelpBody;
  onClose: () => void;
}) {
  return (
    <div className={open ? "qp on" : "qp"}>
      <div className="qph">
        <b>{body.title}</b>
        <button type="button" className="xb" onClick={onClose}>
          ×
        </button>
      </div>
      <dl>
        <dt>쓰임</dt>
        <dd>{body.use}</dd>
        <dt>기준</dt>
        <dd>{body.rule}</dd>
        <dt>주의</dt>
        <dd>{body.note}</dd>
        <dt>비면</dt>
        <dd>{body.empty}</dd>
      </dl>
    </div>
  );
}

export function InsightBasicTab({ draft, onChange, insight, categories, siteUrl, onReload }: Props) {
  const uploadRoot = workFolderPrefix(draft.slug || insight.slug, insight.id);
  const keyFilled = !isPlaceholderKey(draft.key_image);
  const tags = [...(insight.insight_tags ?? [])].sort((a, b) => a.sort - b.sort);
  const news = isNewsCategory(draft.category_id);
  const [openHelp, setOpenHelp] = useState<keyof typeof HELP | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [slugBusy, setSlugBusy] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const screenPartial = useFoldPartialSave(onReload);
  const mediaPartial = useFoldPartialSave(onReload);
  const searchPartial = useFoldPartialSave(onReload);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastLunaSlugRef = useRef<string | null>(null);
  const slugTimerRef = useRef<number | null>(null);
  const slugSeqRef = useRef(0);
  const canAutoSlug = insight.status !== "published";

  const chosenRatio: InsightCropRatio =
    draft.key_image_ratio ||
    ratioFromSize(draft.key_image_width, draft.key_image_height) ||
    "3:4";
  const ratio = ratioMeta(chosenRatio);
  const keyUrl = mediaUrl(siteUrl, keyFilled ? draft.key_image : null);

  const screenDone = [
    filled(draft.category_id),
    filled(draft.title.ko),
    filled(draft.subtitle.ko),
    filled(draft.published_at),
    tags.length > 0
  ].filter(Boolean).length;
  const mediaDone = [keyFilled].filter(Boolean).length;
  const searchDone = [
    filled(draft.slug),
    filled(draft.summary.ko),
    filled(draft.key_image_alt.ko)
  ].filter(Boolean).length;

  function toggleHelp(id: keyof typeof HELP) {
    setOpenHelp((cur) => (cur === id ? null : id));
  }

  function patchScreen(next: Partial<InsightBasicDraft>) {
    screenPartial.markDirty();
    onChange(next);
  }

  function patchMedia(next: Partial<InsightBasicDraft>) {
    mediaPartial.markDirty();
    onChange(next);
  }

  function patchSearch(next: Partial<InsightBasicDraft>) {
    searchPartial.markDirty();
    onChange(next);
  }

  async function fillSlugFromTitle(title: { ko: string; en: string }, opts?: { force?: boolean }) {
    if (!canAutoSlug) return;
    if (!opts?.force && isDefaultTitle(title)) return;
    if (!title.ko.trim() && !title.en.trim()) return;
    const current = draftRef.current.slug;
    if (!opts?.force) {
      const userLocked =
        !isPlaceholderSlug(current) &&
        (lastLunaSlugRef.current == null || current !== lastLunaSlugRef.current);
      if (userLocked) return;
    }
    const seq = ++slugSeqRef.current;
    setSlugBusy(true);
    setSlugError(null);
    const res = await generateInsightSlug(title);
    if (seq !== slugSeqRef.current) return;
    setSlugBusy(false);
    if (!res.ok) {
      setSlugError(res.reason);
      showToast({ tone: "error", message: res.reason });
      if (!draftRef.current.slug.trim()) {
        patchSearch({ slug: `insight-${Date.now()}` });
      }
      return;
    }
    lastLunaSlugRef.current = res.slug;
    patchSearch({ slug: res.slug });
  }

  function scheduleSlugFromTitle(title: { ko: string; en: string }) {
    if (!canAutoSlug) return;
    if (slugTimerRef.current) window.clearTimeout(slugTimerRef.current);
    slugTimerRef.current = window.setTimeout(() => {
      void fillSlugFromTitle(title);
    }, 700);
  }

  useEffect(() => {
    return () => {
      if (slugTimerRef.current) window.clearTimeout(slugTimerRef.current);
    };
  }, []);

  async function saveScreen() {
    return screenPartial.save(async () => {
      const d = draftRef.current;
      const isNews = isNewsCategory(d.category_id);
      const res = await updateInsight(insight.id, {
        category_id: d.category_id,
        title: d.title,
        subtitle: d.subtitle,
        published_at: d.published_at || null,
        press_outlet: isNews ? d.press_outlet.trim() || null : null,
        press_href: isNews ? d.press_href.trim() || null : null,
        press_date: isNews ? d.press_date.trim() || null : null
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

  async function saveMedia() {
    return mediaPartial.save(async () => {
      const d = draftRef.current;
      const res = await updateInsight(insight.id, {
        key_image: d.key_image || null,
        key_image_width: d.key_image ? d.key_image_width : null,
        key_image_height: d.key_image ? d.key_image_height : null,
        key_image_ratio: d.key_image ? d.key_image_ratio || null : null
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

  async function saveSearch() {
    return searchPartial.save(async () => {
      const d = draftRef.current;
      const res = await updateInsight(insight.id, {
        slug: d.slug,
        summary: d.summary,
        key_image_alt: d.key_image_alt
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

  return (
    <div className="wa">
      <section className="grp">
        <div className="grph">
          <h3>화면에 나오는 것</h3>
          <div className="grpr">
            <span className={screenDone >= 5 ? "cnt" : "cnt warn"}>{screenDone} / 5</span>
            <PartialSaveBtn state={screenPartial.state} onClick={() => void saveScreen()} />
          </div>
        </div>

        <div className="box">
          <div className="f">
            <div className="fl">
              <span className="nm">분류</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("cat")}>
                ?
              </button>
            </div>
            <div className="chips">
              {categories.map((item) => {
                const on = draft.category_id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={on ? "btn sm acc" : "btn sm"}
                    onClick={() =>
                      patchScreen({
                        category_id: item.id,
                        ...(item.id === "news"
                          ? {}
                          : { press_outlet: "", press_href: "", press_date: "" })
                      })
                    }
                  >
                    {item.id === "behind-the-work" ? "비하인드 워크" : item.label?.ko || item.id}
                  </button>
                );
              })}
            </div>
            <p className="hint-line">목록 필터와 상세 상단에 나옵니다</p>
            <HelpPanel open={openHelp === "cat"} body={HELP.cat} onClose={() => setOpenHelp(null)} />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">제목</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("title")}>
                ?
              </button>
              <span className="cc">
                국문 {draft.title.ko.length} · 영문 {draft.title.en.length}
              </span>
            </div>
            <div className="seclang">
              <span className="tag">국문</span>
              <input
                className="i"
                value={draft.title.ko}
                onChange={(e) => {
                  const title = locField(draft.title, "ko", e.target.value);
                  patchScreen({ title });
                  scheduleSlugFromTitle(title);
                }}
              />
            </div>
            <div className="seclang">
              <span className="tag">영문</span>
              <input
                className="i"
                value={draft.title.en}
                placeholder="영문 제목"
                onChange={(e) => {
                  const title = locField(draft.title, "en", e.target.value);
                  patchScreen({ title });
                  scheduleSlugFromTitle(title);
                }}
              />
            </div>
            <p className="hint-line">검색 결과에는 앞부분만 표시됩니다</p>
            <HelpPanel
              open={openHelp === "title"}
              body={HELP.title}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">부제</span>
              <button type="button" className="q" onClick={() => toggleHelp("sub")}>
                ?
              </button>
              <span className="cc">
                국문 {draft.subtitle.ko.length} · 영문 {draft.subtitle.en.length}
              </span>
            </div>
            <div className="seclang">
              <span className="tag">국문</span>
              <textarea
                className="i"
                rows={2}
                value={draft.subtitle.ko}
                onChange={(e) =>
                  patchScreen({ subtitle: locField(draft.subtitle, "ko", e.target.value) })
                }
              />
            </div>
            <div className="seclang">
              <span className="tag">영문</span>
              <textarea
                className="i"
                rows={2}
                placeholder="영문 부제"
                value={draft.subtitle.en}
                onChange={(e) =>
                  patchScreen({ subtitle: locField(draft.subtitle, "en", e.target.value) })
                }
              />
            </div>
            <p className="hint-line">제목 아래. 줄바꿈이 그대로 나옵니다</p>
            <HelpPanel open={openHelp === "sub"} body={HELP.sub} onClose={() => setOpenHelp(null)} />
          </div>

          <div className="f">
            <div className="row-pub">
              <div>
                <div className="fl">
                  <span className="nm">공개일</span>
                  <span className="rq">*</span>
                  <button type="button" className="q" onClick={() => toggleHelp("pub")}>
                    ?
                  </button>
                </div>
                <input
                  className="i"
                  type="date"
                  value={draft.published_at}
                  onChange={(e) => patchScreen({ published_at: e.target.value })}
                />
                <p className="hint-line">목록 정렬 기준</p>
              </div>
              <div>
                <div className="fl">
                  <span className="nm">태그</span>
                  <button type="button" className="q" onClick={() => toggleHelp("tag")}>
                    ?
                  </button>
                </div>
                <TagPicker
                  workId={insight.id}
                  selectedIds={tags.map((t) => t.tag_id)}
                  onReload={onReload}
                  saveTags={setInsightTags}
                />
                <HelpPanel
                  open={openHelp === "tag"}
                  body={HELP.tag}
                  onClose={() => setOpenHelp(null)}
                />
              </div>
            </div>
            <HelpPanel open={openHelp === "pub"} body={HELP.pub} onClose={() => setOpenHelp(null)} />
          </div>

          {news ? (
            <div className="catbox" data-insight-news-fields>
              <div className="h">뉴스일 때만 나오는 칸</div>
              <div className="row-news">
                <div>
                  <input
                    className="i"
                    value={draft.press_outlet}
                    onChange={(e) => patchScreen({ press_outlet: e.target.value })}
                  />
                  <p className="hint-line">매체 이름</p>
                </div>
                <div>
                  <input
                    className="i"
                    value={draft.press_href}
                    onChange={(e) => patchScreen({ press_href: e.target.value })}
                  />
                  <p className="hint-line">원문 주소</p>
                </div>
                <div>
                  <input
                    className="i"
                    value={draft.press_date}
                    onChange={(e) => patchScreen({ press_date: e.target.value })}
                  />
                  <p className="hint-line">보도일</p>
                </div>
              </div>
              <p className="hint-line">상세 상단에 「Press 서울경제 · 원문보기」로 나옵니다</p>
              <button type="button" className="q" onClick={() => toggleHelp("news")}>
                ?
              </button>
              <HelpPanel
                open={openHelp === "news"}
                body={HELP.news}
                onClose={() => setOpenHelp(null)}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="grp">
        <div className="grph">
          <h3>대표 이미지</h3>
          <div className="grpr">
            <span className={mediaDone >= 1 ? "cnt" : "cnt warn"}>{mediaDone} / 1</span>
            <PartialSaveBtn state={mediaPartial.state} onClick={() => void saveMedia()} />
          </div>
        </div>
        <p className="grpd">목록 카드와 상세 맨 위에 쓰입니다. 인사이트는 배경 영상이 없습니다.</p>

        <div className="box">
          <div className="keyrow">
            <div>
              {keyFilled && keyUrl ? (
                <div className={`keyimg ${ratio.cls}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={keyUrl} alt="" />
                  <span className="ratio-tag">{ratio.tag}</span>
                </div>
              ) : null}
              <ImageUploader
                bucket="insights"
                folder={`${uploadRoot}/key`}
                accept="image"
                contentType="insight"
                contentId={insight.id}
                multiple={false}
                kind="insight-key"
                appearance="filecard"
                hideThumb={keyFilled}
                siteUrl={siteUrl}
                value={keyFilled ? draft.key_image : null}
                emptyHint="자른 긴 변이 800 이상이어야 합니다."
                extraActions={
                  keyFilled ? (
                    <button
                      type="button"
                      className="btn sm acc"
                      onClick={() => setCropOpen(true)}
                    >
                      비율·자르기
                    </button>
                  ) : undefined
                }
                onUploaded={(files) => {
                  const first = files[0];
                  if (!first) return;
                  const inferred = ratioFromSize(first.width, first.height);
                  patchMedia({
                    key_image: first.src,
                    key_image_width: first.width,
                    key_image_height: first.height,
                    key_image_ratio: (inferred as KeyImageRatio | null) || draft.key_image_ratio || ""
                  });
                }}
                onClear={() =>
                  patchMedia({
                    key_image: "",
                    key_image_width: null,
                    key_image_height: null,
                    key_image_ratio: ""
                  })
                }
              />
            </div>
            <div>
              <p className="spec">
                <b>올릴 때</b> — 비율·크기 제한 없음. 자른 긴 변 800 이상
                <br />
                <b>저장</b> — 고른 비율로 잘라 한 장만
                <br />
                {draft.key_image_width && draft.key_image_height ? (
                  <span className="now">
                    지금 {ratio.tag} · {draft.key_image_width} × {draft.key_image_height}
                  </span>
                ) : null}
              </p>
              <p className="hint-line">
                목록은 비율이 다른 카드가 섞여 리듬을 만듭니다.
                <br />
                긴 글·인터뷰는 세로(3:4), 사진 한 장이면 정사각(1:1),
                <br />
                가볍게 지나가는 뉴스는 가로(16:9)가 어울립니다.
              </p>
              <button type="button" className="q" onClick={() => toggleHelp("key")}>
                ?
              </button>
              <HelpPanel
                open={openHelp === "key"}
                body={HELP.key}
                onClose={() => setOpenHelp(null)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grp">
        <div className="grph">
          <h3>검색과 AI 가 읽는 것</h3>
          <div className="grpr">
            <span className={searchDone >= 3 ? "cnt" : "cnt warn"}>{searchDone} / 3</span>
            <PartialSaveBtn state={searchPartial.state} onClick={() => void saveSearch()} />
          </div>
        </div>
        <p className="grpd">
          화면에는 안 보이지만 구글과 AI 가 읽어갑니다. 비면 검색에서 잡히지 않습니다.
        </p>

        <div className="box">
          <div className="f">
            <div className="fl">
              <span className="nm">주소</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("slug")}>
                ?
              </button>
            </div>
            <div className="slugrow">
              <span className="pre">apollonworks.com/insight/</span>
              <input
                className="i"
                value={draft.slug}
                onChange={(e) => patchSearch({ slug: e.target.value })}
              />
              {canAutoSlug ? (
                <button
                  type="button"
                  className="btn sm slug-remake"
                  disabled={slugBusy || isDefaultTitle(draft.title)}
                  onClick={() => void fillSlugFromTitle(draft.title, { force: true })}
                >
                  {slugBusy ? "만드는 중…" : "다시 만들기"}
                </button>
              ) : null}
            </div>
            {slugError ? <p className="hint-line warn">{slugError}</p> : null}
            <p className="hint-line warn">공개한 뒤에는 바꾸지 마세요. 검색 순위가 초기화됩니다</p>
            <HelpPanel
              open={openHelp === "slug"}
              body={HELP.slug}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">한 줄 요약</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("sum")}>
                ?
              </button>
              <span className="cc">
                국문 {draft.summary.ko.length} · 영문 {draft.summary.en.length}
              </span>
            </div>
            <div className="two">
              <textarea
                className="i"
                rows={2}
                value={draft.summary.ko}
                onChange={(e) =>
                  patchSearch({ summary: { ...draft.summary, ko: e.target.value } })
                }
              />
              <textarea
                className="i"
                rows={2}
                value={draft.summary.en}
                onChange={(e) =>
                  patchSearch({ summary: { ...draft.summary, en: e.target.value } })
                }
              />
            </div>
            <p className="hint-line">검색 결과에는 앞부분만 표시됩니다</p>
            <HelpPanel open={openHelp === "sum"} body={HELP.sum} onClose={() => setOpenHelp(null)} />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">대체 텍스트</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("alt")}>
                ?
              </button>
              <span className="cc">
                국문 {draft.key_image_alt.ko.length} · 영문 {draft.key_image_alt.en.length}
              </span>
            </div>
            <div className="two">
              <input
                className="i"
                value={draft.key_image_alt.ko}
                onChange={(e) =>
                  patchSearch({
                    key_image_alt: { ...draft.key_image_alt, ko: e.target.value }
                  })
                }
              />
              <input
                className="i"
                value={draft.key_image_alt.en}
                onChange={(e) =>
                  patchSearch({
                    key_image_alt: { ...draft.key_image_alt, en: e.target.value }
                  })
                }
              />
            </div>
            <p className="hint-line">이미지를 못 보는 사람과 AI 가 읽습니다</p>
            <HelpPanel open={openHelp === "alt"} body={HELP.alt} onClose={() => setOpenHelp(null)} />
          </div>
        </div>
      </section>

      <InsightCropModal
        open={cropOpen}
        src={draft.key_image}
        siteUrl={siteUrl}
        folder={`${uploadRoot}/key`}
        initialRatio={chosenRatio}
        onClose={() => setCropOpen(false)}
        onSaved={(next) => {
          patchMedia({
            key_image: next.src,
            key_image_width: next.width,
            key_image_height: next.height,
            key_image_ratio: next.ratio
          });
        }}
      />
    </div>
  );
}
