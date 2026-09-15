"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { LunaKnowledgeTab } from "@/components/settings/luna-knowledge-tab";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

type Chip = "all" | "same" | "belongs" | "follows" | "criteria" | "perspective";
type SameFilter = "all" | "need" | "confirmed" | "rejected";

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
  confidence: number;
  reason?: string;
  evidence: Record<string, unknown>;
};

type Perspective = {
  id: string;
  name: string;
  hit_count: number;
  used_count: number;
  status: string;
};

type SameCounts = {
  all: number;
  need: number;
  confirmed: number;
  rejected: number;
};

type Payload = {
  counts: {
    all: number;
    same: number;
    belongs: number;
    follows: number;
  };
  same_counts?: SameCounts;
  links: LinkView[];
  perspectives: Perspective[];
};

type UndoSnap = { id: string; status: "active" | "pending" | "rejected"; source: string };

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
  const [sameFilter, setSameFilter] = useState<SameFilter>("need");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; undo: UndoSnap[] } | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const sameCounts = data?.same_counts ?? {
    all: 0,
    need: 0,
    confirmed: 0,
    rejected: 0
  };

  const sameRows = useMemo(() => {
    const rows = (data?.links ?? []).filter((l) => l.kind === "same");
    if (chip !== "same") {
      return rows.filter((r) => r.status !== "rejected");
    }
    if (sameFilter === "need") {
      return rows.filter((r) => r.source !== "human" && r.status !== "rejected");
    }
    if (sameFilter === "confirmed") return rows.filter((r) => r.source === "human");
    if (sameFilter === "rejected") return rows.filter((r) => r.status === "rejected");
    return rows.filter((r) => r.status !== "rejected");
  }, [data, chip, sameFilter]);

  async function review(ids: string[], action: "reject" | "confirm") {
    if (ids.length === 0) return;
    const snaps: UndoSnap[] = (data?.links ?? [])
      .filter((r) => ids.includes(r.id))
      .map((r) => ({
        id: r.id,
        status: r.status as UndoSnap["status"],
        source: r.source
      }));
    await adminFetch("/api/luna-admin/links", {
      method: "POST",
      body: JSON.stringify({ action, ids })
    });
    setSelected(new Set());
    if (action === "reject") {
      setToast({ text: `${ids.length}건을 아니라고 했습니다`, undo: snaps });
    } else {
      setToast(null);
    }
    await load();
  }

  async function undo() {
    if (!toast) return;
    const undoRows = toast.undo;
    setToast(null);
    await adminFetch("/api/luna-admin/links", {
      method: "POST",
      body: JSON.stringify({ action: "undo", ids: undoRows.map((r) => r.id), undo: undoRows })
    });
    await load();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  const belongs = data.links.filter((l) => l.kind === "belongs");
  const follows = data.links.filter((l) => l.kind === "follows");
  const showAll = chip === "all";
  const reviewable = sameRows.filter((r) => r.source !== "human" && r.status !== "rejected");
  const allChecked =
    reviewable.length > 0 && reviewable.every((r) => selected.has(r.id));

  return (
    <>
      <ChipBar
        chip={chip}
        setChip={(c) => {
          setChip(c);
          setSelected(new Set());
          if (c === "same") setSameFilter("need");
        }}
        counts={data.counts}
        persp={data.perspectives.length}
      />

      {chip === "same" ? (
        <div className="chips subchips">
          {(
            [
              ["all", `전체 ${sameCounts.all}`],
              ["need", `확인 필요 ${sameCounts.need}`],
              ["confirmed", `확인함 ${sameCounts.confirmed}`],
              ["rejected", `아니라고 한 것 ${sameCounts.rejected}`]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={sameFilter === key ? "on" : ""}
              onClick={() => {
                setSameFilter(key);
                setSelected(new Set());
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {chip === "perspective" ? (
        <>
          <div className="sech">
            <span className="t">관점</span>
            <span className="n">{data.perspectives.length}</span>
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
            <span className="n">{chip === "same" ? sameRows.length : sameCounts.all}</span>
            <span className="sp" />
            {reviewable.length > 0 ? (
              <label className="chkall">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => {
                    if (allChecked) setSelected(new Set());
                    else setSelected(new Set(reviewable.map((r) => r.id)));
                  }}
                />
                보이는 것 선택
              </label>
            ) : null}
            {selected.size > 0 ? (
              <span className="bulk">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void review([...selected], "reject")}
                >
                  ✕ 아니에요 {selected.size}
                </button>
                <button
                  type="button"
                  className="btn g sm"
                  onClick={() => void review([...selected], "confirm")}
                >
                  ✓ 맞아요 {selected.size}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="a"
                onClick={() => onGo(buildLunaAdminUrl("candidates", "pending"))}
              >
                확인 대기 →
              </button>
            )}
          </div>
          {sameRows.length === 0 ? (
            <p className="empty">같은 것 연결이 없습니다.</p>
          ) : (
            sameRows.map((row) => (
              <SameCard
                key={row.id}
                row={row}
                checked={selected.has(row.id)}
                onToggle={() => toggle(row.id)}
                onReject={() => void review([row.id], "reject")}
                onConfirm={() => void review([row.id], "confirm")}
              />
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

      {toast ? (
        <div className="toast">
          <span>{toast.text}</span>
          <button type="button" className="btn sm" onClick={() => void undo()}>
            되돌리기
          </button>
        </div>
      ) : null}
    </>
  );
}

function SameCard({
  row,
  checked,
  onToggle,
  onReject,
  onConfirm
}: {
  row: LinkView;
  checked: boolean;
  onToggle: () => void;
  onReject: () => void;
  onConfirm: () => void;
}) {
  const human = row.source === "human";
  const rejected = row.status === "rejected";
  const canCheck = !human;
  return (
    <div className={`pair ${rejected ? "dim" : ""}`}>
      {canCheck ? (
        <label className="pairchk">
          <input type="checkbox" checked={checked} onChange={onToggle} />
        </label>
      ) : (
        <span className="pairchk" />
      )}
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
      <div className="rev">
        <div className="why">{row.reason || "근거 없음"}</div>
        {human ? (
          <span className="tag g">확인함</span>
        ) : (
          <div className="btns">
            {rejected ? null : (
              <button type="button" className="btn sm" onClick={onReject}>
                ✕ 아니에요
              </button>
            )}
            <button type="button" className="btn g sm" onClick={onConfirm}>
              ✓ 맞아요
            </button>
          </div>
        )}
      </div>
    </div>
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
