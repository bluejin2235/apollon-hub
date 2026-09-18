"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type {
  PrimaryFlowStep,
  PrimaryWorkChip,
  PrimaryWorkFileRow,
  PrimaryWorkListPayload,
  PrimaryWorkPreviewPayload
} from "@/lib/luna-admin/types";

type Props = {
  flow: PrimaryFlowStep[] | undefined;
};

const CHIPS: Array<{ id: PrimaryWorkChip; label: string }> = [
  { id: "all", label: "전체" },
  { id: "pdf", label: "pdf" },
  { id: "pptx", label: "pptx" },
  { id: "xlsx", label: "xlsx" },
  { id: "docx", label: "docx" },
  { id: "unread", label: "못 읽음" }
];

function chipLabel(id: PrimaryWorkChip, counts: PrimaryWorkListPayload["chip_counts"] | null): string {
  const base = CHIPS.find((c) => c.id === id)?.label ?? id;
  if (!counts) return base;
  if (id === "all") return base;
  return `${base} ${counts[id].toLocaleString("ko-KR")}`;
}

export function LunaAdminPrimaryWork({ flow }: Props) {
  const [chip, setChip] = useState<PrimaryWorkChip>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PrimaryWorkListPayload | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PrimaryWorkFileRow | null>(null);
  const [preview, setPreview] = useState<PrimaryWorkPreviewPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const load = useCallback(async (nextChip: PrimaryWorkChip, nextPage: number) => {
    try {
      setError("");
      const json = await adminFetch<PrimaryWorkListPayload>(
        `/api/luna-admin/primary/work?chip=${nextChip}&page=${nextPage}`
      );
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load(chip, page);
  }, [load, chip, page]);

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
      const json = await adminFetch<PrimaryWorkPreviewPayload>(
        `/api/luna-admin/primary/work/preview?${qs.toString()}`
      );
      setPreview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "미리보기 실패");
    } finally {
      setPreviewBusy(false);
    }
  }

  function changeChip(next: PrimaryWorkChip) {
    setChip(next);
    setPage(1);
    setSelected(null);
    setPreview(null);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const unreadN = data?.chip_counts.unread ?? 0;
  const failedN = data?.failed_opaque ?? 0;

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} /> : null}

      <div className="sech">
        <span className="t">{chip === "unread" ? "못 읽은 파일" : "본문이 색인된 파일"}</span>
        <span className="n">{data ? data.total.toLocaleString("ko-KR") : "—"}</span>
        <span className="sp" />
        <div className="chips">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={chip === c.id ? "on" : ""}
              onClick={() => changeChip(c.id)}
            >
              {chipLabel(c.id, data?.chip_counts ?? null)}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="empty">{error}</p> : null}
      {!data && !error ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <table>
          <thead>
            <tr>
              <th>파일</th>
              <th>경로</th>
              <th className="num">청크</th>
              <th className="num">글자</th>
              <th>추출</th>
              <th />
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
                  <td className="num">
                    {row.chunk_count == null ? <span className="mut">—</span> : row.chunk_count.toLocaleString("ko-KR")}
                  </td>
                  <td className="num">
                    {row.text_length == null ? <span className="mut">—</span> : row.text_length.toLocaleString("ko-KR")}
                  </td>
                  <td>
                    <span className={`tag ${row.tag_kind}`}>{row.tag}</span>
                  </td>
                  <td className={on ? "" : "mut"} style={on ? { color: "var(--luna)", fontWeight: 700 } : undefined}>
                    {on && row.status === "ok" ? "보는 중" : row.action_label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {data && totalPages > 1 ? (
        <div className="sech">
          <span className="n">
            {(data.page - 1) * data.page_size + 1}–
            {Math.min(data.page * data.page_size, data.total)} / {data.total.toLocaleString("ko-KR")}
          </span>
          <span className="sp" />
          <button
            type="button"
            className="btn sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            다음
          </button>
        </div>
      ) : null}

      {selected && selected.status === "ok" ? (
        <>
          <div className="sech">
            <span className="t">{selected.file_name}</span>
            <span className="sp" />
          </div>
          <div className="peek">
            <div className="ph">
              <span className="ic work" style={{ width: 20, height: 20 }}>
                W
              </span>
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
                추출 <b>{selected.extracted_label}</b>
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
                  {preview.total_chunks}개 청크 중 {preview.shown}개를 보여줍니다 ·{" "}
                  <button
                    type="button"
                    className="a"
                    style={{
                      color: "var(--luna)",
                      fontWeight: 700,
                      background: "none",
                      border: 0,
                      cursor: "pointer",
                      padding: 0
                    }}
                    onClick={() => selected && void openRow(selected, true)}
                  >
                    전체 보기
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {unreadN > 0 && failedN > 0 ? (
        <div className="warn">
          <div className="c">
            <b>
              못 읽은 {unreadN.toLocaleString("ko-KR")}건 중 실패 {failedN.toLocaleString("ko-KR")}건은 원인이 기록되지
              않았습니다.
            </b>{" "}
            에러가 [object Object]로만 남아 무엇이 문제인지 알 수 없습니다.
          </div>
          <button type="button" className="bt" onClick={() => changeChip("unread")}>
            확인하기
          </button>
        </div>
      ) : null}
    </div>
  );
}
