"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PeriodBar } from "@/components/luna-admin/PeriodBar";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type { PeriodKey } from "@/lib/luna-admin/period";
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
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PrimaryImageListPayload | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PrimaryImageRow | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({ chip, page: String(page), period });
      if (period === "custom") {
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
      }
      setData(await adminFetch<PrimaryImageListPayload>(`/api/luna-admin/primary/image?${qs}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [chip, page, period, from, to]);

  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [chip, period, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      {flow ? <PrimaryFlow steps={flow} /> : null}
      <PeriodBar
        period={period}
        from={from}
        to={to}
        total={data?.total}
        extra={
          <div className="chips">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={chip === c.id ? "on" : ""}
                onClick={() => setChip(c.id)}
              >
                {c.label}
              </button>
            ))}
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
      {!data && !error ? <p className="empty">불러오는 중…</p> : null}

      {data ? (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>파일</th>
                <th>프로젝트</th>
                <th>폴더</th>
                <th className="num">해상도</th>
                <th className="num">크기</th>
                <th className="num">용어</th>
                <th>색인</th>
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
                    <td className="num">{row.resolution}</td>
                    <td className="num">{row.size_label}</td>
                    <td className="num">{row.terms.length}</td>
                    <td className="mut">{row.indexed_label}</td>
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

      {selected ? (
        <div className="peek">
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
              {selected.resolution} · <b>{selected.size_label}</b>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
