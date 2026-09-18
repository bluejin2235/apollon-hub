"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import type { PrimaryPayload, PrimarySourceRow } from "@/lib/luna-admin/types";
import type { LunaAdminPrimarySource } from "@/lib/luna-admin/nav";
import { lightEmoji } from "@/lib/luna-admin/traffic";
import { LunaKnowledgeWorkserver } from "@/components/luna/knowledge/LunaKnowledgeWorkserver";
import { LunaKnowledgeNotion } from "@/components/luna/knowledge/LunaKnowledgeNotion";
import { LunaKnowledgeWiki } from "@/components/luna/knowledge/LunaKnowledgeWiki";
import { LunaKnowledgeGlossary } from "@/components/luna/knowledge/LunaKnowledgeGlossary";

type Props = {
  source: LunaAdminPrimarySource | null;
  onOpen: (source: LunaAdminPrimarySource) => void;
  onBack: () => void;
};

const CARD_TONE: Record<LunaAdminPrimarySource, string> = {
  workserver: "work",
  notion: "notion",
  image: "img",
  wiki: "wiki",
  glossary: "term"
};

const CARD_IC: Record<LunaAdminPrimarySource, string> = {
  workserver: "W",
  notion: "N",
  image: "📷",
  wiki: "위",
  glossary: "용"
};

function SourceCard({
  row,
  onOpen
}: {
  row: PrimarySourceRow;
  onOpen: (source: LunaAdminPrimarySource) => void;
}) {
  const tone = CARD_TONE[row.source];
  const deltaCls =
    row.delta != null && row.delta > 0 ? "up" : "flat";
  return (
    <button
      type="button"
      className={`src ${tone}`}
      onClick={() => onOpen(row.source)}
    >
      <span className={`bar ${tone}`} />
      <div className="hd">
        <span className={`ic ${tone}`}>{CARD_IC[row.source]}</span>
        <span className="nm">{row.label}</span>
        <span className="lamp">{lightEmoji(row.status)}</span>
      </div>
      <div className="v">
        {row.count.toLocaleString("ko-KR")}
        {row.unit ? <span className="u">{row.unit}</span> : null}
      </div>
      <div className="d">{row.note}</div>
      <div className={`delta ${deltaCls}`}>{row.delta_label}</div>
    </button>
  );
}

export function LunaAdminPrimary({ source, onOpen }: Props) {
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
        {source === "workserver" ? (
          <>
            {data?.work_flow ? <PrimaryFlow steps={data.work_flow} /> : null}
            <LunaKnowledgeWorkserver />
          </>
        ) : null}
        {source === "notion" ? <LunaKnowledgeNotion /> : null}
        {source === "wiki" ? <LunaKnowledgeWiki /> : null}
        {source === "glossary" ? <LunaKnowledgeGlossary /> : null}
        {source === "image" ? (
          <p className="empty">
            이미지 전체 색인은 이번에 하지 않습니다. 증분 색인만 야간 01:00 에 둘 자리입니다.
            {data?.image ? ` 현재 ${data.image.size_label} · 마지막 ${data.image.last_label}` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const cards = [data.work, data.notion, data.image, data.wiki, data.glossary];

  return (
    <>
      <div className="srcgrid">
        {cards.map((row) => (
          <SourceCard key={row.source} row={row} onOpen={onOpen} />
        ))}
      </div>

      <PrimaryFlow steps={data.work_flow} caption="문서가 검색에 닿는 과정" />

      <div className="g2">
        <div>
          <div className="bt2">약속대로 도나</div>
          {data.checks.map((row) => (
            <div className="sr" key={row.id}>
              <span className="nm">
                {row.name} <span className="mut">{row.schedule_label}</span>
              </span>
              <span className="v">{row.last_label}</span>
              <span className={`tag ${row.status === "green" ? "g" : row.status === "yellow" ? "y" : "r"}`}>
                {row.status_label}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="bt2">차지하는 용량</div>
          {data.storage.map((row) => (
            <div className="sr" key={row.name}>
              <span className="nm">{row.name}</span>
              <span className="mini">
                <i style={{ background: row.color, width: `${row.bar_pct}%` }} />
              </span>
              <span className="v">{row.bytes_label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
