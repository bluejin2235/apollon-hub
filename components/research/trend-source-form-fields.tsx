"use client";

import type { TrendCollectMethod, TrendSource, TrendSourceType } from "@/lib/research/types";

export type TrendSourceFormValues = {
  url: string;
  name: string;
  type: TrendSourceType;
  description: string;
  keywordsInput: string;
  collectCrawl: boolean;
  collectYoutube: boolean;
  collectGoogleAlerts: boolean;
  youtubeChannelId: string;
  googleAlertsQuery: string;
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
    collectCrawl: false,
    collectYoutube: false,
    collectGoogleAlerts: false,
    youtubeChannelId: "",
    googleAlertsQuery: "",
    isActive: true
  };
}

export function trendSourceToFormValues(source: TrendSource): TrendSourceFormValues {
  const methods = source.collect_methods ?? [];

  return {
    url: source.url,
    name: source.name,
    type: source.type,
    description: source.description ?? "",
    keywordsInput: source.keywords.join(", "),
    collectCrawl: methods.includes("crawl"),
    collectYoutube: methods.includes("youtube"),
    collectGoogleAlerts: methods.includes("google_alerts"),
    youtubeChannelId: source.youtube_channel_id ?? "",
    googleAlertsQuery: source.google_alerts_query ?? "",
    isActive: source.is_active
  };
}

export function sourceFormValuesToPayload(values: TrendSourceFormValues): TrendSourceFormPayload {
  const collect_methods: TrendCollectMethod[] = [];
  if (values.collectCrawl) collect_methods.push("crawl");
  if (values.collectYoutube) collect_methods.push("youtube");
  if (values.collectGoogleAlerts) collect_methods.push("google_alerts");

  return {
    url: values.url.trim(),
    name: values.name.trim(),
    type: values.type,
    description: values.description.trim(),
    keywords: parseKeywordsInput(values.keywordsInput),
    collect_methods,
    youtube_channel_id: values.collectYoutube ? values.youtubeChannelId.trim() || null : null,
    google_alerts_query: values.collectGoogleAlerts ? values.googleAlertsQuery.trim() || null : null,
    is_active: values.isActive
  };
}

type TrendSourceFormFieldsProps = {
  values: TrendSourceFormValues;
  onChange: (values: TrendSourceFormValues) => void;
  showActiveToggle?: boolean;
};

export function TrendSourceFormFields({ values, onChange, showActiveToggle = false }: TrendSourceFormFieldsProps) {
  const setField = <K extends keyof TrendSourceFormValues>(key: K, value: TrendSourceFormValues[K]) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d]">기본정보</h3>
        <div className="mt-3 space-y-3">
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
              placeholder="사이트 이름"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[#676767]">유형</span>
            <select
              value={values.type}
              onChange={(event) => setField("type", event.target.value as TrendSourceType)}
              className={INPUT_CLASS}
            >
              <option value="magazine">매거진</option>
              <option value="studio">스튜디오</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[#676767]">설명</span>
            <textarea
              value={values.description}
              onChange={(event) => setField("description", event.target.value)}
              rows={3}
              className={`${INPUT_CLASS} resize-none`}
              placeholder="수집 사이트 설명"
            />
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d]">추가 수집 방법 (준비 중)</h3>
        <p className="mt-1 text-xs text-[#8e8e8e]">기본 수집은 사이트 URL 기반 GPT 웹검색으로 진행됩니다.</p>
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.collectCrawl}
              onChange={(event) => setField("collectCrawl", event.target.checked)}
              className="h-4 w-4 rounded border-[rgba(0,0,0,0.2)]"
            />
            <span className="text-sm text-[#0d0d0d]">사이트 크롤링</span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={values.collectYoutube}
              onChange={(event) => setField("collectYoutube", event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[rgba(0,0,0,0.2)]"
            />
            <span className="flex-1">
              <span className="text-sm text-[#0d0d0d]">유튜브 채널</span>
              {values.collectYoutube ? (
                <input
                  type="text"
                  value={values.youtubeChannelId}
                  onChange={(event) => setField("youtubeChannelId", event.target.value)}
                  className={INPUT_CLASS}
                  placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
                />
              ) : null}
            </span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={values.collectGoogleAlerts}
              onChange={(event) => setField("collectGoogleAlerts", event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[rgba(0,0,0,0.2)]"
            />
            <span className="flex-1">
              <span className="text-sm text-[#0d0d0d]">Google Alerts</span>
              {values.collectGoogleAlerts ? (
                <input
                  type="text"
                  value={values.googleAlertsQuery}
                  onChange={(event) => setField("googleAlertsQuery", event.target.value)}
                  className={INPUT_CLASS}
                  placeholder="검색 쿼리"
                />
              ) : null}
            </span>
          </label>
        </div>
      </section>

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

      {showActiveToggle ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(event) => setField("isActive", event.target.checked)}
            className="h-4 w-4 rounded border-[rgba(0,0,0,0.2)]"
          />
          <span className="text-sm text-[#0d0d0d]">활성 상태</span>
        </label>
      ) : null}
    </div>
  );
}

export function isSourceFormValid(values: TrendSourceFormValues): boolean {
  if (!values.url.trim() || !values.name.trim()) return false;
  if (values.collectYoutube && !values.youtubeChannelId.trim()) return false;
  if (values.collectGoogleAlerts && !values.googleAlertsQuery.trim()) return false;
  return true;
}
