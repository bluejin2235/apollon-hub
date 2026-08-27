"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addRelated,
  deleteRelated,
  getWork,
  reorderRelated,
  searchContent,
  type SearchHit
} from "@/lib/website/api";
import type { WorkDetail, WorkRelated } from "@/lib/website/work-detail";
import { mediaUrl, parseWorkDetail } from "@/lib/website/work-detail";
import {
  ContentPickerModal,
  hitKey,
  hitTitle,
  type ContentType
} from "@/components/website/content-picker-modal";
import { AiBtn, GhostBtn, GroupTitle, Guide, LunaCallout, Sep, SmallBtn } from "@/components/website/work-editor-ui";

type Props = {
  work: WorkDetail;
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

export function WorkRelatedTab({ work, siteUrl, onReload }: Props) {
  const related = [...(work.content_related ?? [])].sort((a, b) => a.sort - b.sort);
  const [picker, setPicker] = useState(false);
  const [hits, setHits] = useState<Map<string, SearchHit>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const full = related.length >= 4;

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const current = work.content_related ?? [];
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

      const missingWorks = current
        .filter((item) => item.target_type === "work" && item.target_work_id)
        .map((item) => item.target_work_id as string)
        .filter((id) => !map.has(`work:${id}`));

      await Promise.all(
        missingWorks.map(async (id) => {
          const res = await getWork(id);
          if (!res.ok) return;
          const detail = parseWorkDetail(res.data);
          if (!detail) return;
          map.set(`work:${detail.id}`, {
            type: "work",
            id: detail.id,
            title: detail.title,
            slug: detail.slug,
            key_image: detail.key_image,
            category: detail.category_id,
            status: detail.status
          });
        })
      );

      if (!cancelled) setHits(map);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [work.id, work.content_related]);

  const excludeKeys = useMemo(() => {
    const keys = new Set<string>([`work:${work.id}`]);
    for (const item of related) {
      const key = relatedTargetKey(item);
      if (key) keys.add(key);
    }
    return keys;
  }, [related, work.id]);

  async function pick(hit: SearchHit) {
    setPicker(false);
    setError(null);
    const res = await addRelated(work.id, relatedBody(hit, related.length));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function move(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= related.length) return;
    setError(null);
    const res = await reorderRelated(work.id, toOrder(related, from, to));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function remove(item: WorkRelated) {
    if (!window.confirm("이 연결을 뺄까요?")) return;
    setError(null);
    const res = await deleteRelated(work.id, item.id);
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
        본문 · 태그 · 카테고리를 읽고 <b className="font-semibold">어울리는 4개를 골라 넣어 뒀습니다.</b> 그대로
        두셔도 되고, 마음에 안 드는 것은 빼고 직접 넣으셔도 됩니다.
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <AiBtn disabled>✦ 다시 골라줘</AiBtn>
          <GhostBtn disabled={full} onClick={() => setPicker(true)}>
            ＋ 직접 고르기
          </GhostBtn>
          {full ? <span className="text-xs text-slate-500">화면에는 4개까지 나옵니다</span> : null}
        </div>
      </LunaCallout>

      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      <GroupTitle note="화면에 이 순서대로 4개가 나옵니다">관련 콘텐츠</GroupTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((item, i) =>
          item ? (
            <RelatedCard
              key={item.id}
              item={item}
              hit={hits.get(relatedTargetKey(item) ?? "") ?? null}
              siteUrl={siteUrl}
              index={i}
              total={related.length}
              onMove={(dir) => void move(i, dir)}
              onRemove={() => void remove(item)}
            />
          ) : (
            <EmptyCard key={`empty-${i}`} disabled={full} onClick={() => setPicker(true)} />
          )
        )}
      </div>
      <Guide>
        워크 · 인사이트 · 정적 페이지 모두 연결할 수 있습니다.{" "}
        <b className="font-semibold text-slate-600">화면에는 4개가 나옵니다</b>
        <Sep />
        카드 제목은 연결된 콘텐츠의 제목을 그대로 가져옵니다.{" "}
        <b className="font-semibold text-slate-600">국문 12자 · 영문 14자</b>가 한 줄이고 두 줄까지 보입니다. 그보다
        길면 잘립니다.
        <br />
        같은 카테고리만 넣지 말고 <b className="font-semibold text-slate-600">인사이트를 한 개 이상</b> 섞으세요.
        읽을거리가 있어야 체류시간이 늘어납니다.
        <br />
        하나를 빼면 그 자리에 <b className="font-semibold text-slate-600">루나가 다음 후보를 자동으로 채워 넣습니다.</b>{" "}
        빈칸으로 두려면 「빈칸 유지」를 누르세요.
      </Guide>

      <ContentPickerModal
        open={picker}
        types={PICKER_TYPES}
        excludeKeys={excludeKeys}
        siteUrl={siteUrl}
        title="직접 고르기"
        emptyHint="인사이트를 먼저 등록해야 합니다"
        onSelect={(hit) => void pick(hit)}
        onClose={() => setPicker(false)}
      />
    </div>
  );
}

function RelatedCard({
  item,
  hit,
  siteUrl,
  index,
  total,
  onMove,
  onRemove
}: {
  item: WorkRelated;
  hit: SearchHit | null;
  siteUrl: string;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const kind = KIND_LABEL[item.target_type] ?? item.target_type;
  const title = hit ? hitTitle(hit) : relatedTargetId(item);
  const src = mediaUrl(siteUrl, hit?.key_image ?? null);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100 text-[10px] text-slate-400">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          "—"
        )}
      </div>
      <div className="p-2.5">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
            item.target_type === "insight"
              ? "bg-apollon-50 text-apollon-700"
              : item.target_type === "page"
                ? "bg-slate-100 text-slate-600"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {kind}
        </span>
        <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">{title}</p>
        <div className="mt-2 flex gap-1">
          <SmallBtn disabled={index <= 0} onClick={() => onMove(-1)}>
            ↑
          </SmallBtn>
          <SmallBtn disabled={index >= total - 1} onClick={() => onMove(1)}>
            ↓
          </SmallBtn>
          <SmallBtn onClick={onRemove}>빼기</SmallBtn>
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      ＋ 직접 고르기
    </button>
  );
}
