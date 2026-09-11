"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IssueEditor } from "@/components/issues/issue-editor";
import { createIssue, loadIssueList } from "@/lib/issues/client";
import {
  ISSUE_AREAS,
  ISSUE_KINDS,
  type IssueArea,
  type IssueKind,
  type IssueMember
} from "@/lib/issues/types";
import "@/components/issues/issues.css";

export function IssueNewForm() {
  const router = useRouter();
  const [kind, setKind] = useState<IssueKind>("안 돼요");
  const [area, setArea] = useState<IssueArea>("홈페이지");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [members, setMembers] = useState<IssueMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadIssueList({}).then((data) => setMembers(data.members)).catch(() => {});
  }, []);

  async function submit() {
    if (!title.trim()) {
      setError("한 줄로 무슨 일인지 적어 주세요");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createIssue({ kind, area, title: title.trim(), body });
      router.push(`/issues/${created.seq}`);
    } catch (err) {
      console.error("[issues] create", err);
      setError("올리지 못했습니다");
      setBusy(false);
    }
  }

  return (
    <div className="iss-page">
      <p className="iss-crumb">
        <Link href="/issues">← 문의 게시판</Link>
      </p>
      <div className="iss-box">
        <div className="iss-hd">
          <div>
            <h1>문의</h1>
            <div className="iss-sub">불편한 것과 바라는 것을 여기에 올려 주세요</div>
          </div>
        </div>

        <div className="iss-form-grid">
          <div>
            <div className="iss-lab">어떤 이야기인가요</div>
            <div className="iss-kinds">
              {ISSUE_KINDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`iss-b sm${kind === item ? " kind-on" : ""}`}
                  onClick={() => setKind(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="iss-lab">어디에서요</div>
            <select value={area} onChange={(event) => setArea(event.target.value as IssueArea)}>
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
            placeholder="한 줄로 무슨 일인지 적어 주세요"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <p className="iss-note">
          언제 · 어디서 · 무엇을 하다가 그랬는지 적어 주세요.
          <br />
          화면을 캡처해서 붙여넣으셔도 됩니다.
          <br />
          @이름 을 쓰면 그 사람에게 알림이 갑니다.
        </p>

        <IssueEditor value={body} onChange={setBody} members={members} />

        <div className="iss-form-foot">
          <div className="iss-form-hint">홈페이지 어드민과 같은 편집기입니다</div>
          <div className="iss-form-btns">
            <Link href="/issues" className="iss-b">
              취소
            </Link>
            <button type="button" className="iss-b pri" disabled={busy} onClick={() => void submit()}>
              올리기
            </button>
          </div>
        </div>
        {error ? <p className="iss-err">{error}</p> : null}
      </div>
      <p className="iss-note">
        <b>어렵게 쓰지 않으셔도 됩니다.</b> 「이게 안 돼요」 한 줄이면 충분합니다.
        <br />
        올리면 이택진에게 알림이 갑니다.
      </p>
    </div>
  );
}
