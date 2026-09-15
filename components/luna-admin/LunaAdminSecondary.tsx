"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { LunaKnowledgeTab } from "@/components/settings/luna-knowledge-tab";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

type Chip = "all" | "same" | "belongs" | "follows" | "criteria" | "perspective";

type LinkView = {
  id: string;
  kind: "same" | "belongs" | "follows";
  from_type_label: string;
  to_type_label: string;
  from_label: string;
  to_label: string;
  from_path: string;
  to_path: string;
  source: string;
  status: string;
  evidence: Record<string, unknown>;
};

type Perspective = {
  id: string;
  name: string;
  hit_count: number;
  used_count: number;
  status: string;
};

type Payload = {
  counts: {
    all: number;
    same: number;
    belongs: number;
    follows: number;
  };
  links: LinkView[];
  perspectives: Perspective[];
};

type Props = {
  onGo: (href: string) => void;
};

function belongsTree(row: LinkView): string {
  const kids = Array.isArray(row.evidence.children)
    ? (row.evidence.children as Array<{ label?: string; count?: number }>)
        .map((c) => `  ├ ${c.label ?? ""}          ${c.count ?? ""}건`)
        .join("\n")
    : "";
  return `${row.from_label.padEnd(38)}  ${row.from_type_label}\n${kids || `  └ ${row.to_label}`}`;
}

export function LunaAdminSecondary({ onGo }: Props) {
  const [chip, setChip] = useState<Chip>("all");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const kind =
        chip === "same" || chip === "belongs" || chip === "follows" ? chip : "";
      const q = kind ? `?kind=${kind}` : "";
      setData(await adminFetch<Payload>(`/api/luna-admin/links${q}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [chip]);

  useEffect(() => {
    if (chip === "criteria") return;
    void load();
  }, [chip, load]);

  if (chip === "criteria") {
    return (
      <>
        <ChipBar chip={chip} setChip={setChip} counts={data?.counts} persp={data?.perspectives.length ?? 0} />
        <LunaKnowledgeTab />
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        <ChipBar chip={chip} setChip={setChip} counts={undefined} persp={0} />
        <p className="empty">{error}</p>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <ChipBar chip={chip} setChip={setChip} counts={undefined} persp={0} />
        <p className="empty">불러오는 중…</p>
      </>
    );
  }

  const same = data.links.filter((l) => l.kind === "same");
  const belongs = data.links.filter((l) => l.kind === "belongs");
  const follows = data.links.filter((l) => l.kind === "follows");
  const showAll = chip === "all";

  return (
    <>
      <ChipBar
        chip={chip}
        setChip={setChip}
        counts={data.counts}
        persp={data.perspectives.length}
      />

      {chip === "perspective" ? (
        <>
          <div className="sech">
            <span className="t">관점</span>
            <span className="n">{data.perspectives.length}</span>
            <span className="sp" />
            {data.perspectives.length === 0 ? (
              <span className="n">아직 없음</span>
            ) : null}
          </div>
          {data.perspectives.length === 0 ? (
            <p className="empty">아직 관점이 없습니다.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>붙은 건수</th>
                  <th>검색</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.perspectives.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.hit_count}</td>
                    <td>{p.used_count}</td>
                    <td>{p.status === "active" ? "활성" : "시듦"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      {chip === "same" || showAll ? (
        <>
          <div className="sech">
            <span className="t">같은 것</span>
            <span className="n">{data.counts.same}</span>
            <span className="sp" />
            <button
              type="button"
              className="a"
              onClick={() => onGo(buildLunaAdminUrl("candidates", "pending"))}
            >
              확인 대기 →
            </button>
          </div>
          {same.length === 0 ? (
            <p className="empty">같은 것 연결이 없습니다.</p>
          ) : (
            same.map((row) => (
              <div className="pair" key={row.id}>
                <div className="side">
                  <div className="s">{row.from_type_label}</div>
                  <div className="t">{row.from_label}</div>
                  {row.from_path ? <div className="m">{row.from_path}</div> : null}
                </div>
                <div className="mid">=</div>
                <div className="side">
                  <div className="s">{row.to_type_label}</div>
                  <div className="t">{row.to_label}</div>
                  {row.to_path ? <div className="m">{row.to_path}</div> : null}
                </div>
                <div style={{ display: "grid", placeItems: "center", paddingLeft: 6 }}>
                  <span className="tag g">
                    {row.source === "human" ? "사람 확인" : "자동"}
                  </span>
                </div>
              </div>
            ))
          )}
        </>
      ) : null}

      {chip === "belongs" || showAll ? (
        <>
          <div className="sech">
            <span className="t">속한 것</span>
            <span className="n">{data.counts.belongs}</span>
          </div>
          {belongs.length === 0 ? (
            <p className="empty">속한 것 연결이 없습니다.</p>
          ) : (
            belongs.map((row) => (
              <div className="tree" key={row.id}>
                {belongsTree(row)}
              </div>
            ))
          )}
        </>
      ) : null}

      {chip === "follows" || showAll ? (
        <>
          <div className="sech">
            <span className="t">이어진 것</span>
            <span className="n">{data.counts.follows}</span>
          </div>
          {follows.length === 0 ? (
            <p className="empty">이어진 것 연결이 없습니다.</p>
          ) : (
            follows.map((row) => (
              <div className="row" key={row.id}>
                <span className="ic b">→</span>
                <div className="c">
                  <div className="t">
                    {row.from_label} → {row.to_label}
                  </div>
                  <div className="d">
                    {row.from_type_label}에서 {row.to_type_label}로
                  </div>
                </div>
                <span className="rt">{row.source === "human" ? "사람" : "자동"}</span>
              </div>
            ))
          )}
        </>
      ) : null}
    </>
  );
}

function ChipBar({
  chip,
  setChip,
  counts,
  persp
}: {
  chip: Chip;
  setChip: (c: Chip) => void;
  counts?: Payload["counts"];
  persp: number;
}) {
  const items: { key: Chip; label: string }[] = [
    { key: "all", label: `전체 ${counts?.all ?? 0}` },
    { key: "same", label: `같은 것 ${counts?.same ?? 0}` },
    { key: "belongs", label: `속한 것 ${counts?.belongs ?? 0}` },
    { key: "follows", label: `이어진 것 ${counts?.follows ?? 0}` },
    { key: "criteria", label: "판단 기준" },
    { key: "perspective", label: `관점 ${persp}` }
  ];
  return (
    <div className="chips">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={chip === item.key ? "on" : ""}
          onClick={() => setChip(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
