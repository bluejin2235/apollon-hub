"use client";

/**
 * 홈페이지 통계 → 설정 → 목표 키워드 (기획-허브통계-3-8-목표키워드.md 3장)
 * 지우지 않고 내린다. 여러 줄 붙여 넣기로 한 번에 넣는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { normalizeKeyword } from "@/components/website/stats-v3/v3-keywords-data";
import { Badge } from "@/components/website/stats-v3/v3-parts";
import {
  addTargetKeywords,
  listTargetKeywords,
  updateTargetKeyword,
  type TargetKeywordWrite
} from "@/lib/website/api";
import type { TargetKeywordItem } from "@/lib/website/stats";

import "./v3.css";

const GOAL = 30;
const MAX_LEN = 60;

type Tab = "active" | "removed";

type PasteLine = {
  line: number;
  raw: string;
  item: TargetKeywordWrite | null;
  problem: string | null;
};

const REASON: Record<string, string> = {
  empty: "빈 칸",
  too_long: "60자 넘음",
  invalid_lang: "국/영 값이 이상함",
  invalid_priority: "우선순위는 1·2·3",
  duplicate_in_batch: "붙여 넣은 줄끼리 겹침",
  already_exists: "이미 있는 키워드",
  invalid: "읽을 수 없음"
};

function langOf(value: string | undefined): "ko" | "en" | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" ) return null;
  if (v === "ko" || v === "국문" || v === "한국어") return "ko";
  if (v === "en" || v === "영문" || v === "영어") return "en";
  return null;
}

/** 영문 글자만 있으면 영문, 아니면 국문 */
function guessLang(keyword: string): "ko" | "en" {
  return /[가-힣]/.test(keyword) ? "ko" : "en";
}

/**
 * 한 줄에 하나. 탭으로 나눈 칸: 키워드 · 국/영 · 묶음 · 바라는 페이지.
 * 국/영 칸이 비면 한글이 있는지로 정한다.
 */
function parsePaste(text: string, existing: Set<string>): PasteLine[] {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim() !== "")
    .map(({ raw, line }) => {
      const cells = raw.split("\t").map((cell) => cell.trim());
      const keyword = (cells[0] ?? "").replace(/\s+/g, " ");
      if (!keyword) return { line, raw, item: null, problem: REASON.empty };
      if (keyword.length > MAX_LEN) return { line, raw, item: null, problem: REASON.too_long };
      const norm = normalizeKeyword(keyword);
      if (!norm) return { line, raw, item: null, problem: REASON.empty };
      const lang = cells[1] ? langOf(cells[1]) : guessLang(keyword);
      if (!lang) return { line, raw, item: null, problem: REASON.invalid_lang };
      if (existing.has(norm)) return { line, raw, item: null, problem: REASON.already_exists };
      if (seen.has(norm)) return { line, raw, item: null, problem: REASON.duplicate_in_batch };
      seen.add(norm);
      return {
        line,
        raw,
        problem: null,
        item: {
          keyword,
          lang,
          keyword_group: cells[2] || null,
          target_page: cells[3] || null
        }
      };
    });
}

function dateText(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
}

