"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addInsightRelated,
  deleteInsightRelated,
  reorderInsightRelated,
  searchContent,
  type SearchHit
} from "@/lib/website/api";
import type { InsightDetail } from "@/lib/website/insight-detail";
import type { WorkRelated } from "@/lib/website/work-detail";
import { mediaUrl } from "@/lib/website/work-detail";
import {
  ContentPickerModal,
  hitKey,
  hitTitle,
  type ContentType
} from "@/components/website/content-picker-modal";
import { AiBtn, GhostBtn, GroupTitle, Guide, LunaCallout, Sep, SmallBtn } from "@/components/website/work-editor-ui";

type Props = {
  insight: InsightDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

const KIND_LABEL: Record<string, string> = {
  work: "워크",
  insight: "인사이트",
  page: "페이지"
};

const PICKER_TYPES: ContentType[] = ["work", "insight", "page"];

function relatedTargetKey(item: WorkRelated): string | null {
  if (item.target_type === "work" && item.target_work_id) return `work:${item.target_work_id}`;
  if (item.target_type === "insight" && item.target_insight_id) return `insight:${item.target_insight_id}`;
  if (item.target_type === "page" && item.target_page_key) return `page:${item.target_page_key}`;
  return null;
}

function relatedTargetId(item: WorkRelated): string {
  return item.target_work_id || item.target_insight_id || item.target_page_key || item.id;
}

function toOrder(items: WorkRelated[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, i) => ({ id: item.id, sort: i }));
}

function relatedBody(hit: SearchHit, sort: number) {
  if (hit.type === "work") {
    return { target_type: "work", target_work_id: hit.id, picked_by: "human", sort };
  }
  if (hit.type === "insight") {
    return { target_type: "insight", target_insight_id: hit.id, picked_by: "human", sort };
  }
  return { target_type: "page", target_page_key: hit.id, picked_by: "human", sort };
}

export function InsightRelatedTab({ insight, siteUrl, onReload }: Props) {
  const related = [...(insight.content_related ?? [])].sort((a, b) => a.sort - b.sort);
  const [picker, setPicker] = useState(false);
  const [hits, setHits] = useState<Map<string, SearchHit>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const full = related.length >= 4;

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [works, insights, pages] = await Promise.all([
        searchContent("", "work", 50),
        searchContent("", "insight", 50),
        searchContent("", "page", 50)
      ]);
      const map = new Map<string, SearchHit>();
      for (const res of [works, insights, pages]) {
        if (!res.ok) continue;
        for (const hit of res.data ?? []) map.set(hitKey(hit), hit);
      }
      if (!cancelled) setHits(map);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [insight.id, insight.content_related]);

  const excludeKeys = useMemo(() => {
    const keys = new Set<string>([`insight:${insight.id}`]);
    for (const item of related) {
      const key = relatedTargetKey(item);
      if (key) keys.add(key);
    }
    return keys;
  }, [related, insight.id]);

  async function pick(hit: SearchHit) {
    setPicker(false);
    setError(null);
    const res = await addInsightRelated(insight.id, relatedBody(hit, related.length));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function move(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= related.length) return;
    const res = await reorderInsightRelated(insight.id, toOrder(related, from, to));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function remove(item: WorkRelated) {
    if (!window.confirm("이 연결을 뺄까요?")) return;
    const res = await deleteInsightRelated(insight.id, item.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  const slots: Array<WorkRelated | null> = [0, 1, 2, 3].map((i) => related[i] ?? null);

  return (
    <div>
      <LunaCallout>
        워크와 같은 연결입니다. 화면에 4개까지 나옵니다.
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <AiBtn disabled>✦ 다시 골라줘</AiBtn>
          <GhostBtn disabled={full} onClick={() => setPicker(true)}>
            ＋ 직접 고르기
          </GhostBtn>
        </div>
      </LunaCallout>
      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}
      <GroupTitle note="화면에 이 순서대로 4개가 나옵니다">관련 콘텐츠</GroupTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((item, i) =>
          item ? (
            <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-[10px] text-slate-400">
                {mediaUrl(siteUrl, hits.get(relatedTargetKey(item) ?? "")?.key_image ?? null) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(siteUrl, hits.get(relatedTargetKey(item) ?? "")?.key_image ?? null) ?? ""}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  "—"
                )}
              </div>
              <div className="p-2.5">
                <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                  {KIND_LABEL[item.target_type] ?? item.target_type}
                </span>
                <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">
                  {hits.get(relatedTargetKey(item) ?? "")
                    ? hitTitle(hits.get(relatedTargetKey(item) ?? "")!)
                    : relatedTargetId(item)}
                </p>
                <div className="mt-2 flex gap-1">
                  <SmallBtn disabled={i <= 0} onClick={() => void move(i, -1)}>
                    ↑
                  </SmallBtn>
                  <SmallBtn disabled={i >= related.length - 1} onClick={() => void move(i, 1)}>
                    ↓
                  </SmallBtn>
                  <SmallBtn onClick={() => void remove(item)}>빼기</SmallBtn>
                </div>
              </div>
            </div>
          ) : (
            <button
              key={`empty-${i}`}
              type="button"
              disabled={full}
              onClick={() => setPicker(true)}
              className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 disabled:opacity-40"
            >
              ＋ 직접 고르기
            </button>
          )
        )}
      </div>
      <Guide>
        워크 · 인사이트 · 정적 페이지를 연결할 수 있습니다.
        <Sep />
        화면에는 4개가 나옵니다.
      </Guide>
      <ContentPickerModal
        open={picker}
        types={PICKER_TYPES}
        excludeKeys={excludeKeys}
        siteUrl={siteUrl}
        title="직접 고르기"
        emptyHint="먼저 등록된 콘텐츠가 있어야 합니다"
        onSelect={(hit) => void pick(hit)}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}
