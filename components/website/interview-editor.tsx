"use client";

import { useEffect, useRef, useState } from "react";
import { clearInterview, searchContent, setInterview, type SearchHit } from "@/lib/website/api";
import type { Loc, WorkInterview } from "@/lib/website/work-detail";
import { asLoc, mediaUrl } from "@/lib/website/work-detail";
import {
  ContentPickerModal,
  hitTitle,
  type ContentType
} from "@/components/website/content-picker-modal";
import {
  BilingualField,
  CharKo,
  FieldLabel,
  Guide,
  locField,
  Req,
  Sep,
  SmallBtn
} from "@/components/website/work-editor-ui";

const INSIGHT_TYPES: ContentType[] = ["insight"];

type Props = {
  workId: string;
  sectionId: string;
  interview: WorkInterview | null;
  siteUrl: string;
  onReload: () => Promise<void>;
};

export function InterviewEditor({ workId, sectionId, interview, siteUrl, onReload }: Props) {
  const [picker, setPicker] = useState(false);
  const [hit, setHit] = useState<SearchHit | null>(null);
  const [hasInsights, setHasInsights] = useState<boolean | null>(null);
  const [quote, setQuote] = useState<Loc>(asLoc(interview?.quote_override));
  const [attribution, setAttribution] = useState<Loc>(asLoc(interview?.attribution_override));
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const quoteRef = useRef(quote);
  const attributionRef = useRef(attribution);
  quoteRef.current = quote;
  attributionRef.current = attribution;

  useEffect(() => {
    setQuote(asLoc(interview?.quote_override));
    setAttribution(asLoc(interview?.attribution_override));
  }, [interview]);

  useEffect(() => {
    let cancelled = false;
    void searchContent("", "insight", 1).then((res) => {
      if (cancelled) return;
      setHasInsights(res.ok && (res.data?.length ?? 0) > 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!interview?.insight_id) {
      setHit(null);
      return;
    }
    let cancelled = false;
    void searchContent("", "insight", 50).then((res) => {
      if (cancelled || !res.ok) return;
      const found = (res.data ?? []).find((item) => item.id === interview.insight_id) ?? null;
      setHit(found);
    });
    return () => {
      cancelled = true;
    };
  }, [interview?.insight_id]);

  async function persist(patch: {
    insight_id: string;
    quote_override?: Loc;
    attribution_override?: Loc;
  }) {
    setSave("saving");
    setError(null);
    try {
      const res = await setInterview(workId, {
        section_id: sectionId,
        insight_id: patch.insight_id,
        quote_override: patch.quote_override ?? quoteRef.current,
        attribution_override: patch.attribution_override ?? attributionRef.current
      });
      if (!res.ok) {
        setSave("idle");
        setError(res.error);
        return;
      }
      setSave("saved");
      window.setTimeout(() => setSave((cur) => (cur === "saved" ? "idle" : cur)), 1200);
    } finally {
      setSave((cur) => (cur === "saving" ? "idle" : cur));
    }
  }

  async function pick(next: SearchHit) {
    setPicker(false);
    await persist({ insight_id: next.id });
    await onReload();
  }

  async function unlink() {
    if (!window.confirm("인터뷰 연결을 해제할까요?")) return;
    setError(null);
    const res = await clearInterview(workId);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  const emptyCatalog = hasInsights === false;
  const src = mediaUrl(siteUrl, hit?.key_image ?? null);
  const label = hit ? hitTitle(hit) : interview?.insight_id ?? "";

  return (
    <div className="space-y-3">
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      <div>
        <FieldLabel>
          연결할 인사이트
          <Req />
          {save === "saving" ? <span className="ml-2 font-normal text-slate-400">저장 중</span> : null}
          {save === "saved" ? <span className="ml-2 font-normal text-emerald-600">저장됨</span> : null}
        </FieldLabel>
        {emptyCatalog && !interview ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            인사이트를 먼저 등록해야 합니다
          </div>
        ) : interview ? (
          <div className="max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-[10px] text-slate-400">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="h-full w-full object-cover" />
              ) : (
                "16:9"
              )}
            </div>
            <div className="p-2.5">
              <span className="inline-block rounded bg-apollon-50 px-1.5 py-0.5 text-[10px] font-bold text-apollon-700">
                인사이트
              </span>
              <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">{label}</p>
              <div className="mt-2 flex gap-1">
                <SmallBtn disabled={emptyCatalog} onClick={() => setPicker(true)}>
                  바꾸기
                </SmallBtn>
                <SmallBtn onClick={() => void unlink()}>해제</SmallBtn>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={emptyCatalog}
            onClick={() => setPicker(true)}
            className="flex w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-slate-300 px-3 py-8 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ＋ 인사이트에서 고르기
          </button>
        )}
        <Guide>
          인터뷰는 별도 데이터가 아니라 <b className="font-semibold text-slate-600">인사이트에 등록된 글 하나</b>를
          연결하는 블록입니다. 화면에서 [Learn more]를 누르면 <b className="font-semibold text-slate-600">팝업</b>으로
          열리고, 팝업 안 「원문보기」로 인사이트 페이지로 이동합니다.
        </Guide>
      </div>
      <div>
        <FieldLabel extra={<CharKo n={quote.ko.length} warn={70} limit={70} />}>
          화면에 보일 인용문
          <Req />
        </FieldLabel>
        <BilingualField
          ko={quote.ko}
          en={quote.en}
          readOnly={!interview}
          multiline
          onKo={(v) => setQuote(locField(quote, "ko", v))}
          onEn={(v) => setQuote(locField(quote, "en", v))}
          onBlur={() => {
            if (interview) {
              void persist({ insight_id: interview.insight_id, quote_override: quoteRef.current });
            }
          }}
        />
        <Guide>
          <b className="font-semibold text-slate-600">국문 40~70자</b> ·{" "}
          <b className="font-semibold text-slate-600">세 줄까지</b>
          <Sep />
          팝업을 열기 전 카드에 크게 보이는 문장입니다. 70자를 넘으면 네 줄이 되어 카드가 흐트러집니다.
          <br />
          인사이트 본문에서 <b className="font-semibold text-slate-600">가장 강한 한 문장</b>을 골라 넣으세요.
        </Guide>
      </div>
      <div>
        <FieldLabel extra={<CharKo n={attribution.ko.length} warn={24} limit={24} />}>
          이름 · 직함
          <Req />
        </FieldLabel>
        <BilingualField
          ko={attribution.ko}
          en={attribution.en}
          readOnly={!interview}
          onKo={(v) => setAttribution(locField(attribution, "ko", v))}
          onEn={(v) => setAttribution(locField(attribution, "en", v))}
          onBlur={() => {
            if (interview) {
              void persist({
                insight_id: interview.insight_id,
                attribution_override: attributionRef.current
              });
            }
          }}
        />
        <Guide>
          <b className="font-semibold text-slate-600">국문 24자 이내</b> · 형식은{" "}
          <b className="font-semibold text-slate-600">이름 - 직함</b>
          <Sep />
          프로필 이미지는 정사각형 <b className="font-semibold text-slate-600">600 × 600</b> · JPG · 300KB 이하
        </Guide>
      </div>
      <ContentPickerModal
        open={picker}
        types={INSIGHT_TYPES}
        excludeKeys={new Set()}
        siteUrl={siteUrl}
        title="인사이트에서 고르기"
        emptyHint="인사이트를 먼저 등록해야 합니다"
        onSelect={(next) => void pick(next)}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}
