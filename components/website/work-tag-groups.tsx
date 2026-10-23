"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTag,
  getTags,
  setWorkTags,
  type WebsiteTagGroup,
  type WebsiteTagItem
} from "@/lib/website/api";

const TAG_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIND_OVER = 9;

type WorkGroup = Exclude<WebsiteTagGroup, "insight">;

const GROUPS: { key: WorkGroup; no: number; name: string; sub: string }[] = [
  { key: "venue", no: 1, name: "공간·시설", sub: "어디에 설치했나 — 리조트 · 호텔 · 오피스 · 리테일" },
  { key: "technique", no: 2, name: "경험·구현", sub: "어떻게 보여주나 — 미디어 쇼 · 프로젝션 매핑 · LED" },
  { key: "etc", no: 3, name: "그 외", sub: "환경 · 클라이언트 시리즈 · 수상" }
];

const GROUP_NAME: Record<string, string> = {
  venue: "공간·시설",
  technique: "경험·구현",
  etc: "그 외",
  insight: "인사이트"
};

function isWorkGroup(group: WebsiteTagItem["tag_group"]): group is WorkGroup {
  return group === "venue" || group === "technique" || group === "etc";
}

function tagName(tag: WebsiteTagItem) {
  return tag.label?.en?.trim() || tag.label?.ko?.trim() || tag.id;
}

