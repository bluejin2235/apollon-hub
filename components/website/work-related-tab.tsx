"use client";

import type { WorkDetail, WorkRelated } from "@/lib/website/work-detail";
import { AiBtn, GhostBtn, GroupTitle, Guide, LunaCallout, Sep, SmallBtn } from "@/components/website/work-editor-ui";

type Props = {
  work: WorkDetail;
};

const KIND_LABEL: Record<string, string> = {
  work: "워크",
  insight: "인사이트",
  page: "페이지"
};

export function WorkRelatedTab({ work }: Props) {
  const related = [...(work.content_related ?? [])].sort((a, b) => a.sort - b.sort);
  const slots: Array<WorkRelated | null> = [0, 1, 2, 3].map((i) => related[i] ?? null);

  return (
    <div>
      <LunaCallout>
        본문 · 태그 · 카테고리를 읽고 <b className="font-semibold">어울리는 4개를 골라 넣어 뒀습니다.</b> 그대로
        두셔도 되고, 마음에 안 드는 것은 빼고 직접 넣으셔도 됩니다.
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AiBtn disabled>✦ 다시 골라줘</AiBtn>
          <GhostBtn disabled>＋ 직접 고르기</GhostBtn>
        </div>
      </LunaCallout>

      <GroupTitle note="화면에 이 순서대로 4개가 나옵니다">관련 콘텐츠</GroupTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((item, i) =>
          item ? <RelatedCard key={item.id} item={item} /> : <EmptyCard key={`empty-${i}`} />
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
    </div>
  );
}

function relatedTitle(item: WorkRelated): string {
  if (item.target_type === "page") return item.target_page_key || "페이지";
  if (item.target_type === "insight") return item.target_insight_id || "인사이트";
  return item.target_work_id || "워크";
}

function RelatedCard({ item }: { item: WorkRelated }) {
  const kind = KIND_LABEL[item.target_type] ?? item.target_type;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex aspect-video items-center justify-center bg-slate-100 text-[10px] text-slate-400">
        16:9
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
        <p className="mt-1.5 line-clamp-2 text-sm font-semibold text-slate-800">{relatedTitle(item)}</p>
        <div className="mt-2 flex gap-1">
          <SmallBtn disabled>↑</SmallBtn>
          <SmallBtn disabled>↓</SmallBtn>
          <SmallBtn disabled>빼기</SmallBtn>
        </div>
      </div>
    </div>
  );
}

function EmptyCard() {
  return (
    <button
      type="button"
      disabled
      className="flex aspect-[3/4] items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      ＋ 직접 고르기
    </button>
  );
}
