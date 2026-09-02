"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearInterview,
  createSection,
  deleteSection,
  getInsight,
  getMeta,
  listInsights,
  setInterview
} from "@/lib/website/api";
import type { InsightListItem, WebsiteCategory } from "@/lib/website/types";
import { parseInsightDetail } from "@/lib/website/insight-detail";
import {
  asLoc,
  emptyLoc,
  interviewRowOf,
  interviewSectionOf,
  locOrNull,
  mediaUrl,
  type Loc,
  type WorkDetail
} from "@/lib/website/work-detail";
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import "./ui/work-admin.css";

type Props = {
  work: WorkDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

type HelpId = "ins" | "quote" | "who";

const HELP: Record<
  HelpId,
  { title: string; use: string; rule: string; note: string; empty: string }
> = {
  ins: {
    title: "연결한 인사이트",
    use: "워크 상세 하단 인터뷰 자리. 인용문과 사진이 나오고 누르면 그 인사이트로 갑니다",
    rule: "공개된 인사이트만 고를 수 있습니다",
    note: "연결한 인사이트를 감추면 이 워크의 인터뷰도 안 나옵니다",
    empty: "인터뷰 표시를 켜둔 채 비우면 공개할 수 없습니다"
  },
  quote: {
    title: "화면에 보일 인용문",
    use: "인터뷰 자리에 큰 글씨로 나오는 한 문장",
    rule: "80자 안쪽. 한 문장으로",
    note: "인사이트 본문이 길면 그중 이 워크와 맞는 한 문장만 골라 적으세요",
    empty: "인사이트에 적힌 원래 인용문이 나옵니다"
  },
  who: {
    title: "이름 · 직함",
    use: "인용문 아래 작은 글씨",
    rule: "이름과 직함을 가운뎃점으로 잇습니다",
    note: "외부 인물이면 소속을 적으세요",
    empty: "인사이트에 적힌 이름이 나옵니다"
  }
};

function formatDotDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}. ${month}. ${day}`;
}

function locField(current: Loc, side: "ko" | "en", value: string): Loc {
  return { ...current, [side]: value };
}

export function WorkInterviewTab({ work, siteUrl, onReload }: Props) {
  const section = interviewSectionOf(work);
  const row = interviewRowOf(work);
  const shown = Boolean(section);
  const [on, setOn] = useState(shown);
  const [quote, setQuote] = useState<Loc>(asLoc(row?.quote_override));
  const [attribution, setAttribution] = useState<Loc>(asLoc(row?.attribution_override));
  const [saveState, setSaveState] = useState<PartialSaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [openHelp, setOpenHelp] = useState<HelpId | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<InsightListItem | null>(null);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);

  useEffect(() => {
    setOn(shown);
  }, [shown]);

  useEffect(() => {
    setQuote(asLoc(row?.quote_override));
    setAttribution(asLoc(row?.attribution_override));
    setSaveState("idle");
  }, [row?.insight_id, row?.quote_override, row?.attribution_override]);

  useEffect(() => {
    void getMeta().then((res) => {
      if (res.ok) setCategories(res.data.insightCategories ?? []);
    });
  }, []);

  useEffect(() => {
    if (!row?.insight_id) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    void getInsight(row.insight_id).then((res) => {
      if (cancelled || !res.ok) return;
      const parsed = parseInsightDetail(res.data);
      if (!parsed) return;
      setSelected({
        id: parsed.id,
        slug: parsed.slug,
        title: parsed.title,
        status: parsed.status,
        category_id: parsed.category_id,
        year: parsed.year,
        published_at: parsed.published_at,
        key_image: parsed.key_image,
        key_image_width: parsed.key_image_width,
        key_image_height: parsed.key_image_height,
        show_faq: parsed.show_faq,
        updated_at: parsed.updated_at,
        counts: { blocks: 0, images: 0, tags: 0, related: 0 },
        check: parsed.check ?? null
      });
    });
    return () => {
      cancelled = true;
    };
  }, [row?.insight_id]);

  const categoryLabel = useMemo(() => {
    if (!selected) return "";
    const found = categories.find((item) => item.id === selected.category_id);
    return found?.label?.ko || selected.category_id;
  }, [categories, selected]);

  function markDirty() {
    setSaveState((cur) => (cur === "saving" ? cur : "dirty"));
  }

  async function ensureSection(): Promise<string | null> {
    if (section) return section.id;
    const sort =
      Math.max(0, ...(work.work_sections ?? []).map((item) => item.sort)) + 1;
    const created = await createSection(work.id, {
      headline: { ko: "인터뷰", en: "Interview" },
      kind: "interview",
      sort
    });
    if (!created.ok) {
      setError(created.error);
      return null;
    }
    const id = typeof created.data.id === "string" ? created.data.id : null;
    await onReload();
    return id;
  }

  async function toggleShow(next: boolean) {
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      if (next) {
        if (!(await ensureSection())) {
          setOn(false);
          return;
        }
      } else {
        const cleared = await clearInterview(work.id);
        if (!cleared.ok) {
          setError(cleared.error);
          setOn(true);
          return;
        }
        if (section) {
          const removed = await deleteSection(work.id, section.id);
          if (!removed.ok) {
            setError(removed.error);
            setOn(true);
            return;
          }
        }
        await onReload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function pickInsight(item: InsightListItem) {
    setPicker(false);
    setBusy(true);
    setError(null);
    try {
      const sectionId = await ensureSection();
      if (!sectionId) return;
      const res = await setInterview(work.id, {
        section_id: sectionId,
        insight_id: item.id,
        quote_override: locOrNull(quote),
        attribution_override: locOrNull(attribution)
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function savePartial() {
    if (!row?.insight_id || !section) return;
    setSaveState("saving");
    setError(null);
    const res = await setInterview(work.id, {
      section_id: section.id,
      insight_id: row.insight_id,
      quote_override: locOrNull(quote),
      attribution_override: locOrNull(attribution)
    });
    if (!res.ok) {
      setError(res.error);
      setSaveState("dirty");
      return;
    }
    setSaveState("saved");
    window.setTimeout(() => setSaveState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
    await onReload();
  }

  const thumb = mediaUrl(siteUrl, selected?.key_image ?? null);
  const title =
    selected?.title && typeof selected.title === "object"
      ? selected.title.ko?.trim() || selected.title.en?.trim() || ""
      : "";
  const date = formatDotDate(selected?.published_at ?? null);
  const metaLine = ["인사이트", categoryLabel, date, selected ? "공개" : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="wa">
      <div className="grph">
        <h3>인터뷰</h3>
        <div className="grpr">
          <label className="sw">
            <input
              type="checkbox"
              checked={on}
              disabled={busy}
              onChange={(event) => void toggleShow(event.target.checked)}
            />{" "}
            이 워크에 인터뷰 표시
          </label>
          <PartialSaveBtn
            state={saveState}
            onClick={() => void savePartial()}
          />
        </div>
      </div>
      <p className="grpd">
        워크 상세 하단에 인용문과 사진이 나옵니다. 누르면 연결한 인사이트로 갑니다. 인터뷰가 없는
        워크는 꺼두면 됩니다.
      </p>

      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      <div className="box">
        <div className="f">
          <div className="fl">
            <span className="nm">연결한 인사이트</span>
            <span className="rq">*</span>
            <button type="button" className="q" onClick={() => setOpenHelp(openHelp === "ins" ? null : "ins")}>
              ?
            </button>
          </div>
          <div className="pickd">
            <div className="th">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" />
              ) : null}
            </div>
            <div className="meta">
              <div className="t1">{title}</div>
              <div className="t2">{selected ? metaLine : ""}</div>
            </div>
            <button type="button" className="btn sm" disabled={!on} onClick={() => setPicker(true)}>
              바꾸기
            </button>
          </div>
          <p className="hint-line">인사이트 아티클 중에서만 고를 수 있습니다. 직접 입력은 없습니다</p>
          <HelpPanel open={openHelp === "ins"} body={HELP.ins} onClose={() => setOpenHelp(null)} />
        </div>

        <div className="f">
          <div className="fl">
            <span className="nm">화면에 보일 인용문</span>
            <button
              type="button"
              className="q"
              onClick={() => setOpenHelp(openHelp === "quote" ? null : "quote")}
            >
              ?
            </button>
            <span className={quote.ko.length > 80 ? "cc over" : "cc"}>
              국문 {quote.ko.length} / 80
            </span>
          </div>
          <div className="two">
            <textarea
              className="i"
              rows={2}
              value={quote.ko}
              disabled={!on}
              onChange={(event) => {
                setQuote(locField(quote, "ko", event.target.value));
                markDirty();
              }}
            />
            <textarea
              className="i"
              rows={2}
              value={quote.en}
              disabled={!on}
              onChange={(event) => {
                setQuote(locField(quote, "en", event.target.value));
                markDirty();
              }}
            />
          </div>
          <p className="hint-line">비우면 인사이트의 원래 인용문이 나옵니다</p>
          <HelpPanel open={openHelp === "quote"} body={HELP.quote} onClose={() => setOpenHelp(null)} />
        </div>

        <div className="f">
          <div className="fl">
            <span className="nm">이름 · 직함</span>
            <button type="button" className="q" onClick={() => setOpenHelp(openHelp === "who" ? null : "who")}>
              ?
            </button>
          </div>
          <div className="two">
            <input
              className="i"
              type="text"
              value={attribution.ko}
              disabled={!on}
              onChange={(event) => {
                setAttribution(locField(attribution, "ko", event.target.value));
                markDirty();
              }}
            />
            <input
              className="i"
              type="text"
              value={attribution.en}
              disabled={!on}
              onChange={(event) => {
                setAttribution(locField(attribution, "en", event.target.value));
                markDirty();
              }}
            />
          </div>
          <p className="hint-line">비우면 인사이트에 적힌 이름이 나옵니다</p>
          <HelpPanel open={openHelp === "who"} body={HELP.who} onClose={() => setOpenHelp(null)} />
        </div>
      </div>

      {picker ? (
        <InsightPickModal
          siteUrl={siteUrl}
          categories={categories}
          onSelect={(item) => void pickInsight(item)}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </div>
  );
}

function HelpPanel({
  open,
  body,
  onClose
}: {
  open: boolean;
  body: { title: string; use: string; rule: string; note: string; empty: string };
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

function InsightPickModal({
  siteUrl,
  categories,
  onSelect,
  onClose
}: {
  siteUrl: string;
  categories: WebsiteCategory[];
  onSelect: (item: InsightListItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<InsightListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listInsights({ status: "published", q, limit: 50 }).then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setItems(res.data.items.filter((item) => item.status === "published"));
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function labelOf(id: string) {
    return categories.find((item) => item.id === id)?.label?.ko || id;
  }

  return (
    <div className="ov on" role="dialog" aria-label="인사이트 고르기">
      <div className="mw">
        <div className="mwh">
          <b>인사이트 고르기</b>
          <button type="button" className="xb" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="i mw-q"
          type="text"
          placeholder="제목으로 찾기"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        {error ? <p className="mb-2 text-xs text-rose-600">{error}</p> : null}
        <div className="lst">
          {items.map((item) => {
            const title =
              item.title && typeof item.title === "object"
                ? item.title.ko?.trim() || item.title.en?.trim() || item.slug
                : item.slug;
            const thumb = mediaUrl(siteUrl, item.key_image);
            const date = formatDotDate(item.published_at);
            const line = [labelOf(item.category_id), date].filter(Boolean).join(" · ");
            return (
              <button type="button" className="lrow" key={item.id} onClick={() => onSelect(item)}>
                <div className="th">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" />
                  ) : null}
                </div>
                <div>
                  <div className="t1">{title}</div>
                  <div className="t2">{line}</div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mwf">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