function EditDialog({
  item,
  onClose,
  onSaved
}: {
  item: TargetKeywordItem | null;
  onClose: () => void;
  onSaved: (next: TargetKeywordItem) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keyword, setKeyword] = useState("");
  const [lang, setLang] = useState<"ko" | "en">("ko");
  const [group, setGroup] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [page, setPage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) {
      dialog.current?.close();
      return;
    }
    setKeyword(item.keyword);
    setLang(item.lang);
    setGroup(item.keyword_group ?? "");
    setPriority((item.priority === 1 || item.priority === 3 ? item.priority : 2) as 1 | 2 | 3);
    setPage(item.target_page ?? "");
    setError(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [item]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!item) return;
    setSaving(true);
    setError(null);
    const result = await updateTargetKeyword(item.id, {
      keyword,
      lang,
      keyword_group: group.trim() || null,
      priority,
      target_page: page.trim() || null
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error === "duplicate_keyword" ? "같은 키워드가 이미 있습니다." : "저장하지 못했습니다.");
      return;
    }
    onSaved(result.data.item);
  }

  return (
    <dialog ref={dialog} className="v3-dialog" onClose={onClose}>
      <form onSubmit={submit}>
        <h2>목표 키워드 고치기</h2>
        <label>
          키워드
          <input value={keyword} maxLength={MAX_LEN} required onChange={(event) => setKeyword(event.target.value)} />
        </label>
        <label>
          국/영
          <select value={lang} onChange={(event) => setLang(event.target.value === "en" ? "en" : "ko")}>
            <option value="ko">국문</option>
            <option value="en">영문</option>
          </select>
        </label>
        <label>
          묶음
          <input value={group} maxLength={30} placeholder="대중어 · 정체성 · 영문" onChange={(event) => setGroup(event.target.value)} />
        </label>
        <label>
          우선
          <select
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value) === 1 ? 1 : Number(event.target.value) === 3 ? 3 : 2)}
          >
            <option value={1}>1 (먼저)</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          바라는 페이지
          <input value={page} maxLength={300} placeholder="/works/star-avenue" onChange={(event) => setPage(event.target.value)} />
        </label>
        {error ? <p className="v3-dialog-error">{error}</p> : null}
        <div className="v3-dialog-actions">
          <button type="button" className="v3-ghost" onClick={() => dialog.current?.close()}>
            닫기
          </button>
          <button type="submit" className="v3-primary" disabled={saving}>
            저장
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function V3KeywordsSettings() {
  const [items, setItems] = useState<TargetKeywordItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<TargetKeywordItem | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await listTargetKeywords(signal);
    if (signal?.aborted) return;
    if (!result.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setItems(result.data.items);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const active = useMemo(() => (items ?? []).filter((item) => item.active), [items]);
  const removed = useMemo(() => (items ?? []).filter((item) => !item.active), [items]);
  const existing = useMemo(() => new Set((items ?? []).map((item) => item.keyword_norm)), [items]);
  const lines = useMemo(() => parsePaste(paste, existing), [paste, existing]);
  const ready = lines.filter((line) => line.item);
  const shown = tab === "active" ? active : removed;

  /**
   * 쓰기는 한 번에 하나만(넣기 · 고치기 · 내리기). 끝나면 목록을 다시 읽어
   * 겹친 요청이 서로의 결과를 덮지 않게 한다. 쓰는 동안 붙여 넣기 칸도 잠근다.
   */
  async function addAll() {
    if (ready.length === 0 || saving) return;
    const submitted = ready;
    const snapshot = paste;
    setSaving(true);
    setMessage(null);
    const result = await addTargetKeywords(submitted.map((line) => line.item as TargetKeywordWrite));
    if (!result.ok) {
      setSaving(false);
      setMessage("넣지 못했습니다. 잠시 뒤 다시 해 주세요.");
      return;
    }
    const added = new Set(
      result.data.results.filter((r) => r.status === "added").map((r) => submitted[r.index]?.line)
    );
    const blocked = result.data.results.filter((r) => r.status !== "added");
    // 넣은 줄만 지우고, 막힌 줄 · 검사에서 걸린 줄은 그대로 둔다
    setPaste(
      snapshot
        .split(/\r?\n/)
        .filter((raw, index) => raw.trim() !== "" && !added.has(index + 1))
        .join("\n")
    );
    await load();
    setSaving(false);
    setMessage(
      blocked.length === 0
        ? `${result.data.added}개를 넣었습니다.`
        : `${result.data.added}개를 넣었습니다. ${blocked.length}줄은 막혔습니다: ${blocked
            .map((r) => `${submitted[r.index]?.line ?? "?"}번 줄 ${"reason" in r ? REASON[r.reason] ?? r.reason : ""}`)
            .join(" · ")}`
    );
  }

  async function toggle(item: TargetKeywordItem) {
    if (saving) return;
    setSaving(true);
    setBusyId(item.id);
    const result = await updateTargetKeyword(item.id, { active: !item.active });
    if (result.ok) await load();
    setBusyId(null);
    setSaving(false);
    if (!result.ok) {
      setMessage("바꾸지 못했습니다.");
      return;
    }
    setMessage(item.active ? `「${item.keyword}」을(를) 내렸습니다.` : `「${item.keyword}」을(를) 다시 보이게 했습니다.`);
  }

  return (
    <div className="v3 v3-settings">
      <div className="v3-eyebrow">홈페이지 통계 / 설정</div>
      <h1>목표 키워드</h1>
      <p className="v3-tiny">
        구글 검색에서 이 말로 찾아오게 만들고 싶은 키워드입니다. 검색 화면의 「목표 키워드」 표가 이 목록을 씁니다. 지우지 않고
        내리며, 내리기 전 기간을 고르면 다시 보입니다.
      </p>

      <div className="v3-card">
        <div className="v3-card-head">
          <h2>
            보이는 키워드 {active.length}개 / 목표 {GOAL}
          </h2>
          <a className="v3-tiny" href="/website/stats/search">
            검색 화면에서 순위 보기 →
          </a>
        </div>
        {active.length > GOAL ? <p className="v3-note">{GOAL}개를 넘었습니다. 넘어도 저장은 됩니다.</p> : null}
        <div className="v3-chips">
          <button
            type="button"
            className={tab === "active" ? "v3-chip active" : "v3-chip"}
            aria-pressed={tab === "active"}
            onClick={() => setTab("active")}
          >
            보이는 것 {active.length}
          </button>
          <button
            type="button"
            className={tab === "removed" ? "v3-chip active" : "v3-chip"}
            aria-pressed={tab === "removed"}
            onClick={() => setTab("removed")}
          >
            내린 것 {removed.length}
          </button>
        </div>
        {loadError ? (
          <p className="v3-tiny">목록을 불러오지 못했습니다.</p>
        ) : items == null ? (
          <p className="v3-tiny">불러오는 중입니다</p>
        ) : shown.length === 0 ? (
          <p className="v3-tiny">
            {tab === "active" ? "목표 키워드가 없습니다. 아래에 붙여 넣어 시작하세요." : "내린 키워드가 없습니다."}
          </p>
        ) : (
          <div className="v3-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>키워드</th>
                  <th>국/영</th>
                  <th>묶음</th>
                  <th className="v3-num">우선</th>
                  <th>바라는 페이지</th>
                  <th>{tab === "active" ? "넣은 날" : "내린 날"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id}>
                    <td className="v3-keyword">{item.keyword}</td>
                    <td>
                      <Badge>{item.lang === "en" ? "영문" : "국문"}</Badge>
                    </td>
                    <td>{item.keyword_group ?? "—"}</td>
                    <td className="v3-num">{item.priority}</td>
                    <td className="v3-keyword-page">{item.target_page ?? "—"}</td>
                    <td>{dateText(tab === "active" ? item.added_at : item.removed_at)}</td>
                    <td className="v3-row-actions">
                      <button type="button" className="v3-ghost" disabled={saving} onClick={() => setEditing(item)}>
                        고치기
                      </button>
                      <button
                        type="button"
                        className="v3-ghost"
                        disabled={saving}
                        aria-busy={busyId === item.id}
                        onClick={() => void toggle(item)}
                      >
                        {item.active ? "내리기" : "다시 보이기"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="v3-card">
        <div className="v3-card-head">
          <div>
            <h2>넣기</h2>
            <p className="v3-card-sub">
              한 줄에 하나. 탭으로 나누면 「키워드 · 국/영 · 묶음 · 바라는 페이지」 순서로 읽습니다. 국/영을 비우면 한글이 있는지로
              정합니다.
            </p>
          </div>
        </div>
        <textarea
          className="v3-paste"
          rows={8}
          value={paste}
          disabled={saving}
          placeholder={"미디어파사드\t국문\t대중어\t/expertise\nmedia facade design\t영문\t영문\t/en/expertise"}
          onChange={(event) => setPaste(event.target.value)}
          aria-label="목표 키워드 붙여 넣기"
        />
        {lines.length > 0 ? (
          <ul className="v3-list v3-paste-check">
            {lines.map((line) => (
              <li key={line.line}>
                <span>
                  {line.line}번 줄 · {line.item?.keyword ?? line.raw.split("\t")[0]}
                </span>
                <span className="v3-val">{line.problem ? <Badge>{line.problem}</Badge> : "넣을 수 있음"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="v3-dialog-actions">
          <button type="button" className="v3-primary" disabled={saving || ready.length === 0} onClick={() => void addAll()}>
            {ready.length > 0 ? `${ready.length}개 넣기` : "넣기"}
          </button>
        </div>
        {message ? (
          <p className="v3-tiny" role="status">
            {message}
          </p>
        ) : null}
      </div>

      <EditDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          setEditing(null);
          setMessage(`「${next.keyword}」을(를) 고쳤습니다.`);
          setSaving(true);
          void load().finally(() => setSaving(false));
        }}
      />
    </div>
  );
}
