"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import {
  CheckRow,
  getAccessToken,
  isSuperAdmin,
  SettingsBox
} from "@/components/luna/selfstudy/shared";
import { K } from "@/lib/luna/knowledge-format";

type Kind =
  | "search_zero"
  | "clarify_unresolved"
  | "correction"
  | "thumbs_down"
  | "eval_quality";

type Settings = {
  run_hour: number;
  run_minute: number;
  max_per_day: number;
  skip_when_empty: boolean;
  must_submit_candidate: true;
  criteria: {
    search_zero: boolean;
    clarify_unresolved: boolean;
    correction: boolean;
    eval_quality: boolean;
    thumbs_down: boolean;
    knowledge_gap: boolean;
  };
  notify_done: boolean;
  notify_fail: boolean;
  notify_morning: boolean;
};

type Payload = {
  settings: Settings;
  today_counts: Record<Kind, number>;
  last_run: {
    finished_at: string;
    submitted: number;
    skipped: boolean;
    message: string;
  } | null;
  next_run_label: string;
  cron_schedule_label: string;
};

const CRITERIA: { key: Kind; label: string }[] = [
  { key: "search_zero", label: "검색 0건이었던 주제" },
  { key: "clarify_unresolved", label: "되물었지만 해소되지 않은 것" },
  { key: "correction", label: "정정받았지만 이해가 얕은 것" },
  { key: "thumbs_down", label: "싫어요(👎)를 받은 답변" },
  { key: "eval_quality", label: "정기 점검 — 더 잘할 수 있었음" }
];

