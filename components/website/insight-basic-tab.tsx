"use client";

import { useEffect, useState } from "react";
import { ImageUploader } from "@/components/website/image-uploader";
import { TagPicker } from "@/components/website/tag-picker";
import { Field } from "@/components/website/ui";
import { locField } from "@/components/website/work-editor-ui";
import { setInsightTags } from "@/lib/website/api";
import type { InsightBasicDraft, InsightDetail, PressKind } from "@/lib/website/insight-detail";
import { defaultPressKind, pressKindFromDraft } from "@/lib/website/insight-detail";
import { workFolderPrefix } from "@/lib/website/upload-path";
import {
  INSIGHT_TITLE_EN_MAX,
  INSIGHT_TITLE_KO_MAX,
  textWidth
} from "@/lib/website/text-width";
import type { WebsiteCategory } from "@/lib/website/types";
import "./ui/work-admin.css";

type Props = {
  draft: InsightBasicDraft;
  onChange: (patch: Partial<InsightBasicDraft>) => void;
  insight: InsightDetail;
  categories: WebsiteCategory[];
  siteUrl: string;
  onReload: () => Promise<void>;
};

const CAT_CHIP: Record<string, string> = {
  "behind-the-work": "bg-[#eef0fb] text-[#4b5bb5]",
  interview: "bg-[#eef4fb] text-[#2563a8]",
  news: "bg-[#f3eefb] text-[#7c3aed]",
  culture: "bg-[#fdf3ee] text-[#a35a08]",
  lab: "bg-[#eaf5f0] text-[#0f7a45]"
};

function isPlaceholderKey(src: string) {
  return !src.trim() || /placeholder-wide/i.test(src);
}

function Bi({
  ko,
  en,
  onKo,
  onEn,
  multiline
}: {
  ko: string;
  en: string;
  onKo: (v: string) => void;
  onEn: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="two">
      {multiline ? (
        <textarea className="i" value={ko} onChange={(e) => onKo(e.target.value)} />
      ) : (
        <input className="i" value={ko} onChange={(e) => onKo(e.target.value)} />
      )}
      <div className="enw">
        {multiline ? (
          <textarea className="i" value={en} onChange={(e) => onEn(e.target.value)} />
        ) : (
          <input className="i" value={en} onChange={(e) => onEn(e.target.value)} />
        )}
      </div>
    </div>
  );
}

