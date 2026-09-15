"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { TonightItem, TonightState } from "@/lib/luna-admin/types";

type Payload = TonightState & { run_label?: string };

export function LunaAdminTonight() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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
  const skipped = data.items.filter((i) => i.excluded || i.when === "tomorrow");

  return (
    <>
      <div className="alert y">
        <div className="c">
          <div className="t">
            {active.length > 0
              ? `${data.run_label ?? "오늘 밤"}에 할 일 ${active.length}건`
              : "오늘 밤 할 일이 없습니다"}
          </div>
          <div className="d">
            루나가 DB를 훑어 스스로 정했습니다. 각 항목의 「왜」를 보고 [제외]만 하면 됩니다.
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

      <div className="sech">
        <span className="t">{data.run_label ?? "오늘 밤"}에 할 일</span>
        <span className="n">자율 선정 · 정답 있는 것 우선</span>
      </div>

      {active.length === 0 ? (
        <p className="empty">선정된 할 일이 없습니다. 점검할 부족함이 없거나 모두 제외·보류입니다.</p>
      ) : (
        active.map((item, i) => (
          <TonightRow
            key={item.id}
            item={item}
            index={i + 1}
            busy={busy}
            onExclude={() => void act("exclude", item.id)}
          />
        ))
      )}

      {skipped.length > 0 ? (
        <>
          <div className="sech">
            <span className="t">건너뛰는 것</span>
            <span className="n">{skipped.length}</span>
          </div>
          {skipped.map((item) => (
            <div className="row" key={item.id}>
              <span className="ic" style={{ background: "var(--chip)" }}>
                —
              </span>
              <div className="c">
                <div className="t" style={{ color: "var(--faint)" }}>
                  {item.title}
                </div>
                <div className="d">{item.why}</div>
                <div className="m">
                  {item.excluded ? "제외됨" : "정답 없음 · 자동 실행 안 함"}
                </div>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

function TonightRow({
  item,
  index,
  busy,
  onExclude
}: {
  item: TonightItem;
  index: number;
  busy: string | null;
  onExclude: () => void;
}) {
  return (
    <div className="row">
      <span className="ic p">{index}</span>
      <div className="c">
        <div className="t">{item.title}</div>
        <div className="d">왜 — {item.why}</div>
        <div className="m">
          예상 — {item.what}
          {item.verifiable ? " · 채점 가능" : ""}
        </div>
        <div className="btns">
          <button
            type="button"
            className="btn sm"
            disabled={busy === item.id}
            onClick={onExclude}
          >
            제외
          </button>
        </div>
      </div>
      <span className="rt">
        {item.effect}
        <br />약 {item.minutes}분
      </span>
    </div>
  );
}
