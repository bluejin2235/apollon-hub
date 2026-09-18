"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import type {
  TonightEmptyReason,
  TonightItem,
  TonightLongJob
} from "@/lib/luna-admin/types";
import type { AgendaDemote } from "@/lib/luna/study-agenda";

type Payload = {
  items: TonightItem[];
  run_label?: string;
  empty_reason?: TonightEmptyReason | null;
  long_jobs?: TonightLongJob[];
  demoted?: AgendaDemote[];
};

type Props = {
  onGo?: (href: string) => void;
};

export function LunaAdminTonight({ onGo }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openHow, setOpenHow] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await adminFetch<Payload>("/api/luna-admin/tonight"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, id?: string) {
    setBusy(id ?? action);
    try {
      await adminFetch("/api/luna-admin/tonight", {
        method: "POST",
        body: JSON.stringify({ action, id })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 실패");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const active = data.items.filter((i) => !i.excluded && i.when === "tonight");
  const skipped = data.items.filter(
    (i) => !i.excluded && (i.when === "tomorrow" || i.verifiable === false)
  );
  const minutes = active.reduce((s, i) => s + (i.minutes || 0), 0);
  const empty = data.empty_reason ?? null;

  return (
    <>
      {empty && active.length === 0 ? (
        <div className="alert y">
          <div className="c">
            <div className="t">{empty.title}</div>
            <div className="d" style={{ whiteSpace: "pre-line" }}>
              {empty.detail}
            </div>
          </div>
          {empty.action_href ? (
            <button
              type="button"
              className="btn o"
              onClick={() =>
                empty.action_href
                  ? onGo?.(empty.action_href)
                  : undefined
              }
            >
              {empty.action_label ?? "보기"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="alert p">
          <div className="c">
            <div className="t">
              {data.run_label ?? "오늘 밤"} · 할 일 {active.length}건
              {minutes > 0 ? ` · 예상 ${minutes}분` : ""}
            </div>
            <div className="d">
              루나가 DB를 훑어 스스로 정했습니다. 「왜」를 보고 빼기만 하면 됩니다.
            </div>
          </div>
          <button
            type="button"
            className="btn p"
            disabled={busy === "run" || active.length === 0}
            onClick={() => void act("run")}
          >
            {busy === "run" ? "실행 중…" : "지금 실행"}
          </button>
        </div>
      )}

      {error ? <p className="empty">{error}</p> : null}

      {active.map((item, i) => (
        <TonightCard
          key={item.id}
          item={item}
          index={i + 1}
          busy={busy}
          showHow={openHow === item.id}
          onKeep={() => void act("include", item.id)}
          onExclude={() => void act("exclude", item.id)}
          onHow={() => setOpenHow((id) => (id === item.id ? null : item.id))}
        />
      ))}

      {(data.long_jobs ?? []).length > 0 ? (
        <>
          <div className="sech">
            <span className="t">진행 중인 장기 작업</span>
          </div>
          {data.long_jobs!.map((job) => (
            <div className="prog" key={job.id}>
              <div className="ph">
                <span className="t">{job.title}</span>
                <span className="v">{job.value}</span>
              </div>
              <div className="bar">
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, job.pct))}%`,
                    background: job.bar_color || "var(--luna)"
                  }}
                />
              </div>
              <div className="d">{job.detail}</div>
            </div>
          ))}
        </>
      ) : null}

      {skipped.length > 0 ? (
        <>
          <div className="sech">
            <span className="t">오늘 밤 안 하는 것</span>
            <span className="n">{skipped.length}</span>
            <span className="sp" />
            <button
              type="button"
              className="a"
              onClick={() => onGo?.(buildLunaAdminUrl("selfstudy", "ask"))}
            >
              왜 안 하나 →
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 11, lineHeight: 1.8 }}>
            정답이 없어 루나가 스스로 채점할 수 없는 것들입니다.{" "}
            <b>「내가 답할 것」에서 답해 주시면 그다음부터 자습이 가져갑니다.</b>
          </p>
          {skipped.map((item) => (
            <div className="skip" key={item.id}>
              <span className="ic">—</span>
              <div className="c">
                <div className="t">{item.title}</div>
                <div className="d">{item.skip_reason ?? item.why}</div>
              </div>
              <button
                type="button"
                className="btn sm"
                onClick={() => onGo?.(buildLunaAdminUrl("selfstudy", "ask"))}
              >
                답하기 →
              </button>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

function TonightCard({
  item,
  index,
  busy,
  showHow,
  onKeep,
  onExclude,
  onHow
}: {
  item: TonightItem;
  index: number;
  busy: string | null;
  showHow: boolean;
  onKeep: () => void;
  onExclude: () => void;
  onHow: () => void;
}) {
  const llm = item.llm_calls ?? 0;
  const cost = item.cost_usd ?? 0;
  return (
    <div className="job on">
      <div className="jh">
        <span className="num">{index}</span>
        <div className="jt">
          <div className="t">{item.title}</div>
          <div className="src">
            {item.kind ?? "study"}
            {item.expected ? ` · ${item.expected}` : ""}
          </div>
        </div>
        <div className="right">
          <div className="est">
            <b>{item.minutes}분</b>
            <br />
            LLM {llm}회 · ${cost.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="kv">
        <span className="k">왜</span>
        <span className="v">{item.why}</span>
      </div>
      <div className="kv">
        <span className="k">어떻게</span>
        <span className="v">{item.how ?? item.what}</span>
      </div>
      <div className="kv">
        <span className="k">기대</span>
        <span className="v">{item.expected ?? item.effect}</span>
      </div>
      {showHow && item.failure_ids.length > 0 ? (
        <div className="d" style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
          근거 실패 {item.failure_ids.length}건
        </div>
      ) : null}
      <div className="acts">
        <button
          type="button"
          className="btn sm p"
          disabled={busy === item.id}
          onClick={onKeep}
        >
          그대로
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={busy === item.id}
          onClick={onExclude}
        >
          제외
        </button>
        <button type="button" className="btn sm" onClick={onHow}>
          근거 보기
        </button>
      </div>
    </div>
  );
}
