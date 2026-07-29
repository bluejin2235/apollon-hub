"use client";

import type { TrendCollectMethod, TrendSource, TrendSourceType } from "@/lib/research/types";

export type TrendSourceFormValues = {
  url: string;
  name: string;
  type: TrendSourceType;
  description: string;
  keywordsInput: string;
  isActive: boolean;
};

export type TrendSourceFormPayload = {
  url: string;
  name: string;
  type: TrendSourceType;
  description: string;
  keywords: string[];
  collect_methods: TrendCollectMethod[];
  youtube_channel_id: string | null;
  google_alerts_query: string | null;
  is_active?: boolean;
};

const INPUT_CLASS =
  "mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2.5 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none";

const TYPE_OPTIONS: { value: TrendSourceType; label: string }[] = [
  { value: "magazine", label: "매거진" },
  { value: "studio", label: "스튜디오" }
];

function IconInfo(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 9h.01" />
      <path d="M11 12h1v4h1" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
    </svg>
  );
}

function SourceTypeInfoBox({ type }: { type: TrendSourceType }) {
  const text =
    type === "magazine"
      ? "사이트 내에서 설정한 기간 동안 발행된 글만 검색해요."
      : "스튜디오명과 키워드로 웹 전체에서 최근 뉴스, 수상, 인터뷰를 찾아요.";

  return (
    <div className="flex gap-2.5 rounded-xl bg-[#534AB7]/5 px-3 py-2.5">
      <IconInfo className="mt-0.5 h-4 w-4 shrink-0 text-[#534AB7]" />
      <p className="text-xs leading-relaxed text-[#534AB7]">{text}</p>
    </div>
  );
}

export function parseKeywordsInput(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createEmptySourceFormValues(): TrendSourceFormValues {
  return {
    url: "",
    name: "",
    type: "magazine",
    description: "",
    keywordsInput: "",
    isActive: true
  };
}

export function trendSourceToFormValues(source: TrendSource): TrendSourceFormValues {
  return {
    url: source.url,
    name: source.name,
    type: source.type,
    description: source.description ?? "",
    keywordsInput: source.keywords.join(", "),
    isActive: source.is_active
  };
}

export function sourceFormValuesToPayload(
  values: TrendSourceFormValues,
  existing?: TrendSource
): TrendSourceFormPayload {
  return {
    url: values.url.trim(),
    name: values.name.trim(),
    type: values.type,
    description: values.description.trim(),
    keywords: parseKeywordsInput(values.keywordsInput),
    collect_methods: existing?.collect_methods ?? [],
    youtube_channel_id: existing?.youtube_channel_id ?? null,
    google_alerts_query: existing?.google_alerts_query ?? null,
    is_active: values.isActive
  };
}

type TrendSourceFormFieldsProps = {
  values: TrendSourceFormValues;
  onChange: (values: TrendSourceFormValues) => void;
  showActiveToggle?: boolean;
};

export function TrendSourceFormFields({ values, onChange, showActiveToggle = true }: TrendSourceFormFieldsProps) {
  const setField = <K extends keyof TrendSourceFormValues>(key: K, value: TrendSourceFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-5">
      <section>
        <span className="text-xs font-medium text-[#676767]">유형</span>
        <div className="mt-2 flex gap-2">
          {TYPE_OPTIONS.map((option) => {
            const selected = values.type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setField("type", option.value)}
                className={`flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                    : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <SourceTypeInfoBox type={values.type} />
        </div>
      </section>

      <section className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-[#676767]">사이트 URL</span>
          <input
            type="url"
            value={values.url}
            onChange={(event) => setField("url", event.target.value)}
            className={INPUT_CLASS}
            placeholder="https://example.com"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[#676767]">이름</span>
          <input
            type="text"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            className={INPUT_CLASS}
            placeholder="채널 이름"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[#676767]">설명</span>
          <textarea
            value={values.description}
            onChange={(event) => setField("description", event.target.value)}
            rows={3}
            className={`${INPUT_CLASS} resize-none`}
            placeholder="채널 설명"
          />
        </label>

        {showActiveToggle ? (
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(event) => setField("isActive", event.target.checked)}
              className="h-4 w-4 rounded border-[rgba(0,0,0,0.2)]"
            />
            <span className="text-sm text-[#0d0d0d]">활성 상태</span>
          </label>
        ) : null}
      </section>

      <hr className="border-[rgba(0,0,0,0.08)]" />

      {values.type === "magazine" ? (
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d]">수집 키워드</h3>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-[#676767]">키워드 (콤마 구분)</span>
            <input
              type="text"
              value={values.keywordsInput}
              onChange={(event) => setField("keywordsInput", event.target.value)}
              className={INPUT_CLASS}
              placeholder="키워드1, 키워드2"
            />
          </label>
        </section>
      ) : (
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d]">웹검색 키워드</h3>
          <p className="mt-1 text-xs text-[#8e8e8e]">
            스튜디오명에 추가로 결합해서 검색할 키워드예요 (예: new project, exhibition, award)
          </p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-[#676767]">키워드 (콤마 구분)</span>
            <input
              type="text"
              value={values.keywordsInput}
              onChange={(event) => setField("keywordsInput", event.target.value)}
              className={INPUT_CLASS}
              placeholder="new project, exhibition, award"
            />
          </label>
        </section>
      )}
    </div>
  );
}

export function isSourceFormValid(values: TrendSourceFormValues): boolean {
  return Boolean(values.url.trim() && values.name.trim());
}
