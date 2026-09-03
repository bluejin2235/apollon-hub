"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addRelated,
  deleteRelated,
  getWork,
  recommendRelated,
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
import { PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import "./ui/work-admin.css";

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

const PICKER_TYPES: ContentType[] = ["work", "insight"];

const HELP = {
  title: "관련 콘텐츠",
  use: "워크 상세 맨 아래 「Related Articles」 자리. 카드 제목은 연결한 콘텐츠의 제목을 그대로 가져옵니다",
  rule: "4개. 워크 · 인사이트 · 정적 페이지를 섞어 넣을 수 있습니다",
  note: "같은 사업분야만 넣지 마세요. 인사이트를 하나 이상 섞으면 읽을거리가 생겨 체류 시간이 늘어납니다",
  empty: "상세 하단에서 갈 곳이 없어 그 페이지가 막다른 길이 됩니다"
};

type Slot = {
  id: string;
  sort: number;
  target_type: string;
  target_work_id: string | null;
  target_insight_id: string | null;
  target_page_key: string | null;
  picked_by: "human" | "luna";
};

type LunaState = "idle" | "loading" | "done" | "error";

function relatedTargetKey(item: Pick<Slot, "target_type" | "target_work_id" | "target_insight_id" | "target_page_key">): string | null {
  if (item.target_type === "work" && item.target_work_id) return `work:${item.target_work_id}`;
  if (item.target_type === "insight" && item.target_insight_id) return `insight:${item.target_insight_id}`;
  if (item.target_type === "page" && item.target_page_key) return `page:${item.target_page_key}`;
  return null;
}

function relatedTargetId(item: Slot): string {
  return item.target_work_id || item.target_insight_id || item.target_page_key || item.id;
}

function slotFromRelated(item: WorkRelated): Slot {
  return {
    id: item.id,
    sort: item.sort,
    target_type: item.target_type,
    target_work_id: item.target_work_id,
    target_insight_id: item.target_insight_id,
    target_page_key: item.target_page_key,
    picked_by: item.picked_by
  };
}

function slotsFromRelated(items: WorkRelated[] | null | undefined): Array<Slot | null> {
  const next: Array<Slot | null> = [null, null, null, null];
  for (const item of [...(items ?? [])].sort((a, b) => a.sort - b.sort)) {
    const index = item.sort >= 0 && item.sort < 4 ? item.sort : next.findIndex((slot) => slot == null);
    if (index < 0 || index > 3) continue;
    if (next[index]) {
      const empty = next.findIndex((slot) => slot == null);
      if (empty >= 0) next[empty] = slotFromRelated(item);
    } else {
      next[index] = slotFromRelated(item);
    }
  }
  return next;
}

function slotFromHit(hit: SearchHit, pickedBy: "human" | "luna", index: number, existingId?: string): Slot {
  return {
    id: existingId ?? `draft:${hit.type}:${hit.id}`,
    sort: index,
    target_type: hit.type,
    target_work_id: hit.type === "work" ? hit.id : null,
    target_insight_id: hit.type === "insight" ? hit.id : null,
    target_page_key: hit.type === "page" ? hit.id : null,
    picked_by: pickedBy
  };
}

function relatedBody(slot: Slot, sort: number) {
  if (slot.target_type === "work") {
    return { target_type: "work", target_work_id: slot.target_work_id, picked_by: slot.picked_by, sort };
  }
  if (slot.target_type === "insight") {
    return { target_type: "insight", target_insight_id: slot.target_insight_id, picked_by: slot.picked_by, sort };
  }
  return { target_type: "page", target_page_key: slot.target_page_key, picked_by: slot.picked_by, sort };
}

function slotsEqual(a: Array<Slot | null>, b: Array<Slot | null>): boolean {
  return a.every((slot, i) => {
    const other = b[i];
    if (!slot && !other) return true;
    if (!slot || !other) return false;
    return (
      relatedTargetKey(slot) === relatedTargetKey(other) &&
      slot.picked_by === other.picked_by
    );
  });
}

function HelpPanel({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <div className={open ? "qp on" : "qp"}>
      <div className="qph">
        <b>{HELP.title}</b>
        <button type="button" className="xb" onClick={onClose}>
          ×
        </button>
      </div>
      <dl>
        <dt>쓰임</dt>
        <dd>{HELP.use}</dd>
        <dt>기준</dt>
        <dd>{HELP.rule}</dd>
        <dt>주의</dt>
        <dd>{HELP.note}</dd>
        <dt>비면</dt>
        <dd>{HELP.empty}</dd>
      </dl>
    </div>
  );
}

export function WorkRelatedTab({ work, siteUrl, onReload }: Props) {
  const savedSlots = useMemo(() => slotsFromRelated(work.content_related), [work.content_related]);
  const [slots, setSlots] = useState<Array<Slot | null>>(savedSlots);
  const [hits, setHits] = useState<Map<string, SearchHit>>(new Map());
  const [picker, setPicker] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveState, setSaveState] = useState<PartialSaveState>("idle");
  const [luna, setLuna] = useState<LunaState>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = !slotsEqual(slots, savedSlots);

  useEffect(() => {
    if (dirty) return;
    setSlots(savedSlots);
  }, [savedSlots, dirty]);

  useEffect(() => {
    setSaveState((state) => {
      if (state === "saving") return state;
      if (dirty) return "dirty";
      if (state === "dirty") return "idle";
      return state;
    });
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const [works, insights, pages] = await Promise.all([
        searchContent("", "work", 50, { published: true }),
        searchContent("", "insight", 50, { published: true }),
        searchContent("", "page", 50)
      ]);
      const map = new Map<string, SearchHit>();
      for (const res of [works, insights, pages]) {
        if (!res.ok) continue;
        for (const hit of res.data ?? []) map.set(hitKey(hit), hit);
      }

      const missingWorks = (work.content_related ?? [])
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
            status: detail.status,
            year: detail.year
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

  const excludeKeys = useMemo(() => new Set<string>([`work:${work.id}`]), [work.id]);

  const selectedHits = useMemo(() => {
    const list: SearchHit[] = [];
    for (const slot of slots) {
      if (!slot) continue;
      const key = relatedTargetKey(slot);
      const hit = key ? hits.get(key) : null;
      if (hit) list.push(hit);
    }
    return list;
  }, [slots, hits]);

  const rememberHits = useCallback((items: SearchHit[]) => {
    setHits((prev) => {
      const next = new Map(prev);
      for (const hit of items) next.set(hitKey(hit), hit);
      return next;
    });
  }, []);

  async function recommend() {
    setLuna("loading");
    setError(null);
    const res = await recommendRelated(work.id);
    if (!res.ok || !res.data) {
      setLuna("error");
      return;
    }
    rememberHits(res.data.picks);
    const next: Array<Slot | null> = [null, null, null, null];
    res.data.picks.forEach((hit, i) => {
      const key = hitKey(hit);
      const existing = slots.find((slot) => slot && relatedTargetKey(slot) === key);
      next[i] = slotFromHit(hit, "luna", i, existing?.id.startsWith("draft:") ? undefined : existing?.id);
    });
    setSlots(next);
    setReason(res.data.reason);
    setLuna("done");
  }

  function applyPicked(nextHits: SearchHit[]) {
    setPicker(false);
    rememberHits(nextHits);
    const byKey = new Map(nextHits.map((hit) => [hitKey(hit), hit]));
    const next: Array<Slot | null> = slots.map((slot) => {
      if (!slot) return null;
      const key = relatedTargetKey(slot);
      return key && byKey.has(key) ? slot : null;
    });
    const kept = new Set(
      next.filter((slot): slot is Slot => Boolean(slot)).map((slot) => relatedTargetKey(slot) as string)
    );
    const incoming = nextHits.filter((hit) => !kept.has(hitKey(hit)));
    for (let i = 0; i < 4 && incoming.length > 0; i += 1) {
      if (next[i]) continue;
      const hit = incoming.shift();
      if (!hit) break;
      next[i] = slotFromHit(hit, "human", i);
    }
    setSlots(next);
  }

  function move(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to > 3) return;
    setSlots((prev) => {
      const next = [...prev];
      const tmp = next[from] ?? null;
      next[from] = next[to] ?? null;
      next[to] = tmp;
      return next.map((slot, i) => (slot ? { ...slot, sort: i } : null));
    });
  }

  function removeAt(index: number) {
    setSlots((prev) => prev.map((slot, i) => (i === index ? null : slot)));
  }

  async function save() {
    setSaveState("saving");
    setError(null);
    const saved = [...(work.content_related ?? [])];
    const filled = slots
      .map((slot, i) => (slot ? { ...slot, sort: i } : null))
      .filter((slot): slot is Slot => Boolean(slot));

    for (const row of saved) {
      const still = filled.some((slot) => slot.id === row.id);
      if (!still) {
        const res = await deleteRelated(work.id, row.id);
        if (!res.ok) {
          setError(res.error);
          setSaveState("dirty");
          return;
        }
      }
    }

    const created: Slot[] = [];
    for (const slot of filled) {
      if (slot.id && !slot.id.startsWith("draft:")) {
        created.push(slot);
        continue;
      }
      const res = await addRelated(work.id, relatedBody(slot, slot.sort));
      if (!res.ok) {
        setError(res.error);
        setSaveState("dirty");
        return;
      }
      const row = res.data as { id?: string } | undefined;
      created.push({ ...slot, id: typeof row?.id === "string" ? row.id : slot.id });
    }

    if (created.length > 0) {
      const res = await reorderRelated(
        work.id,
        created.map((slot) => ({ id: slot.id, sort: slot.sort }))
      );
      if (!res.ok) {
        setError(res.error);
        setSaveState("dirty");
        return;
      }
    }

    setSaveState("saved");
    await onReload();
  }

  return (
    <div className="wa">
      <div className="grph">
        <h3>관련 콘텐츠</h3>
        <div className="grpr">
          <button
            type="button"
            className={helpOpen ? "q on" : "q"}
            onClick={() => setHelpOpen((open) => !open)}
          >
            ?
          </button>
          <PartialSaveBtn state={saveState} onClick={() => void save()} />
        </div>
      </div>
      <p className="grpd">워크 상세 맨 아래에 이 순서대로 4개가 나옵니다.</p>
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className="rel-luna-row">
        <div className="rel-av">L</div>
        <div className="rel-luna-txt">
          {luna === "loading" ? (
            <>
              <span className="rel-spin" />
              제목 · 한 줄 요약 · 사업분야 · 태그 · 본문을 읽고 있습니다
            </>
          ) : luna === "error" ? (
            "추천을 만들지 못했습니다"
          ) : luna === "done" && reason ? (
            reason
          ) : (
            "이 워크와 어울리는 콘텐츠를 루나가 골라 줄 수 있습니다."
          )}
        </div>
        {luna === "loading" ? null : luna === "error" ? (
          <button type="button" className="btn acc" onClick={() => void recommend()}>
            다시 시도
          </button>
        ) : luna === "done" ? (
          <button type="button" className="btn" onClick={() => void recommend()}>
            다시 골라줘
          </button>
        ) : (
          <button type="button" className="btn acc" onClick={() => void recommend()}>
            루나에게 추천받기
          </button>
        )}
      </div>

      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      <div className="rel-g4">
        {slots.map((item, i) =>
          item ? (
            <RelatedCard
              key={item.id}
              item={item}
              hit={hits.get(relatedTargetKey(item) ?? "") ?? null}
              siteUrl={siteUrl}
              index={i}
              onMove={(dir) => move(i, dir)}
              onRemove={() => removeAt(i)}
            />
          ) : (
            <button
              key={`empty-${i}`}
              type="button"
              className={luna === "loading" ? "rel-empty dim" : "rel-empty"}
              disabled={luna === "loading"}
              onClick={() => setPicker(true)}
            >
              {luna === "loading" ? <span>…</span> : (
                <>
                  <span className="rel-plus">＋</span>
                  <span>직접 고르기</span>
                </>
              )}
            </button>
          )
        )}
      </div>

      <ContentPickerModal
        open={picker}
        types={PICKER_TYPES}
        includeAllTab
        publishedOnly
        confirmMode
        excludeKeys={excludeKeys}
        selectedHits={selectedHits}
        siteUrl={siteUrl}
        title="콘텐츠 고르기"
        searchPlaceholder="제목으로 찾기"
        onConfirm={applyPicked}
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
  onMove,
  onRemove
}: {
  item: Slot;
  hit: SearchHit | null;
  siteUrl: string;
  index: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const kind = KIND_LABEL[item.target_type] ?? item.target_type;
  const title = hit ? hitTitle(hit) : relatedTargetId(item);
  const src = mediaUrl(siteUrl, hit?.key_image ?? null);
  const category = hit?.category?.trim();
  return (
    <div className="rel-card">
      <div className="rel-th">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" />
        ) : null}
        {item.picked_by === "luna" ? <span className="rel-luna-mark">루나</span> : null}
        <span className="rel-ord">{index + 1}</span>
      </div>
      <div className="rel-bd">
        <div className="rel-kind">
          {kind}
          {category ? ` · ${category}` : ""}
        </div>
        <div className="rel-title">{title}</div>
        <div className="rel-acts">
          <div className="rel-lr">
            <button type="button" disabled={index <= 0} onClick={() => onMove(-1)}>
              ←
            </button>
            <button type="button" disabled={index >= 3} onClick={() => onMove(1)}>
              →
            </button>
          </div>
          <button type="button" onClick={onRemove}>
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
