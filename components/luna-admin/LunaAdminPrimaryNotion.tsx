"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PeriodBar } from "@/components/luna-admin/PeriodBar";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type { PeriodKey } from "@/lib/luna-admin/period";
import type {
  PrimaryFlowStep,
  PrimaryNotionDbRow,
  PrimaryNotionPageRow,
  PrimaryNotionPayload,
  PrimaryNotionSort,
  PrimaryNotionView
} from "@/lib/luna-admin/types";

type Props = {
  flow: PrimaryFlowStep[] | undefined;
  dbs?: PrimaryNotionDbRow[];
  onAsk?: (id: string) => void;
};

function SortTh({
  id,
  label,
  sort,
  dir,
  numeric,
  onSort
}: {
  id: PrimaryNotionSort;
  label: string;
  sort: PrimaryNotionSort;
  dir: "asc" | "desc";
  numeric?: boolean;
  onSort: (id: PrimaryNotionSort) => void;
}) {
  const arrow = sort === id ? (dir === "asc" ? "↑" : "↓") : "↕";
  return (
    <th className={numeric ? "num" : undefined} onClick={() => onSort(id)}>
      {label} <span className="ar">{arrow}</span>
    </th>
  );
}

export function LunaAdminPrimaryNotion({ flow, dbs: snapDbs, onAsk }: Props) {
  const [view, setView] = useState<PrimaryNotionView>("pages");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<PrimaryNotionSort>("indexed");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [allChunks, setAllChunks] = useState(false);
  const [showRels, setShowRels] = useState(false);
  const [data, setData] = useState<PrimaryNotionPayload | null>(null);
  const [error, setError] = useState("");
  const [method, setMethod] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({
        view,
        period,
        sort,
        dir,
        page: String(page)
      });
      if (period === "custom") {
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
      }
      if (dbId) qs.set("db", dbId);
      if (pageId) qs.set("page_id", pageId);
      if (allChunks) qs.set("all", "1");
      setData(await adminFetch<PrimaryNotionPayload>(`/api/luna-admin/primary/notion?${qs}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [view, period, from, to, sort, dir, page, dbId, pageId, allChunks]);

  useEffect(() => {
    setPage(1);
    setPageId(null);
  }, [view, period, from, to, sort, dir, dbId]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeSort(next: PrimaryNotionSort) {
    if (sort === next) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setDir(next === "title" || next === "db" ? "asc" : "desc");
    }
  }

  const selectedPage: PrimaryNotionPageRow | undefined = data?.pages.find((p) => p.page_id === pageId);
  const dbs = (data?.dbs.length ? data.dbs : snapDbs) ?? [];
  const dbPageSize = 15;
  const dbPage = page;
  const dbRows = dbs.slice((dbPage - 1) * dbPageSize, dbPage * dbPageSize);
  const dbPages = Math.max(1, Math.ceil(dbs.length / dbPageSize));
  const totalPages =
    view === "dbs" ? dbPages : data ? Math.max(1, Math.ceil(data.page_total / data.page_size)) : 1;
  const listTotal = view === "dbs" ? dbs.length : data?.page_total ?? 0;

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} onAsk={onAsk} /> : null}

      <PeriodBar
        period={period}
        from={from}
        to={to}
        total={listTotal}
        extra={
          <div className="chips">
            <button type="button" className={view === "pages" ? "on" : ""} onClick={() => setView("pages")}>
              페이지
            </button>
            <button type="button" className={view === "dbs" ? "on" : ""} onClick={() => setView("dbs")}>
              DB별
            </button>
          </div>
        }
        onPeriod={(key) => {
          setPeriod(key);
          if (key !== "custom") {
            setFrom("");
            setTo("");
          }
        }}
        onRange={(a, b) => {
          setFrom(a);
          setTo(b);
          setPeriod("custom");
        }}
      />

      {error ? <p className="empty">{error}</p> : null}
      {!data && !error && view === "pages" ? <p className="empty">불러오는 중…</p> : null}

      {view === "dbs" ? (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>DB</th>
                <th>경로</th>
                <th className="num">페이지</th>
                <th>마지막 색인</th>
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
                    setView("pages");
                    setPage(1);
                  }}
                >
                  <td>
                    <b>{row.name}</b>
                  </td>
                  <td className="mut">{row.path_label}</td>
                  <td className="num">{row.pages.toLocaleString("ko-KR")}</td>
                  <td className="mut">{row.last_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : data ? (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <SortTh id="title" label="제목" sort={sort} dir={dir} onSort={changeSort} />
                <SortTh id="db" label="DB" sort={sort} dir={dir} onSort={changeSort} />
                <SortTh id="blocks" label="블록" sort={sort} dir={dir} numeric onSort={changeSort} />
                <SortTh id="chunks" label="청크" sort={sort} dir={dir} numeric onSort={changeSort} />
                <SortTh id="rels" label="관계" sort={sort} dir={dir} numeric onSort={changeSort} />
                <SortTh id="edited" label="수정" sort={sort} dir={dir} onSort={changeSort} />
                <SortTh id="indexed" label="색인" sort={sort} dir={dir} onSort={changeSort} />
              </tr>
            </thead>
            <tbody>
              {data.pages.map((row) => (
                <tr
                  key={row.page_id}
                  className="clickable"
                  style={pageId === row.page_id ? { background: "var(--luna-soft)" } : undefined}
                  onClick={() => {
                    setPageId(row.page_id);
                    setAllChunks(false);
                    setShowRels(false);
                  }}
                >
                  <td>
                    <b>{row.title}</b>
                  </td>
                  <td className="mut">{row.db_name}</td>
                  <td className="num">{row.block_count.toLocaleString("ko-KR")}</td>
                  <td className="num">{row.chunk_count.toLocaleString("ko-KR")}</td>
                  <td className="num">{row.rel_count.toLocaleString("ko-KR")}</td>
                  <td className="mut">{row.edited_label}</td>
                  <td className="mut">{row.last_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="pager">
        <span className="info">
          <b>{(page - 1) * 15 + 1}</b>–<b>{Math.min(page * 15, listTotal)}</b> / {listTotal.toLocaleString("ko-KR")}건
        </span>
        <span className="sp" />
        <div className="pg">
          <button type="button" className={page <= 1 ? "off" : ""} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹
          </button>
          <button type="button" className="on">
            {page}
          </button>
          <button
            type="button"
            className={page >= totalPages ? "off" : ""}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            ›
          </button>
        </div>
        <span className="per">15개씩</span>
      </div>

      {pageId && data ? (
        <div className="peek">
          <div className="ph">
            <span className="ic notion">N</span>
            <span className="t">{selectedPage?.title ?? "페이지"}</span>
            <button type="button" className="x" onClick={() => setPageId(null)}>
              ✕
            </button>
          </div>
          <div className="meta">
            <div>
              DB <b>{selectedPage?.db_name ?? "—"}</b>
            </div>
            <div>
              경로 <b>{selectedPage?.path_label ?? "—"}</b>
            </div>
            <div>
              블록 <b>{selectedPage?.block_count.toLocaleString("ko-KR") ?? "—"}</b>
            </div>
            <div>
              청크 <b>{data.chunk_total.toLocaleString("ko-KR")}</b>
            </div>
            <div>
              관계 <b>{data.relations.length.toLocaleString("ko-KR")}</b>
            </div>
            <div>
              색인 <b>{selectedPage?.last_label ?? "—"}</b>
            </div>
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
                {data.chunk_total}개 청크 중 {data.chunks.length}개 ·{" "}
                <button type="button" className="a" onClick={() => setAllChunks(true)}>
                  전체 보기
                </button>
                {data.relations.length > 0 ? (
                  <>
                    {" "}
                    · 관계 {data.relations.length}건 ·{" "}
                    <button type="button" className="a" onClick={() => setShowRels((v) => !v)}>
                      {showRels ? "숨기기" : "보기"}
                    </button>
                  </>
                ) : null}
              </p>
            ) : data.relations.length > 0 ? (
              <p style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 9 }}>
                관계 {data.relations.length}건 ·{" "}
                <button type="button" className="a" onClick={() => setShowRels((v) => !v)}>
                  {showRels ? "숨기기" : "보기"}
                </button>
              </p>
            ) : null}
            {showRels
              ? data.relations.map((r) => (
                  <div className="chunk" key={`${r.page_id}-${r.property_name}`}>
                    <div className="cn">{r.property_name}</div>
                    <div className="ct">{r.title}</div>
                  </div>
                ))
              : null}
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
