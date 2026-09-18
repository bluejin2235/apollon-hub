"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type {
  PrimaryFlowStep,
  PrimaryNotionDbRow,
  PrimaryNotionPageRow,
  PrimaryNotionPayload
} from "@/lib/luna-admin/types";

type Props = { flow: PrimaryFlowStep[] | undefined };

export function LunaAdminPrimaryNotion({ flow }: Props) {
  const [data, setData] = useState<PrimaryNotionPayload | null>(null);
  const [error, setError] = useState("");
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [dbPage, setDbPage] = useState(1);
  const [method, setMethod] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams();
      if (dbId) qs.set("db", dbId);
      if (dbId) qs.set("page", String(page));
      if (pageId) qs.set("page_id", pageId);
      const json = await adminFetch<PrimaryNotionPayload>(
        `/api/luna-admin/primary/notion?${qs.toString()}`
      );
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [dbId, page, pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDb: PrimaryNotionDbRow | undefined = data?.dbs.find((d) => d.database_id === dbId);
  const selectedPage: PrimaryNotionPageRow | undefined = data?.pages.find((p) => p.page_id === pageId);
  const dbPageSize = 50;
  const dbRows = data ? data.dbs.slice((dbPage - 1) * dbPageSize, dbPage * dbPageSize) : [];
  const dbPages = data ? Math.max(1, Math.ceil(data.dbs.length / dbPageSize)) : 1;

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} /> : null}
      <div className="sech">
        <span className="t">DB별</span>
        <span className="n">{data ? `${data.db_count}개` : "—"}</span>
        <span className="sp" />
        <span className="a">연동 설정 →</span>
      </div>
      {error ? <p className="empty">{error}</p> : null}
      {!data && !error ? <p className="empty">불러오는 중…</p> : null}
      {data ? (
        <table>
          <thead>
            <tr>
              <th>DB</th>
              <th>경로</th>
              <th className="num">페이지</th>
              <th className="num">관계</th>
              <th>마지막 색인</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {dbRows.map((row) => (
              <tr
                key={row.database_id}
                className="clickable"
                style={dbId === row.database_id ? { background: "var(--luna-soft)" } : undefined}
                onClick={() => {
                  setDbId(row.database_id);
                  setPageId(null);
                  setPage(1);
                }}
              >
                <td>
                  <b>{row.name}</b>
                </td>
                <td className="mut">{row.path_label}</td>
                <td className="num">{row.pages.toLocaleString("ko-KR")}</td>
                <td className="num">{row.relations.toLocaleString("ko-KR")}</td>
                <td className="mut">{row.last_label}</td>
                <td>
                  {row.empty ? <span className="tag y">빈 DB</span> : <span className="mut">보기 →</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data && dbPages > 1 ? (
        <div className="sech">
          <span className="n">
            {dbPage}/{dbPages}
          </span>
          <span className="sp" />
          <button type="button" className="btn sm" disabled={dbPage <= 1} onClick={() => setDbPage((p) => p - 1)}>
            이전
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={dbPage >= dbPages}
            onClick={() => setDbPage((p) => p + 1)}
          >
            다음
          </button>
        </div>
      ) : null}

      {dbId && data && data.pages.length > 0 ? (
        <>
          <div className="sech">
            <span className="t">{selectedDb?.name ?? "페이지"}</span>
            <span className="n">{data.page_total.toLocaleString("ko-KR")}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>페이지</th>
                <th>경로</th>
                <th>마지막 색인</th>
              </tr>
            </thead>
            <tbody>
              {data.pages.map((row) => (
                <tr
                  key={row.page_id}
                  className="clickable"
                  style={pageId === row.page_id ? { background: "var(--luna-soft)" } : undefined}
                  onClick={() => setPageId(row.page_id)}
                >
                  <td>
                    <b>{row.title}</b>
                  </td>
                  <td className="mut">{row.path_label}</td>
                  <td className="mut">{row.last_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.page_total > data.page_size ? (
            <div className="sech">
              <span className="n">
                {data.page}/{Math.max(1, Math.ceil(data.page_total / data.page_size))}
              </span>
              <span className="sp" />
              <button
                type="button"
                className="btn sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                이전
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={page * data.page_size >= data.page_total}
                onClick={() => setPage((p) => p + 1)}
              >
                다음
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {pageId && data ? (
        <div className="peek" style={{ marginTop: 14 }}>
          <div className="ph">
            <span className="ic notion">N</span>
            <span className="t">{selectedPage?.title ?? "페이지"}</span>
            <button type="button" className="x" onClick={() => setPageId(null)}>
              ✕
            </button>
          </div>
          <div className="pb">
            {data.chunks.length === 0 ? <p className="empty">청크가 없습니다.</p> : null}
            {data.chunks.map((c) => (
              <div className="chunk" key={c.seq}>
                <div className="cn">
                  청크 {c.seq} / {data.chunk_total}
                  {c.heading ? ` · ${c.heading}` : ""}
                </div>
                <div className="ct">{c.content}</div>
              </div>
            ))}
            {data.chunk_total > data.chunks.length ? (
              <p style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 9 }}>
                {data.chunk_total}개 청크 중 {data.chunks.length}개를 보여줍니다
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="warn">
        <div className="c">
          <b>「하위 업무」 관계가 비어 있습니다.</b> 대상 DB 가 연동에 공유되지 않아 API 가
          relation: [] 로 줍니다.
          {method
            ? " 노션에서 Share → 「unlinked from parent page」 → Restore settings → Relink 하면 됩니다."
            : null}
        </div>
        <button type="button" className="bt" onClick={() => setMethod(true)}>
          방법 보기
        </button>
      </div>
    </div>
  );
}
