"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCreatorWord,
  createSection,
  deleteCreatorWord,
  deleteSection,
  reorderCreatorWords,
  searchContent,
  updateCreatorWord,
  type SearchHit
} from "@/lib/website/api";
import { apiFailMessage } from "@/lib/website/api-fail-message";
import {
  creatorWordsOf,
  emptyLoc,
  interviewSectionOf,
  mediaUrl,
  type CreatorWord,
  type Loc,
  type WorkDetail
} from "@/lib/website/work-detail";
import { PartialSaveBtn } from "@/components/website/partial-save-btn";
import { useAutoPartialSave } from "@/components/website/use-auto-partial-save";
import "./ui/work-admin.css";

type Props = {
  work: WorkDetail;
  siteUrl: string;
  onReload: () => Promise<void>;
};

const MAX_CARDS = 6;
const QUOTE_KO_MAX = 200;
const QUOTE_EN_MAX = 300;
const PERSON_MAX = 60;
const UNDO_MS = 5000;

type FieldKey = "quote" | "name" | "rank" | "org";

function sameLoc(a: Loc, b: Loc) {
  return a.ko === b.ko && a.en === b.en;
}

function sameWord(a: CreatorWord, b: CreatorWord) {
  return (
    a.id === b.id &&
    a.sort === b.sort &&
    a.insight_id === b.insight_id &&
    sameLoc(a.quote, b.quote) &&
    sameLoc(a.name, b.name) &&
    sameLoc(a.rank, b.rank) &&
    sameLoc(a.org, b.org)
  );
}

function sameList(a: CreatorWord[], b: CreatorWord[]) {
  if (a.length !== b.length) return false;
  return a.every((word, index) => sameWord(word, b[index]!));
}

