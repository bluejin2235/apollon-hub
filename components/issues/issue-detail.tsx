"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { IssueEditor } from "@/components/issues/issue-editor";
import { loadIssueDetail, patchIssue, postIssueComment, setIssueWatch } from "@/lib/issues/client";
import { formatIssueWhen } from "@/lib/issues/time";
import {
  ISSUE_AREAS,
  ISSUE_KINDS,
  ISSUE_STATUSES,
  isIssueArea,
  kindClass,
  nameInitial,
  statusClass,
  type IssueArea,
  type IssueDetail,
  type IssueKind,
  type IssueMember,
  type IssueStatus
} from "@/lib/issues/types";
import "@/components/issues/issues.css";

function eventText(item: Extract<IssueDetail["timeline"][number], { type: "event" }>): string {
  if (item.kind === "assignee") {
    return `${item.actor_name} 님이 맡은 사람을 ${item.from_value ?? "—"} → ${item.to_value ?? "—"} 으로 바꿨습니다`;
  }
  if (item.kind === "edit") {
    return `${item.actor_name} 님이 내용을 고쳤습니다`;
  }
  return `${item.actor_name} 님이 상태를 ${item.from_value ?? "—"} → ${item.to_value ?? "—"} 으로 바꿨습니다`;
}

export function IssueDetailView({ seq }: { seq: string }) {
  const [detail, setDetail] = useState<(IssueDetail & { members?: IssueMember[] }) | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editKind, setEditKind] = useState<IssueKind>("안 돼요");
  const [editArea, setEditArea] = useState<IssueArea>("홈페이지");

  const load = useCallback(async () => {
    try {
      const data = await loadIssueDetail(seq);
      setDetail(data);
      setError(null);
    } catch {
      setError("문의를 찾지 못했습니다");
      setDetail(null);
    }
  }, [seq]);

  useEffect(() => {
    void load();
  }, [load]);

  function beginEdit() {
    if (!detail) return;
    setEditTitle(detail.title);
    setEditBody(detail.body);
    setEditKind(detail.kind);
    setEditArea(isIssueArea(detail.area) ? detail.area : "그 밖");
    setEditing(true);
  }

  async function saveEdit() {
    if (!detail) return;
    if (!editTitle.trim()) {
      setError("한 줄로 무슨 일인지 적어 주세요");
      return;
    }
    setBusy(true);
    try {
      await patchIssue(detail.id, {
        title: editTitle.trim(),
        body: editBody,
        kind: editKind,
        area: editArea
      });
      setEditing(false);
      await load();
    } catch (err) {
      console.error("[issues] edit", err);
      setError("내용을 고치지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: IssueStatus) {
    if (!detail || status === detail.status) return;
    try {
      await patchIssue(detail.id, { status });
      await load();
    } catch (err) {
      console.error("[issues] status", err);
      setError("상태를 바꾸지 못했습니다");
    }
  }

  async function changeAssignee(assigneeId: string) {
    if (!detail) return;
    try {
      await patchIssue(detail.id, { assignee_id: assigneeId || null });
      setPicking(false);
      await load();
    } catch (err) {
      console.error("[issues] assignee", err);
      setError("맡은 사람을 바꾸지 못했습니다");
    }
  }

  async function toggleWatch() {
    if (!detail) return;
    try {
      await setIssueWatch(detail.id, !detail.watching);
      await load();
    } catch (err) {
      console.error("[issues] watch", err);
    }
  }

  async function sendComment(markDone: boolean) {
    if (!detail) return;
    setBusy(true);
    try {
      await postIssueComment(detail.id, comment, markDone);
      setComment("");
      await load();
    } catch (err) {
      console.error("[issues] comment", err);
      setError("댓글을 올리지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="iss-page">
        <p className="iss-crumb">
          <Link href="/issues">← 문의 게시판</Link>
        </p>
        <p className="iss-err">{error}</p>
        <Link href="/issues" className="iss-b">
          목록으로
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="iss-page">
        <p className="iss-crumb">
          <Link href="/issues">← 문의 게시판</Link>
        </p>
        <p className="iss-note">불러오는 중…</p>
      </div>
    );
  }

  const members = detail.members ?? [];

  return (
    <div className="iss-page">
      <p className="iss-crumb">
        <Link href="/issues">← 문의 게시판</Link>
      </p>
      <div className="iss-side">
        <div className="iss-box">
        <div className="iss-detail-hd">
          <div className="top">
            <span className={`iss-kind ${kindClass(editing ? editKind : detail.kind)}`}>
              {editing ? editKind : detail.kind}
            </span>
            <span className={`iss-st ${statusClass(detail.status)}`}>
              <i />
              {detail.status}
            </span>
            <span className="iss-seq">#{detail.seq}</span>
            {detail.can_edit && !editing ? (
              <button type="button" className="iss-b sm iss-edit-btn" onClick={beginEdit}>
                고치기
              </button>
            ) : null}
            {editing ? (
              <>
                <button
                  type="button"
                  className="iss-b sm iss-edit-btn"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="iss-b sm pri"
                  disabled={busy}
                  onClick={() => void saveEdit()}
                >
                  저장
                </button>
              </>
            ) : null}
          </div>
          {editing ? (
            <div className="iss-edit-fields">
              <div className="iss-form-grid">
                <div>
                  <div className="iss-lab">어떤 이야기인가요</div>
                  <div className="iss-kinds">
                    {ISSUE_KINDS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={`iss-b sm${editKind === item ? " kind-on" : ""}`}
                        onClick={() => setEditKind(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="iss-lab">어디에서요</div>
                  <select
                    value={editArea}
                    onChange={(event) => setEditArea(event.target.value as IssueArea)}
                  >
                    {ISSUE_AREAS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="iss-title-wrap">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <>
              <h2>{detail.title}</h2>
              <div className="iss-meta">
                {detail.author_name} · {formatIssueWhen(detail.created_at)} · {detail.area}
              </div>
            </>
          )}
        </div>

        {detail.timeline.map((item) => {
          if (item.type === "event") {
            return (
              <div key={item.id} className="iss-post sys">
                <span className="iss-av sys">⚙</span>
                <div className="body">
                  <div className="iss-txt">
                    {eventText(item)} · {formatIssueWhen(item.created_at)}
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === "body" && editing) {
            return (
              <div key={item.id} className="iss-post">
                <span className="iss-av">{nameInitial(item.author_name)}</span>
                <div className="body">
                  <div className="iss-who2">
                    {item.author_name} <span>{formatIssueWhen(item.created_at)}</span>
                  </div>
                  <IssueEditor value={editBody} onChange={setEditBody} members={members} />
                </div>
              </div>
            );
          }
          return (
            <div key={item.id} className="iss-post">
              <span className="iss-av">{nameInitial(item.author_name)}</span>
              <div className="body">
                <div className="iss-who2">
                  {item.author_name} <span>{formatIssueWhen(item.created_at)}</span>
                </div>
                <div className="iss-txt" dangerouslySetInnerHTML={{ __html: item.body }} />
              </div>
            </div>
          );
        })}

        {editing ? null : (
          <div className="iss-writebox">
            <p className="iss-form-hint">댓글을 남겨 주세요. @이름 으로 부를 수 있습니다</p>
            <IssueEditor compact value={comment} onChange={setComment} members={members} />
            <div className="tools">
              <span className="iss-form-hint">이미지를 붙여넣을 수 있습니다</span>
              <div className="iss-form-btns">
                {detail.can_manage ? (
                  <button
                    type="button"
                    className="iss-b sm"
                    disabled={busy}
                    onClick={() => void sendComment(true)}
                  >
                    완료로
                  </button>
                ) : null}
                <button
                  type="button"
                  className="iss-b sm acc"
                  disabled={busy}
                  onClick={() => void sendComment(false)}
                >
                  댓글
                </button>
              </div>
            </div>
          </div>
        )}
        {error ? <p className="iss-err">{error}</p> : null}
      </div>

      <div>
        <div className="iss-sidecard">
          <h5>상태</h5>
          <select
            value={detail.status}
            disabled={!detail.can_manage}
            onChange={(event) => void changeStatus(event.target.value as IssueStatus)}
          >
            {ISSUE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="iss-sidecard">
          <h5>맡은 사람</h5>
          {detail.assignee_name ? (
            <div className="row">
              <span className="iss-av">{nameInitial(detail.assignee_name)}</span>
              {detail.assignee_name}
            </div>
          ) : (
            <div className="row iss-empty">—</div>
          )}
          {detail.can_assign || picking ? (
            picking ? (
              <select
                value={detail.assignee_id ?? ""}
                onChange={(event) => void changeAssignee(event.target.value)}
              >
                <option value="">—</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="iss-b sm wide" onClick={() => setPicking(true)}>
                바꾸기
              </button>
            )
          ) : null}
        </div>

        <div className="iss-sidecard">
          <h5>보고 있는 사람</h5>
          {detail.watchers.map((watcher) => (
            <div key={watcher.id} className="row">
              <span className="iss-av">{nameInitial(watcher.name)}</span>
              {watcher.name}
            </div>
          ))}
          <button type="button" className="iss-b sm wide" onClick={() => void toggleWatch()}>
            {detail.watching ? "그만 보기" : "나도 보기"}
          </button>
        </div>

        <div className="iss-sidecard">
          <h5>어디</h5>
          <div className="iss-area">{editing ? editArea : detail.area}</div>
        </div>
      </div>
      </div>
    </div>
  );
}
