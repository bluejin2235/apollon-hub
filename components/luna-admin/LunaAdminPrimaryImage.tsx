"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type {
  PrimaryFlowStep,
  PrimaryImageChip,
  PrimaryImageListPayload,
  PrimaryImageRow
} from "@/lib/luna-admin/types";

type Props = { flow: PrimaryFlowStep[] | undefined };

const CHIPS: Array<{ id: PrimaryImageChip; label: string }> = [
  { id: "all", label: "전체" },
  { id: "reference", label: "레퍼런스" },
  { id: "ideation", label: "아이데이션" },
  { id: "kv", label: "KV" },
  { id: "source", label: "소스" }
];

export function LunaAdminPrimaryImage({ flow }: Props) {
  const [chip, setChip] = useState<PrimaryImageChip>("all");
  const [page, setPage] = useState(1);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [data, setData] = useState<PrimaryImageListPayload | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PrimaryImageRow | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({ chip, page: String(page) });
      if (mismatchOnly) qs.set("mismatch", "1");
      const json = await adminFetch<PrimaryImageListPayload>(
        `/api/luna-admin/primary/image?${qs}`
      );
      setData(json);
      setSelected((prev) => json.rows.find((r) => r.path === prev?.path) ?? json.rows[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [chip, page, mismatchOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} /> : null}
      <div className="sech">
        <span className="t">색인된 이미지</span>
        <span className="n">{data ? data.total.toLocaleString("ko-KR") : "—"}</span>
        <span className="sp" />
        <div className="chips">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={chip === c.id && !mismatchOnly ? "on" : ""}
              onClick={() => {
                setChip(c.id);
                setPage(1);
                setMismatchOnly(false);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="empty">{error}</p> : null}
      {!data && !error ? <p className="empty">불러오는 중…</p> : null}

      {selected ? (
        <div className="peek" style={{ marginTop: 4 }}>
          <div className="ph">
            <span className="ic img">📷</span>
            <span className="t">{selected.file_name}</span>
            <button type="button" className="x" onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          <div className="meta">
            <div>
              프로젝트 <b>{selected.project ?? "—"}</b>
            </div>
            <div>
              폴더 <b>{selected.folder}</b>
            </div>
            <div>
              크기 <b>{selected.size_label}</b> · {selected.resolution}
            </div>
            <div>
              색인 <b>{selected.indexed_label}</b>
            </div>
            <div>
              모델 <b>{selected.model ?? "—"}</b>
            </div>
          </div>
          <div className="pb">
            <div className="imgpeek">
              <div className="th">
                {selected.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.thumbnail_url} alt="" className="box" />
                ) : (
                  <div className="box" />
                )}
                <div className="cap">{selected.full_path}</div>
              </div>
              <div className="desc">
                <div className="dt">AI 가 읽은 것</div>
                <div className="dd">{selected.description || "—"}</div>
                <div className="dt">뽑힌 용어</div>
                <div className="terms">
                  {selected.terms.length === 0 ? (
                    <span className="mut">없음</span>
                  ) : (
                    selected.terms.map((t) => <span key={t}>{t}</span>)
                  )}
                </div>
              </div>
            </div>
            {data && data.mismatch_count > 0 ? (
              <div className="warn" style={{ marginTop: 14 }}>
                <div className="c">
                  <b>설명과 폴더가 안 맞는 이미지가 {data.mismatch_count}장 있습니다.</b>{" "}
                  {data.mismatch_sample}
                  {data.mismatch_sample ? ". " : " "}
                  AI 가 무엇을 찍은 것인지 모르고 쓴 경우로 보입니다.
                </div>
                <button
                  type="button"
                  className="bt"
                  onClick={() => {
                    setMismatchOnly(true);
                    setPage(1);
                  }}
                >
                  {data.mismatch_count}장 보기
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {data ? (
        <table>
          <thead>
            <tr>
              <th>파일</th>
              <th>프로젝트</th>
              <th>폴더</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const on = selected?.path === row.path;
              return (
                <tr
                  key={row.path}
                  className="clickable"
                  style={on ? { background: "var(--luna-soft)" } : undefined}
                  onClick={() => setSelected(row)}
                >
                  <td>
                    <b>{row.file_name}</b>
                  </td>
                  <td className="mut">{row.project ?? "—"}</td>
                  <td>
                    <span className="pa">{row.folder}</span>
                  </td>
                  <td className={on ? "" : "mut"} style={on ? { color: "var(--luna)", fontWeight: 700 } : undefined}>
                    {on ? "보는 중" : "보기 →"}
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
            {data.page}/{totalPages}
          </span>
          <span className="sp" />
          <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
    </div>
  );
}
