"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PeriodBar } from "@/components/luna-admin/PeriodBar";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type { PeriodKey } from "@/lib/luna-admin/period";
import type {
  PrimaryFlowStep,
  PrimaryWorkFileRow,
  PrimaryWorkKind,
  PrimaryWorkListPayload,
  PrimaryWorkPreviewPayload,
  PrimaryWorkSort
} from "@/lib/luna-admin/types";

type Props = {
  flow?: PrimaryFlowStep[];
  kind: PrimaryWorkKind;
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
  id: PrimaryWorkSort;
  label: string;
  sort: PrimaryWorkSort;
  dir: "asc" | "desc";
  numeric?: boolean;
  onSort: (id: PrimaryWorkSort) => void;
}) {
  const arrow = sort === id ? (dir === "asc" ? "↑" : "↓") : "↕";
  return (
    <th className={numeric ? "num" : undefined} onClick={() => onSort(id)}>
      {label} <span className="ar">{arrow}</span>
    </th>
  );
}

export function LunaAdminPrimaryWork({ flow, kind, onAsk }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<PrimaryWorkSort>("indexed");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PrimaryWorkListPayload | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PrimaryWorkFileRow | null>(null);
  const [preview, setPreview] = useState<PrimaryWorkPreviewPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({
        kind,
        period,
        sort,
        dir,
        page: String(page)
      });
      if (period === "custom") {
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
      }
      setData(await adminFetch<PrimaryWorkListPayload>(`/api/luna-admin/primary/work?${qs}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [kind, period, from, to, sort, dir, page]);

  useEffect(() => {
    setPage(1);
    setSelected(null);
    setPreview(null);
  }, [kind, period, from, to, sort, dir]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openRow(row: PrimaryWorkFileRow, all = false) {
    setSelected(row);
    if (row.status !== "ok") {
      setPreview(null);
      return;
    }
    setPreviewBusy(true);
    try {
      const qs = new URLSearchParams({ path: row.path });
      if (all) qs.set("all", "1");
      setPreview(
        await adminFetch<PrimaryWorkPreviewPayload>(
          `/api/luna-admin/primary/work/preview?${qs.toString()}`
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "미리보기 실패");
    } finally {
      setPreviewBusy(false);
    }
  }

  function changeSort(next: PrimaryWorkSort) {
    if (sort === next) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setDir(next === "file" || next === "path" ? "asc" : "desc");
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const dirKind = kind === "folders" || kind === "files";

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} onAsk={onAsk} /> : null}

      <PeriodBar
        period={period}
        from={from}
        to={to}
        total={data?.total}
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
      {!data && !error ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <SortTh id="file" label={dirKind && kind === "folders" ? "경로" : "파일"} sort={sort} dir={dir} onSort={changeSort} />
                <SortTh id="path" label="경로" sort={sort} dir={dir} onSort={changeSort} />
                {dirKind ? (
                  <>
                    <SortTh id="size" label="크기" sort={sort} dir={dir} numeric onSort={changeSort} />
                    <SortTh id="modified" label="수정" sort={sort} dir={dir} onSort={changeSort} />
                  </>
                ) : (
                  <>
                    <SortTh id="chunks" label="청크" sort={sort} dir={dir} numeric onSort={changeSort} />
                    <SortTh id="chars" label="글자" sort={sort} dir={dir} numeric onSort={changeSort} />
                    <SortTh id="size" label="크기" sort={sort} dir={dir} numeric onSort={changeSort} />
                    <SortTh id="modified" label="수정" sort={sort} dir={dir} onSort={changeSort} />
                    <SortTh id="indexed" label="색인" sort={sort} dir={dir} onSort={changeSort} />
                    <th>상태</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const on = selected?.path === row.path && selected.drive === row.drive;
                return (
                  <tr
                    key={`${row.drive}:${row.path}`}
                    className="clickable"
                    style={on ? { background: "var(--luna-soft)" } : undefined}
                    onClick={() => void openRow(row)}
                  >
                    <td>
                      <b>{row.file_name}</b>
                    </td>
                    <td>
                      <span className="pa">{row.folder}</span>
                    </td>
                    {dirKind ? (
                      <>
                        <td className="num">{row.size_label}</td>
                        <td className="mut">{row.modified_label}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">
                          {row.chunk_count == null ? (
                            <span className="mut">—</span>
                          ) : (
                            row.chunk_count.toLocaleString("ko-KR")
                          )}
                        </td>
                        <td className="num">
                          {row.text_length == null ? (
                            <span className="mut">—</span>
                          ) : (
                            row.text_length.toLocaleString("ko-KR")
                          )}
                        </td>
                        <td className="num">{row.size_label}</td>
                        <td className="mut">{row.modified_label}</td>
                        <td className="mut">{row.extracted_label}</td>
                        <td>
                          <span className={`tag ${row.tag_kind}`}>{row.tag}</span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? (
        <div className="pager">
          <span className="info">
            <b>{(data.page - 1) * data.page_size + 1}</b>–
            <b>{Math.min(data.page * data.page_size, data.total)}</b> / {data.total.toLocaleString("ko-KR")}건
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
      ) : null}

      {selected && selected.status === "ok" ? (
        <div className="peek">
          <div className="ph">
            <span className="ic work">본</span>
            <span className="t">{selected.file_name}</span>
            <button
              type="button"
              className="x"
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              ✕
            </button>
          </div>
          <div className="meta">
            <div>
              경로 <b>{selected.folder}</b>
            </div>
            <div>
              크기 <b>{selected.size_label}</b>
            </div>
            <div>
              수정 <b>{selected.modified_label}</b>
            </div>
            <div>
              색인 <b>{selected.extracted_label}</b>
            </div>
            <div>
              청크 <b>{selected.chunk_count?.toLocaleString("ko-KR") ?? "—"}</b>
            </div>
            <div>
              글자 <b>{selected.text_length?.toLocaleString("ko-KR") ?? "—"}</b>
            </div>
          </div>
          <div className="pb">
            {previewBusy && !preview ? <p className="empty">청크를 불러오는 중…</p> : null}
            {preview?.chunks.map((chunk) => (
              <div className="chunk" key={chunk.seq}>
                <div className="cn">
                  청크 {chunk.seq} / {preview.total_chunks} · {chunk.range_label}
                </div>
                <div className="ct">{chunk.content}</div>
              </div>
            ))}
            {preview && preview.total_chunks > preview.shown ? (
              <p style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 9 }}>
                {preview.total_chunks}개 청크 중 {preview.shown}개 ·{" "}
                <button type="button" className="a" onClick={() => selected && void openRow(selected, true)}>
                  전체 보기
                </button>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
