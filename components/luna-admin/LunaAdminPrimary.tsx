"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { PrimaryFlow } from "@/components/luna-admin/PrimaryFlow";
import { StatsBanner } from "@/components/luna-admin/StatsBanner";
import { KindCards } from "@/components/luna-admin/KindCards";
import { SourceGlossary } from "@/components/luna-admin/SourceGlossary";
import {
  GLOSSARY_GLOSSARY,
  NOTION_GLOSSARY,
  WIKI_GLOSSARY,
  WORK_GLOSSARY
} from "@/lib/luna-admin/source-glossary";
import type { PrimaryPayload } from "@/lib/luna-admin/types";
import type { LunaAdminPrimarySource, LunaAdminWorkKind } from "@/lib/luna-admin/nav";
import { lightEmoji } from "@/lib/luna-admin/traffic";
import { LunaAdminPrimaryWork } from "@/components/luna-admin/LunaAdminPrimaryWork";
import { LunaAdminPrimaryImage } from "@/components/luna-admin/LunaAdminPrimaryImage";
import { LunaAdminPrimaryNotion } from "@/components/luna-admin/LunaAdminPrimaryNotion";
import { PrimaryTrend } from "@/components/luna-admin/PrimaryTrend";
import { LunaKnowledgeWiki } from "@/components/luna/knowledge/LunaKnowledgeWiki";
import { LunaKnowledgeGlossary } from "@/components/luna/knowledge/LunaKnowledgeGlossary";

type SourceSlug = Exclude<LunaAdminPrimarySource, "image">;

type Props = {
  source: SourceSlug | null;
  workKind: LunaAdminWorkKind | null;
  onOpen: (source: SourceSlug, kind?: string) => void;
  onBack: () => void;
  onKind: (kind: LunaAdminWorkKind) => void;
};

const CARD_TONE: Record<SourceSlug, string> = {
  workserver: "work",
  notion: "notion",
  wiki: "wiki",
  glossary: "term"
};

const CARD_IC: Record<SourceSlug, string> = {
  workserver: "W",
  notion: "N",
  wiki: "위",
  glossary: "용"
};

export function LunaAdminPrimary({ source, workKind, onOpen, onKind }: Props) {
  const [data, setData] = useState<PrimaryPayload | null>(null);
  const [error, setError] = useState("");
  const [gloOpen, setGloOpen] = useState(false);
  const [gloFocus, setGloFocus] = useState<string | null>(null);

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

  function ask(id: string) {
    setGloFocus(id);
    setGloOpen(true);
  }

  if (source === "workserver") {
    const kind = workKind ?? "docs";
    return (
      <div>
        <StatsBanner stats={data?.stats} queryMs={data?.query_ms} />
        {data?.work_kinds ? (
          <KindCards
            cards={data.work_kinds}
            selected={kind}
            onSelect={(id) => onKind(id as LunaAdminWorkKind)}
            onAsk={ask}
          />
        ) : null}
        <SourceGlossary
          terms={WORK_GLOSSARY}
          open={gloOpen}
          focusId={gloFocus}
          onToggle={() => setGloOpen((v) => !v)}
        />
        {kind === "images" ? (
          <LunaAdminPrimaryImage flow={data?.image_flow} />
        ) : (
          <LunaAdminPrimaryWork kind={kind} onAsk={ask} />
        )}
      </div>
    );
  }

  if (source === "notion") {
    return (
      <div>
        <StatsBanner stats={data?.stats} queryMs={data?.query_ms} />
        {data?.notion_kinds ? (
          <KindCards cards={data.notion_kinds} cols={4} onAsk={ask} />
        ) : null}
        <SourceGlossary
          terms={NOTION_GLOSSARY}
          open={gloOpen}
          focusId={gloFocus}
          onToggle={() => setGloOpen((v) => !v)}
        />
        <LunaAdminPrimaryNotion flow={data?.notion_flow} dbs={data?.notion_dbs} onAsk={ask} />
      </div>
    );
  }

  if (source === "wiki") {
    return (
      <div>
        <StatsBanner stats={data?.stats} queryMs={data?.query_ms} />
        {data?.wiki_kinds ? <KindCards cards={data.wiki_kinds} cols={4} onAsk={ask} /> : null}
        <SourceGlossary
          terms={WIKI_GLOSSARY}
          open={gloOpen}
          focusId={gloFocus}
          onToggle={() => setGloOpen((v) => !v)}
        />
        {data?.wiki_flow ? <PrimaryFlow steps={data.wiki_flow} onAsk={ask} /> : null}
        <LunaKnowledgeWiki />
      </div>
    );
  }

  if (source === "glossary") {
    return (
      <div>
        <StatsBanner stats={data?.stats} queryMs={data?.query_ms} />
        {data?.glossary_kinds ? (
          <KindCards cards={data.glossary_kinds} cols={4} onAsk={ask} />
        ) : null}
        <SourceGlossary
          terms={GLOSSARY_GLOSSARY}
          open={gloOpen}
          focusId={gloFocus}
          onToggle={() => setGloOpen((v) => !v)}
        />
        {data?.glossary_flow ? <PrimaryFlow steps={data.glossary_flow} onAsk={ask} /> : null}
        <LunaKnowledgeGlossary />
      </div>
    );
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const cards = [data.work, data.notion, data.wiki, data.glossary];

  return (
    <>
      <StatsBanner stats={data.stats} queryMs={data.query_ms} />
      <div className="srcgrid c4">
        {cards.map((row) => {
          const slug = row.source === "image" ? "workserver" : (row.source as SourceSlug);
          const tone = CARD_TONE[slug];
          const deltaCls = row.delta != null && row.delta > 0 ? "up" : "flat";
          return (
            <button
              key={row.source}
              type="button"
              className={`src ${tone}`}
              onClick={() => onOpen(slug)}
            >
              <span className={`bar ${tone}`} />
              <div className="hd">
                <span className={`ic ${tone}`}>{CARD_IC[slug]}</span>
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
        })}
      </div>

      <PrimaryFlow steps={data.work_flow} caption="문서가 검색에 닿는 과정" onAsk={ask} />

      <PrimaryTrend />

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