function clip(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

function personLine(word: CreatorWord) {
  return [word.name.ko, word.rank.ko, word.org.ko]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

function hitTitle(hit: SearchHit) {
  if (!hit.title) return hit.slug;
  if (typeof hit.title === "string") return hit.title;
  return hit.title.ko?.trim() || hit.title.en?.trim() || hit.slug;
}

function hitDate(iso: string | null | undefined) {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

export function WorkInterviewTab({ work, siteUrl, onReload }: Props) {
  const section = interviewSectionOf(work);
  const saved = useMemo(() => creatorWordsOf(work), [work]);
  const [rows, setRows] = useState<CreatorWord[]>(saved);
  const [shown, setShown] = useState(Boolean(section));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<SearchHit[] | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pendingRef = useRef<string | null>(null);
  const chainRef = useRef(Promise.resolve());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = chainRef.current.then(job, job);
    chainRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  const dirty = Boolean(pendingDelete) || !sameList(rows, saved);

  const auto = useAutoPartialSave({
    flushId: `work-creator-words:${work.id}`,
    persist: () =>
      enqueue(async () => {
        setError(null);
        const skip = pendingRef.current;
        const savedById = new Map(creatorWordsOf(work).map((word) => [word.id, word]));
        for (const word of rowsRef.current) {
          if (word.id === skip) continue;
          const previous = savedById.get(word.id);
          if (
            previous &&
            previous.insight_id === word.insight_id &&
            sameLoc(previous.quote, word.quote) &&
            sameLoc(previous.name, word.name) &&
            sameLoc(previous.rank, word.rank) &&
            sameLoc(previous.org, word.org)
          ) {
            continue;
          }
          const res = await updateCreatorWord(work.id, word.id, {
            quote: word.quote,
            name: word.name,
            rank: word.rank,
            org: word.org,
            insight_id: word.insight_id
          });
          if (!res.ok) {
            setError(apiFailMessage(res));
            return false;
          }
        }
        await onReload();
        return true;
      })
  });

  useEffect(() => {
    if (dirty) return;
    setRows(saved);
    setShown(Boolean(section));
    auto.resetFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, section, dirty]);

  useEffect(() => {
    let cancelled = false;
    void searchContent("", "insight", 500, { published: true }).then((res) => {
      if (cancelled || !res.ok || !Array.isArray(res.data)) return;
      setCatalog(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [work.id]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  const liveIds = useMemo(() => new Set((catalog ?? []).map((hit) => hit.id)), [catalog]);

  function patchWord(id: string, next: Partial<CreatorWord>) {
    setRows((prev) => prev.map((word) => (word.id === id ? { ...word, ...next } : word)));
    auto.schedule();
  }

  function patchLoc(id: string, key: FieldKey, side: "ko" | "en", value: string, max: number) {
    setRows((prev) =>
      prev.map((word) =>
        word.id === id ? { ...word, [key]: { ...word[key], [side]: clip(value, max) } } : word
      )
    );
    auto.schedule();
  }

  async function toggleShow(next: boolean) {
    setBusy(true);
    setError(null);
    setShown(next);
    try {
      if (next) {
        if (section) return;
        const sort = Math.max(0, ...(work.work_sections ?? []).map((item) => item.sort)) + 1;
        const created = await createSection(work.id, {
          headline: { ko: "인터뷰", en: "Interview" },
          kind: "interview",
          sort
        });
        if (!created.ok) {
          setError(apiFailMessage(created));
          setShown(false);
          return;
        }
        await onReload();
        return;
      }
      if (!section) return;
      const removed = await deleteSection(work.id, section.id);
      if (!removed.ok) {
        setError(apiFailMessage(removed));
        setShown(true);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function addCard() {
    if (rows.length >= MAX_CARDS || busy || pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createCreatorWord(work.id);
      if (!res.ok) {
        setError(apiFailMessage(res));
        return;
      }
      setRows((prev) => [...prev, res.data]);
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(word: CreatorWord) {
    if (rows.length >= MAX_CARDS || busy || pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCreatorWord(work.id);
      if (!created.ok) {
        setError(apiFailMessage(created));
        return;
      }
      const insightId =
        word.insight_id && liveIds.has(word.insight_id) ? word.insight_id : null;
      const savedCard = await updateCreatorWord(work.id, created.data.id, {
        quote: word.quote,
        name: word.name,
        rank: word.rank,
        org: word.org,
        insight_id: insightId
      });
      if (!savedCard.ok) {
        setError(apiFailMessage(savedCard));
        setRows((prev) => [...prev, created.data]);
        await onReload();
        return;
      }
      setRows((prev) => [...prev, savedCard.data]);
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= rows.length || busy || pendingDelete) return;
    const previous = rows;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    const ordered = next.map((word, sort) => ({ ...word, sort }));
    setRows(ordered);
    setBusy(true);
    setError(null);
    try {
      const res = await enqueue(() =>
        reorderCreatorWords(
          work.id,
          ordered.map((word) => ({ id: word.id, sort: word.sort }))
        )
      );
      if (!res.ok) {
        setError(apiFailMessage(res));
        setRows(previous);
        return;
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(id: string) {
    if (pendingRef.current || busy) return;
    pendingRef.current = id;
    setPendingDelete(id);
    setOpenPicker(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      void confirmDelete(id);
    }, UNDO_MS);
  }

  function undoDelete() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    pendingRef.current = null;
    setPendingDelete(null);
    if (!sameList(rowsRef.current, creatorWordsOf(work))) auto.schedule();
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await enqueue(() => deleteCreatorWord(work.id, id));
      pendingRef.current = null;
      setPendingDelete(null);
      if (!res.ok) {
        setError(apiFailMessage(res));
        return;
      }
      setRows((prev) => prev.filter((word) => word.id !== id));
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  const filtered = (catalog ?? []).filter((hit) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return hitTitle(hit).toLowerCase().includes(needle) || hit.slug.toLowerCase().includes(needle);
  });

  return (
    <div className="wa">
      <div className="grph">
        <h3>Creator’s Word</h3>
        <div className="grpr">
          <label className="sw">
            <input
              type="checkbox"
              checked={shown}
              disabled={busy}
              onChange={(event) => void toggleShow(event.target.checked)}
            />{" "}
            이 워크에 표시
          </label>
          <PartialSaveBtn state={auto.buttonState} onClick={() => void auto.flush()} />
        </div>
      </div>
      <p className="grpd">
        워크 상세 하단에 카드로 나옵니다. 한 줄 평을 여러 개 올리고 순서를 바꿀 수 있습니다.
        심화 인터뷰가 있으면 공개된 인사이트 글을 골라 연결합니다.
      </p>
      {shown ? (
        <p className="hint-line">입력하면 자동 저장됩니다. 사이트에는 「공개」를 눌러야 반영됩니다. · 한 줄 평 최대 6개</p>
      ) : (
        <p className="hint-line">사이트에서만 숨겨집니다. 한 줄 평은 지워지지 않습니다.</p>
      )}
      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      {rows.map((word, index) => {
        const broken = Boolean(word.insight_id && catalog && !liveIds.has(word.insight_id));
        const selected = catalog?.find((hit) => hit.id === word.insight_id) ?? null;
        const who = personLine(word);
        return (
          <div className="blk on" key={word.id} style={{ marginTop: 16 }}>
            <div className="bh">
              <span className="kd">{String(index + 1).padStart(2, "0")}</span>
              <span className="ct">{who || "이름 없음"}</span>
              {broken ? <span className="c2 w">심화 인터뷰 연결 끊김</span> : null}
              <span className="ml-auto" />
              <button type="button" className="ico" disabled={index === 0 || busy || Boolean(pendingDelete)} onClick={() => void move(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="ico"
                disabled={index === rows.length - 1 || busy || Boolean(pendingDelete)}
                onClick={() => void move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="ico"
                disabled={rows.length >= MAX_CARDS || busy || Boolean(pendingDelete)}
                onClick={() => void duplicate(word)}
              >
                복제
              </button>
              <button type="button" className="ico" disabled={busy || Boolean(pendingDelete)} onClick={() => requestDelete(word.id)}>
                삭제
              </button>
            </div>
            {pendingDelete === word.id ? (
              <div className="bb">
                <p className="hint-line">
                  이 한 줄 평을 삭제합니다.{" "}
                  <button type="button" className="btn sm" onClick={undoDelete}>
                    실행 취소
                  </button>
                </p>
              </div>
            ) : (
              <div className="bb">
                <div className="fl">
                  <span className="nm">한 줄 평</span>
                  <span className="cc">
                    국문 {word.quote.ko.length} / {QUOTE_KO_MAX} · 영문 {word.quote.en.length} / {QUOTE_EN_MAX}
                    {word.quote.ko.trim() && !word.quote.en.trim() ? " · 영문 비어 있음" : ""}
                  </span>
                </div>
                <div className="two">
                  <label>
                    <span className="hint-line">국문</span>
                    <textarea
                      className="i"
                      rows={3}
                      maxLength={QUOTE_KO_MAX}
                      value={word.quote.ko}
                      placeholder="국문 한 줄 평"
                      onChange={(event) => patchLoc(word.id, "quote", "ko", event.target.value, QUOTE_KO_MAX)}
                    />
                  </label>
                  <label>
                    <span className="hint-line">영문</span>
                    <textarea
                      className="i"
                      rows={3}
                      maxLength={QUOTE_EN_MAX}
                      value={word.quote.en}
                      placeholder="영문 한 줄 평"
                      onChange={(event) => patchLoc(word.id, "quote", "en", event.target.value, QUOTE_EN_MAX)}
                    />
                  </label>
                </div>

                <p className="hint-line" style={{ marginTop: 12, fontWeight: 700 }}>
                  사람
                </p>
                <div className="r3">
                  <PersonFields
                    label="이름"
                    value={word.name}
                    onChange={(side, value) => patchLoc(word.id, "name", side, value, PERSON_MAX)}
                  />
                  <PersonFields
                    label="직급"
                    value={word.rank}
                    onChange={(side, value) => patchLoc(word.id, "rank", side, value, PERSON_MAX)}
                  />
                  <PersonFields
                    label="조직"
                    value={word.org}
                    onChange={(side, value) => patchLoc(word.id, "org", side, value, PERSON_MAX)}
                  />
                </div>
                <p className="hint-line">
                  이름은 필수. 사이트 표시: 이름 · 직급 · 조직 — 빈 칸은 점 없이 빠집니다.
                </p>

                <div className="f">
                  <div className="fl">
                    <span className="nm">심화 인터뷰 연결</span>
                    <span className="cc">선택</span>
                  </div>
                  <button type="button" className="btn sm" onClick={() => setOpenPicker(openPicker === word.id ? null : word.id)}>
                    {selected ? hitTitle(selected) : word.insight_id ? "연결된 글을 찾을 수 없습니다" : "연결 안 함"}
                  </button>
                  {openPicker === word.id ? (
                    <div className="box" style={{ marginTop: 8 }}>
                      <input
                        className="i"
                        value={query}
                        placeholder="인사이트 제목으로 찾기"
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <button
                        type="button"
                        className="lrow"
                        onClick={() => {
                          patchWord(word.id, { insight_id: null });
                          setOpenPicker(null);
                          setQuery("");
                        }}
                      >
                        연결 안 함
                      </button>
                      {catalog && catalog.length === 0 ? (
                        <p className="hint-line">공개된 인사이트가 없습니다. 글을 쓰고 공개한 뒤 연결하세요.</p>
                      ) : null}
                      {catalog && catalog.length > 0 && filtered.length === 0 ? (
                        <p className="hint-line">검색 결과가 없습니다.</p>
                      ) : null}
                      {filtered.map((hit) => (
                        <button
                          type="button"
                          className="lrow"
                          key={hit.id}
                          onClick={() => {
                            patchWord(word.id, { insight_id: hit.id });
                            setOpenPicker(null);
                            setQuery("");
                          }}
                        >
                          {mediaUrl(siteUrl, hit.key_image) ? (
                            <span className="th">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={mediaUrl(siteUrl, hit.key_image) ?? ""} alt="" />
                            </span>
                          ) : null}
                          <span>
                            <span className="t1">{hitTitle(hit)}</span>
                            <span className="t2">
                              {["인사이트", hit.category, hitDate(hit.published_at), "공개 중"]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          {word.insight_id === hit.id ? <span className="t2">선택됨</span> : null}
                        </button>
                      ))}
                      <p className="hint-line">공개 중인 인사이트만 나옵니다. 감추거나 공개 전인 글은 보이지 않습니다.</p>
                    </div>
                  ) : null}
                  <p className="hint-line">
                    연결하면 카드 아래에 심화 인터뷰 링크가 나옵니다. 연결한 글을 나중에 감추면 링크가 자동으로 사라집니다.
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="addb" disabled={rows.length >= MAX_CARDS || busy || Boolean(pendingDelete)} onClick={() => void addCard()}>
        ＋ 한 줄 평 추가 ({rows.length} / {MAX_CARDS})
      </button>
    </div>
  );
}

function PersonFields({
  label,
  value,
  onChange
}: {
  label: string;
  value: Loc;
  onChange: (side: "ko" | "en", value: string) => void;
}) {
  return (
    <div>
      <div className="fl">
        <span className="nm">
          {label} · 국문 / 영문
        </span>
        <span className="cc">
          {value.ko.length} / {PERSON_MAX} · {value.en.length} / {PERSON_MAX}
        </span>
      </div>
      <div className="two">
        <input
          className="i"
          maxLength={PERSON_MAX}
          value={value.ko}
          placeholder={`${label} 국문`}
          onChange={(event) => onChange("ko", event.target.value)}
        />
        <input
          className="i"
          maxLength={PERSON_MAX}
          value={value.en}
          placeholder={`${label} 영문`}
          onChange={(event) => onChange("en", event.target.value)}
        />
      </div>
    </div>
  );
}