/** 같은 이름 판정용 — 대소문자 · 띄어쓰기 무시 */
function exactKey(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function wordsKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function tidy(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function lev(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function isExact(tag: WebsiteTagItem, typed: string) {
  const key = exactKey(typed);
  return [tag.label?.ko, tag.label?.en].some((name) => name && exactKey(name) === key);
}

/** 포함 · 단어 겹침 · 철자 거리 2 이내. 모든 그룹에서 찾고 정확히 같은 것이 맨 앞 */
function similarTags(all: WebsiteTagItem[], typed: string) {
  const q = wordsKey(typed);
  if (!q) return [];
  const words = q.split(" ").filter((word) => word.length > 2);
  return all
    .filter((tag) => {
      const t = wordsKey(tagName(tag));
      return (
        isExact(tag, typed) ||
        t.includes(q) ||
        q.includes(t) ||
        words.some((word) => t.includes(word)) ||
        lev(t, q) <= 2
      );
    })
    .sort((a, b) => Number(isExact(b, typed)) - Number(isExact(a, typed)))
    .slice(0, 6);
}

function uniqueTagId(tags: WebsiteTagItem[], typed: string) {
  const taken = new Set(tags.map((tag) => tag.id));
  const ascii = typed
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = ascii && TAG_ID_RE.test(ascii) ? ascii : `tag-${Date.now().toString(36)}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

type Props = {
  workId: string;
  selectedIds: string[];
  onReload: () => Promise<void>;
  /** 「태그 ?」 — 개수는 이 줄 오른쪽에 붙는다 */
  label: ReactNode;
};

export function WorkTagGroups({ workId, selectedIds, onReload, label }: Props) {
  const [all, setAll] = useState<WebsiteTagItem[]>([]);
  const [newly, setNewly] = useState<Set<string>>(() => new Set());
  const [find, setFind] = useState<Record<string, string>>({});
  const [making, setMaking] = useState<WorkGroup | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTags().then((res) => {
      if (res.ok) setAll(res.data.items ?? []);
    });
  }, []);

  const byId = useMemo(() => new Map(all.map((tag) => [tag.id, tag])), [all]);

  const byGroup = useMemo(() => {
    const out: Record<WorkGroup, WebsiteTagItem[]> = { venue: [], technique: [], etc: [] };
    for (const tag of all) {
      if (isWorkGroup(tag.tag_group)) out[tag.tag_group].push(tag);
    }
    for (const list of Object.values(out)) {
      list.sort((a, b) => (b.works ?? 0) - (a.works ?? 0) || tagName(a).localeCompare(tagName(b)));
    }
    return out;
  }, [all]);

  const groupedCount = selectedIds.filter((id) => isWorkGroup(byId.get(id)?.tag_group)).length;
  // 목록을 아직 못 받았으면 정리 필요 줄을 비워 둔다
  const loose = all.length
    ? selectedIds.filter((id) => !isWorkGroup(byId.get(id)?.tag_group))
    : [];

  const sims = useMemo(() => similarTags(all, typed), [all, typed]);
  const exact = sims.find((tag) => isExact(tag, typed));

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await setWorkTags(workId, next);
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      await onReload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    if (busy) return;
    void save(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  function closeMaker() {
    setMaking(null);
    setTyped("");
  }

  function pickSimilar(tag: WebsiteTagItem) {
    if (busy || !isWorkGroup(tag.tag_group)) return;
    closeMaker();
    if (!selectedIds.includes(tag.id)) void save([...selectedIds, tag.id]);
  }

  async function create(group: WorkGroup) {
    const text = tidy(typed);
    if (busy || !text || exact) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTag(uniqueTagId(all, text), { ko: text, en: text }, group);
      if (!created.ok) {
        const dupId =
          created.status === 409 && created.details && typeof created.details === "object"
            ? (created.details as { id?: unknown }).id
            : undefined;
        setError(
          typeof dupId === "string" ? `이미 있는 태그입니다 (${dupId}). 위 목록에서 고르세요` : created.error
        );
        const fresh = await getTags();
        if (fresh.ok) setAll(fresh.data.items ?? []);
        return;
      }
      const tag = { ...created.data, works: 0 };
      setAll((prev) => [...prev, tag]);
      setNewly((prev) => new Set(prev).add(tag.id));
      closeMaker();
      const res = await setWorkTags(workId, [...selectedIds, tag.id]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  const countState = groupedCount > 6 ? " warn" : groupedCount >= 3 ? " ok" : "";

  return (
    <div className="wtg">
      <div className="fl">
        {label}
        <span className={`cc wtg-count${countState}`}>
          선택 <b>{groupedCount}</b>개 · 3~6개 권장{groupedCount > 6 ? " — 많아요" : ""}
        </span>
      </div>

      <div className="wtg-grid">
        {GROUPS.map((group) => {
          const list = byGroup[group.key];
          const q = wordsKey(find[group.key] ?? "");
          const open = making === group.key;
          return (
            <div key={group.key} className="wtg-grp">
              <div className="wtg-grp-h">
                <span className="wtg-no">{group.no}</span>
                <b>{group.name}</b>
              </div>
              <div className="wtg-sub">{group.sub}</div>
              {list.length > FIND_OVER ? (
                <input
                  className="wtg-find"
                  placeholder="찾기"
                  value={find[group.key] ?? ""}
                  onChange={(e) => setFind((prev) => ({ ...prev, [group.key]: e.target.value }))}
                />
              ) : null}
              <div className="wtg-pal">
                {list
                  .filter((tag) => !q || wordsKey(tagName(tag)).includes(q))
                  .map((tag) => {
                    const on = selectedIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`wtg-pc${on ? " on" : ""}${newly.has(tag.id) ? " newbie" : ""}`}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => toggle(tag.id)}
                      >
                        {tagName(tag)}
                        <span className="n">{tag.works ?? 0}</span>
                      </button>
                    );
                  })}
              </div>
              {open ? (
                <div className="wtg-mkbox">
                  <div className="warn">
                    먼저 위 목록에 같은 뜻의 태그가 없는지 확인해 주세요.
                    <br />
                    비슷한 이름이 생기면 필터가 둘로 갈라집니다.
                  </div>
                  <input
                    autoFocus
                    placeholder="영문으로 · 예) Theme Park"
                    value={typed}
                    disabled={busy}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.preventDefault();
                      if (e.key === "Escape") closeMaker();
                    }}
                  />
                  {sims.length ? (
                    <div className="wtg-sim">
                      {exact ? (
                        <b className="wtg-exact">이미 있는 태그입니다 — 이걸 고르세요</b>
                      ) : (
                        "혹시 이 중에 있나요?"
                      )}
                      <br />
                      {sims.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="wtg-pc"
                          disabled={busy || !isWorkGroup(tag.tag_group)}
                          title={isWorkGroup(tag.tag_group) ? undefined : "워크에는 붙일 수 없는 태그입니다"}
                          onClick={() => pickSimilar(tag)}
                        >
                          {tagName(tag)}
                          <span className="n">
                            {tag.tag_group ? GROUP_NAME[tag.tag_group] : "미분류"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="wtg-acts">
                    <button type="button" className="wtg-cancel" onClick={closeMaker}>
                      취소
                    </button>
                    <button
                      type="button"
                      className="wtg-go"
                      disabled={busy || !tidy(typed) || !!exact}
                      onClick={() => void create(group.key)}
                    >
                      {group.name}에 만들기
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="wtg-mk"
                  onClick={() => {
                    setTyped("");
                    setMaking(group.key);
                  }}
                >
                  목록에 없나요? 새 태그 만들기
                </button>
              )}
            </div>
          );
        })}
      </div>

      {loose.length ? (
        <div className="wtg-loose">
          <span className="wtg-loose-l">정리 필요</span>
          <div className="chips">
            {loose.map((id) => {
              const tag = byId.get(id);
              const name = tag ? tagName(tag) : id;
              return (
                <span key={id} className="chip">
                  {name}
                  <button
                    type="button"
                    className="x"
                    aria-label={`${name} 빼기`}
                    disabled={busy}
                    onClick={() => void save(selectedIds.filter((x) => x !== id))}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="hint-line warn">{error}</p> : null}
    </div>
  );
}