function timeValue(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function lastRunLabel(p: Payload | null): string {
  const r = p?.last_run;
  if (!r) return "마지막 실행 기록 없음";
  const d = new Date(r.finished_at);
  if (Number.isNaN(d.getTime())) return "마지막 실행 기록 없음";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const when = `${String(kst.getUTCMonth() + 1).padStart(2, "0")}.${String(
    kst.getUTCDate()
  ).padStart(2, "0")} ${String(kst.getUTCHours()).padStart(2, "0")}:${String(
    kst.getUTCMinutes()
  ).padStart(2, "0")}`;
  return `마지막 실행 ${when} · ${r.submitted}문답 제출`;
}

export function LunaSelfstudySettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [timeDraft, setTimeDraft] = useState("03:00");
  const [maxDraft, setMaxDraft] = useState("3");
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      setAdmin(await isSuperAdmin());
      const res = await fetch("/api/luna/selfstudy/settings", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(`불러오기 실패 (${res.status})`);
        return;
      }
      const json = (await res.json()) as Payload;
      setData(json);
      setDraft({
        ...json.settings,
        notify_morning: json.settings.notify_morning !== false
      });
      setTimeDraft(timeValue(json.settings.run_hour, json.settings.run_minute));
      setMaxDraft(String(json.settings.max_per_day));
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    const token = await getAccessToken();
    if (!token) return;
    const [hRaw, mRaw] = timeDraft.split(":");
    const body: Settings = {
      ...draft,
      run_hour: Number(hRaw) || 0,
      run_minute: Number(mRaw) || 0,
      max_per_day: Number(maxDraft) || 3
    };
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/selfstudy/settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        setMessage(
          res.status === 403
            ? "설정 저장은 슈퍼관리자만 가능합니다"
            : `저장 실패: ${await res.text()}`
        );
        return;
      }
      const json = (await res.json()) as { settings: Settings };
      setDraft(json.settings);
      setTimeDraft(timeValue(json.settings.run_hour, json.settings.run_minute));
      setMaxDraft(String(json.settings.max_per_day));
      setMessage("설정 저장됨");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    const token = await getAccessToken();
    if (!token) return;
    setRunning(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/selfstudy", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ force: true })
      });
      if (!res.ok) {
        setMessage(
          res.status === 403
            ? "지금 실행은 슈퍼관리자만 가능합니다"
            : `실행 실패: ${await res.text()}`
        );
        return;
      }
      const json = (await res.json()) as { submitted?: number; message?: string };
      setMessage(json.message || `자습 ${json.submitted ?? 0}건 제출`);
      await load();
    } finally {
      setRunning(false);
    }
  }

  if (loading || !draft) {
    return (
      <KnowledgeShell>
        {error ? <ErrorLine message={error} /> : <LoadingLine />}
      </KnowledgeShell>
    );
  }

  const setCriteria = (key: Kind, next: boolean) =>
    setDraft({ ...draft, criteria: { ...draft.criteria, [key]: next } });

  return (
    <KnowledgeShell>
      {error ? <ErrorLine message={error} /> : null}
      {message ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {message}
        </p>
      ) : null}

      <SettingsBox title="실행">
        <div className="grid grid-cols-1 gap-3.5 min-[901px]:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px]" style={{ color: K.sub }}>
              실행 시각
            </label>
            <FieldInput
              className="w-full"
              value={timeDraft}
              disabled={!admin}
              onChange={(e) => setTimeDraft(e.target.value)}
              placeholder="03:00"
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px]" style={{ color: K.sub }}>
              하루 최대 문답
            </label>
            <FieldInput
              className="w-full"
              value={maxDraft}
              disabled={!admin}
              inputMode="numeric"
              onChange={(e) => setMaxDraft(e.target.value)}
            />
          </div>
        </div>
        <div
          className="mt-3 border-t pt-2"
          style={{ borderColor: K.line2 }}
        >
          <CheckRow
            checked={draft.skip_when_empty}
            disabled={!admin}
            onChange={(v) => setDraft({ ...draft, skip_when_empty: v })}
          >
            막힌 순간이 없으면 자습하지 않음
          </CheckRow>
          <CheckRow checked disabled lock="(해제 불가 · 헌법)">
            자습 결과는 반드시 지식후보로 제출
          </CheckRow>
        </div>
        <p className="mt-2.5 text-[11px]" style={{ color: K.faint }}>
          실제 실행 스케줄은 {data?.cron_schedule_label ?? "vercel.json cron 고정"}
          입니다. 시각 변경은 화면 표시·안내에만 반영됩니다.
        </p>
      </SettingsBox>

      <SettingsBox title="선정 기준" desc="어떤 막힌 순간을 자습 주제로 삼을지">
        {CRITERIA.map((c, i) => (
          <div
            key={c.key}
            className={`flex items-center gap-2.5 text-[13px] leading-[2.3] ${
              i === 0 ? "" : "border-t pt-0.5"
            }`}
            style={{ borderColor: K.line2 }}
          >
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={draft.criteria[c.key]}
              disabled={!admin}
              onChange={(e) => setCriteria(c.key, e.target.checked)}
            />
            <span className="flex-1">{c.label}</span>
            <span className="text-[11.5px]" style={{ color: K.faint }}>
              오늘 {data?.today_counts?.[c.key] ?? 0}건
            </span>
          </div>
        ))}
        <div
          className="flex items-center gap-2.5 border-t pt-0.5 text-[13px] leading-[2.3]"
          style={{ borderColor: K.line2 }}
        >
          <input type="checkbox" className="h-4 w-4" checked={false} disabled readOnly />
          <span className="flex-1" style={{ color: K.faint }}>
            지식에서 스스로 찾은 공백
          </span>
          <Badge kind="src">아직 이름</Badge>
        </div>
        <p className="mt-2.5 text-[11px]" style={{ color: K.faint }}>
          임의 주제 선정은 프롬프트(L4 자습)에서 금지되어 있습니다
        </p>
      </SettingsBox>

      <SettingsBox title="알림">
        <CheckRow
          checked={draft.notify_done}
          disabled={!admin}
          onChange={(v) => setDraft({ ...draft, notify_done: v })}
          lock="(0건이면 알림 없음)"
        >
          자습 완료 시 알림
        </CheckRow>
        <CheckRow
          checked={draft.notify_fail}
          disabled={!admin}
          onChange={(v) => setDraft({ ...draft, notify_fail: v })}
        >
          자습 실패 시 알림
        </CheckRow>
        <CheckRow
          checked={draft.notify_morning}
          disabled={!admin}
          onChange={(v) => setDraft({ ...draft, notify_morning: v })}
          lock="(매일 08:00 KST)"
        >
          아침 요약
        </CheckRow>
      </SettingsBox>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Btn primary disabled={busy || !admin} onClick={() => void save()}>
          {busy ? "저장 중…" : "설정 저장"}
        </Btn>
        <Btn disabled={running || !admin} onClick={() => void runNow()}>
          {running ? "실행 중…" : "지금 자습 실행"}
        </Btn>
        <span className="text-[11.5px]" style={{ color: K.faint }}>
          {lastRunLabel(data)}
        </span>
      </div>
      {!admin ? (
        <p className="mt-2 text-[11.5px]" style={{ color: K.faint }}>
          설정 변경·실행은 슈퍼관리자만 가능합니다
        </p>
      ) : null}
    </KnowledgeShell>
  );
}
