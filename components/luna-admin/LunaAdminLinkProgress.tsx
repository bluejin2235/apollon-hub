"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { LinkProgressPayload } from "@/lib/luna-admin/types";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

type Props = {
  onGo: (href: string) => void;
};

export function LunaAdminLinkProgress({ onGo }: Props) {
  const [data, setData] = useState<LinkProgressPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await adminFetch<LinkProgressPayload>("/api/luna-admin/link-progress"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="l">전체 진행률</div>
          <div className="v">
            {data.overall_pct}
            <span className="u">%</span>
          </div>
        </div>
        <div className="card g">
          <div className="l">자동 확정</div>
          <div className="v">{data.auto}</div>
          <div className="m">확신도 0.7 이상</div>
        </div>
        <div className="card y">
          <div className="l">물어볼 것</div>
          <div className="v">{data.ask}</div>
          <div className="m">지식후보로</div>
        </div>
        <div className="card">
          <div className="l">보류</div>
          <div className="v">{data.hold}</div>
          <div className="m">근거 부족</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>연도</th>
            <th>프로젝트</th>
            <th>노션</th>
            <th>이미지</th>
            <th>진행</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.years.map((row) => (
            <tr key={row.year}>
              <td>
                <b>{row.year}</b>
              </td>
              <td>{row.projects || "—"}</td>
              <td>{row.notion || "—"}</td>
              <td>{row.images}</td>
              <td style={{ width: 130 }}>
                <div className="bar">
                  <i
                    className={row.status === "done" ? "g" : ""}
                    style={{ width: `${row.progress_pct}%` }}
                  />
                </div>
              </td>
              <td>
                <span
                  className={`tag ${
                    row.status === "done" ? "g" : row.status === "tonight" ? "p" : "gray"
                  }`}
                >
                  {row.status_label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.ask > 0 ? (
        <>
          <div className="sech">
            <span className="t">막힌 것</span>
            <span className="n">{data.ask}</span>
            <span className="sp" />
            <button
              type="button"
              className="a"
              onClick={() => onGo(buildLunaAdminUrl("candidates", "pending"))}
            >
              지식후보에서 답하기 →
            </button>
          </div>
          <div className="row">
            <span className="ic y">?</span>
            <div className="c">
              <div className="t">이름이 달라 같은 건인지 판단 불가</div>
              <div className="d">블루진이 답하면 다음부터 같은 규칙으로 처리합니다.</div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
