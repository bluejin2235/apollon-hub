"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { TonightItem, TonightState } from "@/lib/luna-admin/types";

type Payload = TonightState & { run_label?: string };

export function LunaAdminTonight() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

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
  const idleDaysNote = active.length > 0;

  return (
    <>
      {idleDaysNote ? null : (
        <div className="alert y">
          <div className="c">
            <div className="t">오늘 밤 할 일이 없습니다</div>
            <div className="d">실패 분석에서 올라오는 항목이 여기 모입니다.</div>
          </div>
          <button
            type="button"
            className="btn p"
            disabled={busy === "run"}
            onClick={() => void act("run")}
          >
            {busy === "run" ? "실행 중…" : "지금 실행"}
          </button>
        </div>
      )}

      {active.length > 0 ? (
        <div className="alert y">
          <div className="c">
            <div className="t">{data.run_label ?? "오늘 밤"}에 할 일 {active.length}건</div>
            <div className="d">실패 분석에서 자동 선정. 빼기만 하면 됩니다.</div>
          </div>
          <button
            type="button"
            className="btn p"
            disabled={busy === "run"}
            onClick={() => void act("run")}
          >
            {busy === "run" ? "실행 중…" : "지금 실행"}
          </button>
        </div>
      ) : null}

      <div className="sech">
        <span className="t">{data.run_label ?? "오늘 밤"}에 할 일</span>
        <span className="n">실패 분석에서 자동 선정</span>
      </div>

      {active.length === 0 ? (
        <p className="empty">선정된 할 일이 없습니다.</p>
      ) : (
        active.map((item, i) => (
          <TonightRow
            key={item.id}
            item={item}
            index={i + 1}
            busy={busy}
            evidenceId={evidenceId}
            onExclude={() => void act("exclude", item.id)}
            onEvidence={() => setEvidenceId(evidenceId === item.id ? null : item.id)}
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
                <div className="d">{item.excluded ? "제외됨" : "내일 밤"}</div>
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
  evidenceId,
  onExclude,
  onEvidence
}: {
  item: TonightItem;
  index: number;
  busy: string | null;
  evidenceId: string | null;
  onExclude: () => void;
  onEvidence: () => void;
}) {
  return (
    <div className="row">
      <span className="ic p">{index}</span>
      <div className="c">
        <div className="t">{item.title}</div>
        <div className="d">{item.what}</div>
        <div className="m">{item.why}</div>
        {evidenceId === item.id ? (
          <div className="m">실패 {item.failure_ids.length}건 · {item.failure_ids.slice(0, 3).join(", ")}</div>
        ) : null}
        <div className="btns">
          <button
            type="button"
            className="btn sm"
            disabled={busy === item.id}
            onClick={onExclude}
          >
            제외
          </button>
          <button type="button" className="btn sm" onClick={onEvidence}>
            근거 보기
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
