"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { PrimaryPayload, PrimarySourceRow } from "@/lib/luna-admin/types";
import type { LunaAdminPrimarySource } from "@/lib/luna-admin/nav";
import { LunaKnowledgeWorkserver } from "@/components/luna/knowledge/LunaKnowledgeWorkserver";
import { LunaKnowledgeNotion } from "@/components/luna/knowledge/LunaKnowledgeNotion";
import { LunaKnowledgeWiki } from "@/components/luna/knowledge/LunaKnowledgeWiki";
import { LunaKnowledgeGlossary } from "@/components/luna/knowledge/LunaKnowledgeGlossary";

type Props = {
  source: LunaAdminPrimarySource | null;
  onOpen: (source: LunaAdminPrimarySource) => void;
  onBack: () => void;
};

function Tag({ row }: { row: PrimarySourceRow }) {
  const cls = row.status === "green" ? "g" : row.status === "yellow" ? "y" : "r";
  return <span className={`tag ${cls}`}>{row.status_label}</span>;
}

export function LunaAdminPrimary({ source, onOpen, onBack }: Props) {
  const [data, setData] = useState<PrimaryPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await adminFetch<PrimaryPayload>("/api/luna-admin/primary"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (source) {
    return (
      <div>
        <button type="button" className="btn sm" onClick={onBack} style={{ marginBottom: 12 }}>
          ← 원천별 상세
        </button>
        {source === "workserver" ? <LunaKnowledgeWorkserver /> : null}
        {source === "notion" ? <LunaKnowledgeNotion /> : null}
        {source === "wiki" ? <LunaKnowledgeWiki /> : null}
        {source === "glossary" ? <LunaKnowledgeGlossary /> : null}
        {source === "image" ? (
          <p className="empty">
            이미지 전체 색인은 이번에 하지 않습니다. 증분 색인만 야간 04:00 에 둘 자리입니다.
            {data?.image ? ` 현재 ${data.image.size_label} · 마지막 ${data.image.last_label}` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const cards = [data.work, data.notion, data.image, data.wiki];

  return (
    <>
      <div className="cards">
        {cards.map((row) => (
          <div key={row.source} className={`card ${row.status === "yellow" ? "y" : ""}`}>
            <div className="l">{row.label}</div>
            <div className="v">
              {row.count.toLocaleString("ko-KR")}
              {row.source === "wiki" && data.glossary.count ? (
                <span className="u">· {data.glossary.count}</span>
              ) : null}
            </div>
            <div className="m">{row.note}</div>
          </div>
        ))}
      </div>

      <div className="sech">
        <span className="t">원천별 상세</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>원천</th>
            <th>규모</th>
            <th>색인 주기</th>
            <th>마지막</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr
              key={row.source}
              className="clickable"
              onClick={() => onOpen(row.source)}
            >
              <td>{row.label}</td>
              <td>{row.size_label}</td>
              <td>{row.schedule_label}</td>
              <td>{row.last_label}</td>
              <td>
                <Tag row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
