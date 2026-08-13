"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, ErrorLine } from "@/components/luna/knowledge/ui";
import { formatKnowledgeDate, K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type NotifyEvents = {
  consolidation: boolean;
  study: boolean;
  reflect: boolean;
  conflict: boolean;
  prompt_change: boolean;
  exam: boolean;
  morning: boolean;
};

type ConsolidationStatus = {
  settings: {
    volume_threshold: number;
    backstop_days: number;
    notify_events: NotifyEvents;
  };
  last_run: {
    finished_at: string | null;
    started_at: string;
    status: string;
    trigger: string;
    merged_candidates: number | null;
    stale_candidates: number | null;
    conflict_candidates: number | null;
  } | null;
  new_active_since_last: number;
  days_since_last: number | null;
  days_until_backstop: number | null;
  would_run: boolean;
};

const NOTIFY_LABELS: Array<{ key: keyof NotifyEvents; label: string }> = [
  { key: "consolidation", label: "정리" },
  { key: "study", label: "자습" },
  { key: "morning", label: "아침 요약" },
  { key: "reflect", label: "리플렉션" },
  { key: "conflict", label: "충돌" },
  { key: "prompt_change", label: "프롬프트" },
  { key: "exam", label: "시험" }
];

const DEFAULT_NOTIFY: NotifyEvents = {
  consolidation: true,
  study: true,
  reflect: true,
  conflict: true,
  prompt_change: true,
  exam: true,
  morning: true
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function lastRunResultLine(status: ConsolidationStatus | null): string | null {
  const r = status?.last_run;
  if (!r) return null;
  const merged = r.merged_candidates;
  const stale = r.stale_candidates;
  const conflict = r.conflict_candidates;
  if (merged == null && stale == null && conflict == null) return null;
  return `마지막 결과 — 중복 ${merged ?? 0} · 미사용 ${stale ?? 0} · 충돌 ${conflict ?? 0}`;
}

export function LunaConsolidateBox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [status, setStatus] = useState<ConsolidationStatus | null>(null);
  const [volumeDraft, setVolumeDraft] = useState(30);
  const [backstopDraft, setBackstopDraft] = useState(14);
  const [notifyDraft, setNotifyDraft] = useState<NotifyEvents>(DEFAULT_NOTIFY);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/luna/consolidate", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 403) {
        setIsAdmin(false);
        return;
      }
      if (!res.ok) {
        setError(`정리 상태 불러오기 실패 (${res.status})`);
        return;
      }
      const json = (await res.json()) as ConsolidationStatus;
      setIsAdmin(true);
      setStatus(json);
      setVolumeDraft(json.settings.volume_threshold);
      setBackstopDraft(json.settings.backstop_days);
      setNotifyDraft({ ...DEFAULT_NOTIFY, ...json.settings.notify_events });
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    const token = await getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/consolidate", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          volume_threshold: volumeDraft,
          backstop_days: backstopDraft,
          notify_events: notifyDraft
        })
      });
      if (!res.ok) {
        setMessage(`저장 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as ConsolidationStatus;
      setStatus(json);
      setVolumeDraft(json.settings.volume_threshold);
      setBackstopDraft(json.settings.backstop_days);
      setNotifyDraft({ ...DEFAULT_NOTIFY, ...json.settings.notify_events });
      setMessage("설정 저장됨");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    const token = await getAccessToken();
    if (!token || running) return;
    setRunning(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/consolidate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ force: true })
      });
      const json = (await res.json()) as {
        skipped?: boolean;
        error?: string;
        merged_candidates?: number;
        stale_candidates?: number;
        conflict_candidates?: number;
      };
      if (!res.ok) {
        setMessage(`실행 실패: ${json.error || "unknown"}`);
        return;
      }
      if (json.skipped) {
        setMessage("조건 미충족으로 건너뜀");
      } else if (json.error) {
        setMessage(`정리 실패: ${json.error}`);
      } else {
        setMessage(
          `정리 완료 — 중복 ${json.merged_candidates ?? 0} · 미사용 ${json.stale_candidates ?? 0} · 충돌 ${json.conflict_candidates ?? 0}`
        );
      }
      await load();
    } finally {
      setRunning(false);
    }
  }

  const lastRunAt =
    status?.last_run?.finished_at ?? status?.last_run?.started_at ?? null;
  const resultLine = lastRunResultLine(status);

  return (
    <div
      className="mt-3.5 rounded-[12px] border px-4 py-3.5"
      style={{ background: K.panel, borderColor: K.line }}
    >
      <h4 className="text-[13px] font-bold">기억 정리</h4>
      <p className="mb-2.5 mt-1 text-[12px]" style={{ color: K.sub }}>
        오래된 기억을 정리하고 통합합니다. 후보는 지식후보함에서 확인합니다
      </p>

      {loading ? (
        <p className="text-[12px]" style={{ color: K.faint }}>
          불러오는 중…
        </p>
      ) : (
        <>
          {error ? <ErrorLine message={error} /> : null}

          <div
            className="flex justify-between text-[12.5px] leading-[2.05]"
            style={{ color: K.sub }}
          >
            <span>마지막 실행일</span>
            <b className="font-bold" style={{ color: K.ink }}>
              {formatKnowledgeDate(lastRunAt)}
              {status?.last_run?.status ? (
                <span className="font-normal" style={{ color: K.sub }}>
                  {" "}
                  · {status.last_run.status}
                </span>
              ) : null}
            </b>
          </div>
          <div
            className="flex justify-between text-[12.5px] leading-[2.05]"
            style={{ color: K.sub }}
          >
            <span>다음 조건</span>
            <b className="font-bold" style={{ color: K.ink }}>
              신규 {status?.new_active_since_last ?? 0}/
              {status?.settings.volume_threshold ?? volumeDraft} · 백스톱{" "}
              {status?.days_until_backstop == null
                ? "—"
                : status.days_until_backstop === 0
                  ? "도래"
                  : `D-${status.days_until_backstop}`}
            </b>
          </div>

          {isAdmin ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-3.5 min-[901px]:grid-cols-2">
                <div>
                  <label
                    className="mb-1 block text-[12px]"
                    style={{ color: K.sub }}
                  >
                    신규 임계값
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={volumeDraft}
                    onChange={(e) => setVolumeDraft(Number(e.target.value))}
                    className="w-full rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
                    style={{
                      borderColor: K.line,
                      background: K.panel,
                      color: K.ink
                    }}
                  />
                </div>
                <div>
                  <label
                    className="mb-1 block text-[12px]"
                    style={{ color: K.sub }}
                  >
                    백스톱(일)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={backstopDraft}
                    onChange={(e) => setBackstopDraft(Number(e.target.value))}
                    className="w-full rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
                    style={{
                      borderColor: K.line,
                      background: K.panel,
                      color: K.ink
                    }}
                  />
                </div>
              </div>

              <div className="mt-3">
                <p className="mb-1.5 text-[12px]" style={{ color: K.sub }}>
                  알림 이벤트
                </p>
                <div className="flex flex-wrap gap-2">
                  {NOTIFY_LABELS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border px-2 py-1 text-[12px]"
                      style={{ borderColor: K.line, color: K.ink }}
                    >
                      <input
                        type="checkbox"
                        checked={notifyDraft[key]}
                        onChange={(e) =>
                          setNotifyDraft((prev) => ({
                            ...prev,
                            [key]: e.target.checked
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn primary disabled={!isAdmin || busy} onClick={() => void saveSettings()}>
              {busy ? "저장 중…" : "설정 저장"}
            </Btn>
            <Btn disabled={!isAdmin || running} onClick={() => void runNow()}>
              {running ? "정리 중…" : "지금 정리 실행"}
            </Btn>
            {resultLine ? (
              <span className="text-[11.5px]" style={{ color: K.faint }}>
                {resultLine}
              </span>
            ) : null}
          </div>

          {!isAdmin ? (
            <p className="mt-2 text-[11.5px]" style={{ color: K.faint }}>
              정리 설정 조회·변경·실행은 슈퍼관리자만 가능합니다
            </p>
          ) : null}
          {message ? (
            <p className="mt-2 text-[12px]" style={{ color: K.sub }}>
              {message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