export function InsightBasicTab({ draft, onChange, insight, categories, siteUrl, onReload }: Props) {
  const uploadRoot = workFolderPrefix(draft.slug || insight.slug, insight.id);
  const keyFilled = !isPlaceholderKey(draft.key_image);
  const tags = [...(insight.insight_tags ?? [])].sort((a, b) => a.sort - b.sort);
  const [pressKind, setPressKind] = useState<PressKind>(() => pressKindFromDraft(draft, draft.category_id));

  useEffect(() => {
    if (draft.press_outlet.trim() || draft.press_person.trim()) return;
    setPressKind(defaultPressKind(draft.category_id));
  }, [draft.category_id, draft.press_outlet, draft.press_person]);

  function applyPressKind(next: PressKind) {
    setPressKind(next);
    if (next === "none") {
      onChange({ press_outlet: "", press_person: "", press_role: "", press_href: "" });
    } else if (next === "press") {
      onChange({ press_person: "", press_role: "" });
    } else {
      onChange({ press_outlet: "" });
    }
  }

  return (
    <div className="wa space-y-5">
      <Field label="카테고리" required>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = draft.category_id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange({ category_id: c.id })}
                className={`rounded-[7px] border px-[11px] py-2 text-xs ${
                  on ? "border-apollon-500 bg-[#f2f0fc] font-semibold text-apollon-700" : "border-[#dde1e6] bg-white text-slate-700"
                }`}
              >
                <span className={`mr-1.5 rounded-[3px] px-1.5 py-0.5 text-[10px] font-bold ${CAT_CHIP[c.id] ?? ""}`}>
                  {c.label?.ko || c.id}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="제목"
        required
        counts={[
          { label: "국문", value: textWidth(draft.title.ko), limit: INSIGHT_TITLE_KO_MAX },
          { label: "영문", value: textWidth(draft.title.en), limit: INSIGHT_TITLE_EN_MAX }
        ]}
        tip="목록 카드 · 상세 · 검색 결과 · 링크 공유에 모두 쓰입니다."
      >
        <Bi
          ko={draft.title.ko}
          en={draft.title.en}
          onKo={(v) => onChange({ title: locField(draft.title, "ko", v) })}
          onEn={(v) => onChange({ title: locField(draft.title, "en", v) })}
        />
      </Field>

      <Field
        label="부제"
        counts={[{ label: "국문", value: draft.subtitle.ko.length, limit: 90 }]}
        tip="제목 아래 큰 글씨로 나옵니다. 리드 역할입니다."
      >
        <Bi
          ko={draft.subtitle.ko}
          en={draft.subtitle.en}
          multiline
          onKo={(v) => onChange({ subtitle: locField(draft.subtitle, "ko", v) })}
          onEn={(v) => onChange({ subtitle: locField(draft.subtitle, "en", v) })}
        />
      </Field>

      <Field
        label="한 줄 요약"
        required
        counts={[
          { label: "국문", value: draft.summary.ko.length, recommend: 60, limit: 80 },
          { label: "영문", value: draft.summary.en.length, limit: 155 }
        ]}
        tip="목록 카드 · 구글 검색 결과 설명 · AI 인용에 쓰입니다."
      >
        <Bi
          ko={draft.summary.ko}
          en={draft.summary.en}
          multiline
          onKo={(v) => onChange({ summary: locField(draft.summary, "ko", v) })}
          onEn={(v) => onChange({ summary: locField(draft.summary, "en", v) })}
        />
      </Field>

      <Field label="검색 설명" counts={[{ label: "국문", value: draft.search_description.ko.length, limit: 155 }]}>
        <Bi
          ko={draft.search_description.ko}
          en={draft.search_description.en}
          multiline
          onKo={(v) => onChange({ search_description: locField(draft.search_description, "ko", v) })}
          onEn={(v) => onChange({ search_description: locField(draft.search_description, "en", v) })}
        />
      </Field>

      <Field label="대표 이미지" required tip="올린 비율대로 목록 카드가 만들어집니다. 메인 페이지에 나올 때는 16:9 로 잘립니다.">
        <ImageUploader
          bucket="insights"
          folder={`${uploadRoot}/key`}
          accept="image"
          multiple={false}
          kind="insight-key"
          appearance="filecard"
          siteUrl={siteUrl}
          value={keyFilled ? draft.key_image : null}
          emptyHint="긴 변 1600 이상이어야 합니다."
          onUploaded={(files) => {
            const first = files[0];
            if (first) {
              onChange({
                key_image: first.src,
                key_image_width: first.width,
                key_image_height: first.height
              });
            }
          }}
          onClear={() => onChange({ key_image: "", key_image_width: null, key_image_height: null })}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          <b className="text-amber-700">비율이 자유입니다.</b> 올린 비율 그대로 목록 카드가 만들어집니다.
          세로 사진이면 카드가 길어집니다. 긴 변 1600 이상이어야 합니다.
          <br />
          <b className="text-amber-700">메인 페이지에 나올 때는 16:9 로 잘립니다.</b>
        </p>
      </Field>

      <Field
        label="대체 텍스트"
        required
        counts={[{ label: "국문", value: draft.key_image_alt.ko.length, limit: 40 }]}
      >
        <Bi
          ko={draft.key_image_alt.ko}
          en={draft.key_image_alt.en}
          onKo={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "ko", v) })}
          onEn={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "en", v) })}
        />
      </Field>

      <Field
        label="출처 줄"
        tip={
          <>
            제목 아래에 <b>「Press 헤럴드경제 · 원문보기」</b> 로 나옵니다.
            <br />
            「인물」을 고르면 <b>「김지현 - 크리에이티브 디렉터」</b> 형태가 됩니다.
          </>
        }
      >
        <div className="mb-2 flex flex-wrap gap-2">
          {(
            [
              ["none", "없음"],
              ["press", "언론 보도"],
              ["person", "인물"]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPressKind(id)}
              className={`rounded-[7px] border px-3 py-2 text-xs ${
                pressKind === id ? "border-apollon-500 bg-[#f2f0fc] font-semibold" : "border-[#dde1e6] bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {pressKind === "press" ? (
          <div className="two">
            <div>
              <p className="mb-1 text-[11.5px] text-slate-500">매체명</p>
              <input className="i" value={draft.press_outlet} onChange={(e) => onChange({ press_outlet: e.target.value })} />
            </div>
            <div>
              <p className="mb-1 text-[11.5px] text-slate-500">원문 링크</p>
              <input className="i" value={draft.press_href} onChange={(e) => onChange({ press_href: e.target.value })} />
            </div>
          </div>
        ) : null}
        {pressKind === "person" ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <p className="mb-1 text-[11.5px] text-slate-500">이름</p>
              <input className="i" value={draft.press_person} onChange={(e) => onChange({ press_person: e.target.value })} />
            </div>
            <div>
              <p className="mb-1 text-[11.5px] text-slate-500">직함</p>
              <input className="i" value={draft.press_role} onChange={(e) => onChange({ press_role: e.target.value })} />
            </div>
            <div>
              <p className="mb-1 text-[11.5px] text-slate-500">링크</p>
              <input className="i" value={draft.press_href} onChange={(e) => onChange({ press_href: e.target.value })} />
            </div>
          </div>
        ) : null}
      </Field>

      <div className="two">
        <Field label="연도">
          <input className="i" value={draft.year} onChange={(e) => onChange({ year: e.target.value })} />
        </Field>
        <Field label="공개일">
          <input
            className="i"
            type="date"
            value={draft.published_at}
            onChange={(e) => onChange({ published_at: e.target.value })}
          />
        </Field>
      </div>

      <Field label="태그" aside={`${tags.length}개`} tip="워크와 같은 태그를 씁니다. 3~6개 · 태그당 2~10자.">
        <TagPicker
          workId={insight.id}
          selectedIds={tags.map((t) => t.tag_id)}
          onReload={onReload}
          saveTags={setInsightTags}
        />
      </Field>
    </div>
  );
}
