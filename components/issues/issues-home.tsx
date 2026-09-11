"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { loadIssueList, patchIssue } from "@/lib/issues/client";
import { formatIssueAgo } from "@/lib/issues/time";
import {
  ISSUE_AREAS,
  ISSUE_BOARD_STATUSES,
  ISSUE_KINDS,
  ISSUE_SORTS,
  isDimmedStatus,
  kindClass,
  nameInitial,
  statusClass,
  type IssueArea,
  type IssueBoardStatus,
  type IssueKind,
  type IssueListItem,
  type IssueSort,
  type IssueStatus
} from "@/lib/issues/types";
import "@/components/issues/issues.css";

type View = "list" | "board";

export function IssuesHome() {
  const [view, setView] = useState<View>("list");
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [kind, setKind] = useState<IssueKind | "">("");
  const [area, setArea] = useState<IssueArea | "">("");
  const [sort, setSort] = useState<IssueSort>("최신순");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [issues, setIssues] = useState<IssueListItem[]>([]);
  const [counts, setCounts] = useState({ 접수: 0, "실행 중": 0, 완료: 0, 보류: 0, 취소: 0 });
  const [me, setMe] = useState<{ id: string; is_admin: boolean }>({ id: "", is_admin: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<IssueBoardStatus | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadIssueList({
        status,
        kind,
        area,
        q,
        sort
      });
      setIssues(data.issues);
      setCounts(data.counts);
      setMe({ id: data.me.id, is_admin: data.me.is_admin });
      setError(null);
    } catch (err) {
      console.error("[issues] list", err);
      setError("목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [status, kind, area, q, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const boardGroups = useMemo(() => {
    const groups: Record<IssueBoardStatus, IssueListItem[]> = {
      접수: [],
      "실행 중": [],
      완료: [],
      보류: []
    };
    for (const item of issues) {
      if (item.status === "취소") continue;
      groups[item.status as IssueBoardStatus].push(item);
    }
    return groups;
  }, [issues]);

  function toggleStatus(next: IssueStatus) {
    setStatus((cur) => (cur === next ? "" : next));
  }

  function canDrag(item: IssueListItem): boolean {
    return me.is_admin || item.assignee_id === me.id || item.author_id === me.id;
  }

  function beginDrag(id: string, event: DragEvent) {
    const item = issues.find((row) => row.id === id);
    if (!item || !canDrag(item)) return;
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
    dragIdRef.current = id;
    setDragId(id);
  }

  function endDrag() {
    dragIdRef.current = null;
    setDragId(null);
    setOverStatus(null);
  }

  async function dropOn(next: IssueBoardStatus) {
    const id = dragIdRef.current;
    endDrag();
    const dragged = issues.find((row) => row.id === id);
    if (!id || !dragged || !canDrag(dragged)) return;
    const item = issues.find((row) => row.id === id);
    if (!item || item.status === next) return;
    setIssues((cur) => cur.map((row) => (row.id === id ? { ...row, status: next } : row)));
    try {
      await patchIssue(id, { status: next });
      await load();
    } catch (err) {
      console.error("[issues] drag status", err);
      await load();
    }
  }

  return (
    <div className="iss-page">
      <p className="iss-crumb">
        <Link href="/hub">← Hub</Link>
      </p>
      <div className="iss-box">
        <div className="iss-hd">
          <div>
            <h1>문의</h1>
            <div className="iss-sub">불편한 것과 바라는 것을 여기에 올려 주세요</div>
          </div>
          <div className="iss-hdr">
            <div className="iss-seg">
              <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
                목록
              </button>
              <button type="button" className={view === "board" ? "on" : ""} onClick={() => setView("board")}>
                보드
              </button>
            </div>
            <Link href="/issues/new" className="iss-b pri">
              ＋ 새 문의
            </Link>
          </div>
        </div>

        <div className="iss-summary">
          <button
            type="button"
            className={`iss-sm new${status === "접수" ? " on" : ""}`}
            onClick={() => toggleStatus("접수")}
          >
            <div className="n">{counts.접수}</div>
            <div className="t">접수</div>
          </button>
          <button
            type="button"
            className={`iss-sm doing${status === "실행 중" ? " on" : ""}`}
            onClick={() => toggleStatus("실행 중")}
          >
            <div className="n">{counts["실행 중"]}</div>
            <div className="t">실행 중</div>
          </button>
          <button
            type="button"
            className={`iss-sm done${status === "완료" ? " on" : ""}`}
            onClick={() => toggleStatus("완료")}
          >
            <div className="n">{counts.완료}</div>
            <div className="t">완료</div>
          </button>
          <button
            type="button"
            className={`iss-sm${status === "보류" ? " on" : ""}`}
            onClick={() => toggleStatus("보류")}
          >
            <div className="n">{counts.보류}</div>
            <div className="t">보류</div>
          </button>
        </div>

        <div className="iss-filters">
          <input
            type="text"
            placeholder="제목 · 내용 찾기"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setQ(draft.trim());
            }}
            onBlur={() => setQ(draft.trim())}
          />
          <select
            value={kind}
            onChange={(event) => setKind((event.target.value || "") as IssueKind | "")}
          >
            <option value="">전체 종류</option>
            {ISSUE_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={area}
            onChange={(event) => setArea((event.target.value || "") as IssueArea | "")}
          >
            <option value="">전체 서비스</option>
            {ISSUE_AREAS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as IssueSort)}
          >
            {ISSUE_SORTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="iss-err">{error}</p> : null}
        {loading && issues.length === 0 ? <p className="iss-note">불러오는 중…</p> : null}

        {view === "list" ? (
          <table className="iss-table">
            <colgroup>
              <col />
              <col className="c-st" />
              <col className="c-who" />
              <col className="c-as" />
              <col className="c-cm" />
            </colgroup>
            <thead>
              <tr>
                <th>제목</th>
                <th>상태</th>
                <th>올린 사람</th>
                <th>맡은 사람</th>
                <th>댓글</th>
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="iss-empty">
                    아직 문의가 없습니다
                  </td>
                </tr>
              ) : (
                issues.map((item) => (
                  <tr key={item.id} className={isDimmedStatus(item.status) ? "is-dim" : undefined}>
                    <td>
                      <Link href={`/issues/${item.seq}`} className="iss-link">
                        <div className="iss-ti">
                          <span className={`iss-kind ${kindClass(item.kind)}`}>{item.kind}</span>
                          <span className="txt">{item.title}</span>
                        </div>
                        <div className="iss-t2">
                          {item.area} · {formatIssueAgo(item.created_at)}
                        </div>
                      </Link>
                    </td>
                    <td>
                      <span className={`iss-st ${statusClass(item.status)}`}>
                        <i />
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <div className="iss-who">
                        <span className="iss-av">{nameInitial(item.author_name)}</span>
                        {item.author_name}
                      </div>
                    </td>
                    <td>
                      {item.assignee_name ? (
                        <div className="iss-who">
                          <span className="iss-av">{nameInitial(item.assignee_name)}</span>
                          {item.assignee_name}
                        </div>
                      ) : (
                        <span className="iss-empty">—</span>
                      )}
                    </td>
                    <td className="iss-cm">💬 {item.comment_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <div className="iss-board">
            {ISSUE_BOARD_STATUSES.map((col) => (
              <div
                key={col}
                className={`iss-col${overStatus === col ? " is-over" : ""}`}
                onDragOver={(event) => {
                  if (!dragIdRef.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOverStatus(col);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void dropOn(col);
                }}
              >
                <h4>
                  {col} <span className="c">{boardGroups[col].length}</span>
                </h4>
                {boardGroups[col].map((item) => (
                  <Link
                    key={item.id}
                    href={`/issues/${item.seq}`}
                    className={`iss-card iss-link${item.status === "완료" ? " is-dim" : ""}${
                      dragId === item.id ? " is-dragging" : ""
                    }`}
                    draggable={canDrag(item)}
                    onDragStart={(event) => beginDrag(item.id, event)}
                    onDragEnd={endDrag}
                  >
                    <div className="t">{item.title}</div>
                    <div className="m">
                      <span className={`iss-kind ${kindClass(item.kind)}`}>{item.kind}</span>
                      <span className="iss-cm">{item.assignee_name ?? item.author_name}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="iss-note">
        위의 숫자를 누르면 그 상태만 걸러 봅니다.
        <br />
        끝난 것은 흐리게 보입니다. 지우지 않습니다.
      </p>
      {view === "board" ? <p className="iss-note">카드를 끌어 옮기면 상태가 바뀝니다.</p> : null}
    </div>
  );
}
