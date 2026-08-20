"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  BoxRow,
  Btn,
  ErrorLine,
  KnowledgeShell,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { formatKnowledgeDate, K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";
import type {
  NotionIndexExclude,
  NotionIndexMode,
  NotionIndexSchedule
} from "@/lib/luna/notion-index-settings";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

type RunView = {
  id: string;
  mode: NotionIndexMode;
  mode_label: string;
  started_at: string;
  finished_at: string | null;
  when_label: string;
  pages_total: number;
  pages_processed: number;
  pages_skipped: number;
  blocks: number;
  embeddings_added: number;
  duration_label: string;
  status: "running" | "success" | "failed";
  error_message: string | null;
  elapsed_label: string | null;
  progress_pct: number;
};

type Overview = {
  connected: boolean;
  connection: {
    connected: boolean;
    teamspaces: number;
    accessible_pages: number;
    subtitle: string;
  };
  stats: {
    pages: number;
    blocks: number;
    embeddings: number;
    last_index_label: string;
    as_of_label: string | null;
    captions: {
      pages: string;
      blocks: string;
      embeddings: string;
      last: string;
    };
  };
  schedule: NotionIndexSchedule;
  exclude: NotionIndexExclude;
  running: RunView | null;
  failure: RunView | null;
  history: RunView[];
  rules: Array<{ left: string; right: string }>;
};

function Toggle({
  on,
  onClick,
  disabled
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className="relative h-[19px] w-[34px] shrink-0 rounded-xl disabled:opacity-50"
      style={{ background: on ? K.luna : K.line }}
    >
      <span
        className="absolute top-[2px] h-[15px] w-[15px] rounded-full bg-white"
        style={{ right: on ? 2 : "auto", left: on ? "auto" : 2 }}
      />
    </button>
  );
}

function KindBadge({ mode }: { mode: NotionIndexMode }) {
  const full = mode === "full";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9.5px] font-bold"
      style={{
        background: full ? K.lunaSoft : K.chip,
        color: full ? K.lunaInk : K.sub
      }}
    >
      {full ? "전체" : "증분"}
    </span>
  );
}

function StatusBadge({ status }: { status: RunView["status"] }) {
  if (status === "success") {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[9.5px] font-bold"
        style={{ background: K.talkSoft, color: K.talk }}
      >
        완료
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[9.5px] font-bold"
        style={{ background: K.dangerSoft, color: K.danger }}
      >
        실패
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9.5px] font-bold"
      style={{ background: K.lunaSoft, color: K.lunaInk }}
    >
      진행
    </span>
  );
}

export function LunaKnowledgeNotion() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [excludeDraft, setExcludeDraft] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    const res = await fetch("/api/luna/notion/overview", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as Overview;
    setData(json);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.running) return;
    const t = window.setInterval(() => {
      void load();
    }, 2500);
    return () => window.clearInterval(t);
  }, [data?.running, load]);

  async function authHeaders(): Promise<HeadersInit | null> {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      return null;
    }
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }

  async function testConnection() {
    setTesting(true);
    setTestNote("");
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/luna/notion/test", {
        method: "POST",
        headers
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      setTestNote(
        json.ok
          ? `마지막 확인 ${formatKnowledgeDate(new Date().toISOString())}`
          : (json.message ?? "연결 실패")
      );
      await load();
    } finally {
      setTesting(false);
    }
  }

  async function saveSchedule(next: NotionIndexSchedule) {
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/luna/notion/schedule", {
        method: "PUT",
        headers,
        body: JSON.stringify(next)
      });
      if (!res.ok) {
        setError(`일정 저장 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { schedule: NotionIndexSchedule };
      setData((prev) => (prev ? { ...prev, schedule: json.schedule } : prev));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSlot(mode: NotionIndexMode) {
    if (!data) return;
    const next = {
      ...data.schedule,
      [mode]: {
        ...data.schedule[mode],
        enabled: !data.schedule[mode].enabled
      }
    };
    await saveSchedule(next);
  }

  async function changeTime(mode: NotionIndexMode) {
    if (!data) return;
    const current = data.schedule[mode].time;
    const input = window.prompt("색인 시각 (HH:MM, KST)", current);
    if (input == null) return;
    const trimmed = input.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) {
      setError("시각 형식이 올바르지 않습니다 (예: 03:20)");
      return;
    }
    const next = {
      ...data.schedule,
      [mode]: { ...data.schedule[mode], time: trimmed }
    };
    await saveSchedule(next);
  }

  async function startIndex(mode: NotionIndexMode = "incremental") {
    setIndexing(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/luna/notion/index", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "start", mode })
      });
      if (!res.ok && res.status !== 409) {
        setError(`색인 시작 실패: ${await res.text()}`);
        return;
      }
      await load();
    } finally {
      setIndexing(false);
    }
  }

  async function abortIndex() {
    const headers = await authHeaders();
    if (!headers) return;
    await fetch("/api/luna/notion/index", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "abort", run_id: data?.running?.id })
    });
    await load();
  }

  async function saveExclude(next: NotionIndexExclude) {
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/luna/notion/exclude", {
        method: "PUT",
        headers,
        body: JSON.stringify(next)
      });
      if (!res.ok) {
        setError(`제외 저장 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { exclude: NotionIndexExclude };
      setData((prev) => (prev ? { ...prev, exclude: json.exclude } : prev));
    } finally {
      setSaving(false);
    }
  }

  async function addExcludePath() {
    if (!data) return;
    const path = excludeDraft.trim() || window.prompt("제외할 페이지·경로");
    if (!path?.trim()) return;
    const next = {
      ...data.exclude,
      exclude_paths: [...data.exclude.exclude_paths, path.trim()]
    };
    setExcludeDraft("");
    await saveExclude(next);
  }

  async function removeExcludePath(path: string) {
    if (!data) return;
    await saveExclude({
      ...data.exclude,
      exclude_paths: data.exclude.exclude_paths.filter((p) => p !== path)
    });
  }

  const schedule = data?.schedule;
  const running = data?.running;
  const failure = data?.failure;

  return (
    <KnowledgeShell>
      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && data ? (
        <>
          {running ? (
            <>
              <div
                className="mb-3 flex items-center gap-3 rounded-[12px] border px-4 py-[13px]"
                style={{
                  background: "#FCFBFF",
                  borderColor: "#C9C3E8"
                }}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: K.luna }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">
                    색인 중 · {running.mode === "full" ? "전체 훑기" : "바뀐 것만"}
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: K.faint }}>
                    {running.pages_processed.toLocaleString()} /{" "}
                    {running.pages_total.toLocaleString()} 페이지 · 블록{" "}
                    {running.blocks.toLocaleString()} · 임베딩{" "}
                    {running.embeddings_added.toLocaleString()}
                    {running.elapsed_label
                      ? ` · ${running.elapsed_label} 경과`
                      : ""}
                  </div>
                </div>
                <Btn onClick={() => void abortIndex()}>중단</Btn>
              </div>
              <div
                className="mb-3.5 h-[5px] overflow-hidden rounded-[3px]"
                style={{ background: K.chip }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${running.progress_pct}%`,
                    background: K.luna
                  }}
                />
              </div>
              <p className="mb-3.5 text-[11px]" style={{ color: K.faint }}>
                중단해도 지금까지 색인한 것은 남습니다. 다시 시작하면 이어서 합니다.
              </p>
            </>
          ) : failure ? (
            <div
              className="mb-3.5 flex items-center gap-3 rounded-[12px] border px-4 py-[13px]"
              style={{ background: "#FEF8F7", borderColor: "#F0D5D0" }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: K.danger }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold" style={{ color: K.danger }}>
                  {failure.when_label} 색인 실패
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: K.faint }}>
                  {failure.error_message ?? "알 수 없는 오류"} ·{" "}
                  {failure.pages_processed.toLocaleString()} /{" "}
                  {failure.pages_total.toLocaleString()} 에서 멈춤
                  <br />
                  <strong style={{ color: K.ink }}>
                    이전 색인은 그대로 있습니다.
                  </strong>{" "}
                  검색은 정상 작동합니다.
                </div>
              </div>
              <Btn
                primary
                disabled={indexing}
                onClick={() => void startIndex(failure.mode)}
              >
                다시 시도
              </Btn>
            </div>
          ) : (
            <div
              className="mb-3.5 flex items-center gap-3 rounded-[12px] border px-4 py-[13px]"
              style={{ background: K.panel, borderColor: K.line }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: data.connection.connected ? K.talk : K.faint
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold">
                  {data.connection.connected ? "연결됨" : "미연결"}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: K.faint }}>
                  {data.connection.subtitle}
                  {testNote ? ` · ${testNote}` : ""}
                </div>
              </div>
              <Btn disabled={testing} onClick={() => void testConnection()}>
                {testing ? "확인 중…" : "연결 테스트"}
              </Btn>
            </div>
          )}

          <StatGrid>
            <StatCard
              label="색인된 페이지"
              value={data.stats.pages.toLocaleString()}
              sub={
                data.stats.as_of_label ? (
                  <span style={{ color: K.brain }}>{data.stats.as_of_label}</span>
                ) : (
                  data.stats.captions.pages
                )
              }
            />
            <StatCard
              label="블록"
              value={data.stats.blocks.toLocaleString()}
              sub={data.stats.captions.blocks}
            />
            <StatCard
              label="임베딩"
              value={data.stats.embeddings.toLocaleString()}
              sub={data.stats.captions.embeddings}
            />
            <StatCard
              label={failure ? "마지막 성공" : "마지막 색인"}
              value={data.stats.last_index_label}
              small
              sub={
                <span
                  style={{
                    color: failure ? K.brain : K.talk
                  }}
                >
                  {data.stats.captions.last}
                </span>
              }
            />
          </StatGrid>

          {schedule ? (
            <div
              className="mb-3 overflow-hidden rounded-[12px] border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div
                className="flex flex-wrap items-center gap-2 border-b px-[15px] py-[11px]"
                style={{ borderColor: K.line2, background: "#FBFBFC" }}
              >
                <span className="text-[12.5px] font-bold">언제 색인하나</span>
                <span className="text-[10.5px]" style={{ color: K.faint }}>
                  노션은 읽기만 하므로 업무 중에 돌려도 영향이 없습니다
                </span>
                <span className="flex-1" />
                <Btn
                  primary
                  className="!px-2.5 !py-1 !text-[10.5px]"
                  disabled={indexing || Boolean(running) || saving}
                  onClick={() => void startIndex("incremental")}
                >
                  지금 색인
                </Btn>
              </div>

              {(
                [
                  {
                    mode: "full" as const,
                    title: "전체 훑기",
                    desc: "모든 페이지를 확인하고, 노션에서 사라진 것을 정리합니다. Work서버 스캔(03:00)이 끝난 뒤입니다."
                  },
                  {
                    mode: "incremental" as const,
                    title: "바뀐 것만",
                    desc: "점심시간이라 노션을 쓰는 사람이 적습니다. 마지막 색인 이후 수정된 페이지만 다시 읽습니다."
                  }
                ] as const
              ).map((row, idx) => {
                const slot = schedule[row.mode];
                return (
                  <div
                    key={row.mode}
                    className="flex flex-wrap items-center gap-3 px-[15px] py-[13px]"
                    style={{
                      borderTop: idx === 0 ? undefined : `1px solid ${K.line2}`
                    }}
                  >
                    <Toggle
                      on={slot.enabled}
                      disabled={saving}
                      onClick={() => void toggleSlot(row.mode)}
                    />
                    <span
                      className="w-[58px] font-mono text-[15px] font-extrabold"
                      style={{ color: K.ink }}
                    >
                      {slot.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                        {row.title} <KindBadge mode={row.mode} />
                      </div>
                      <div
                        className="mt-0.5 text-[10.5px] leading-relaxed"
                        style={{ color: K.faint }}
                      >
                        {row.desc}
                      </div>
                    </div>
                    <Btn
                      className="!px-2.5 !py-1 !text-[10.5px]"
                      disabled={saving}
                      onClick={() => void changeTime(row.mode)}
                    >
                      시각 바꾸기
                    </Btn>
                  </div>
                );
              })}

              <div
                className="border-t px-[15px] py-2.5 text-[11px] leading-relaxed"
                style={{
                  borderColor: K.line2,
                  background: K.brainSoft,
                  color: K.brain
                }}
              >
                바뀐 페이지가 없으면 요청 한 번으로 끝납니다. 비용은 거의 들지
                않습니다.
              </div>
            </div>
          ) : null}

          <div
            className="mb-3 overflow-hidden rounded-[12px] border"
            style={{ borderColor: K.line, background: K.panel }}
          >
            <div
              className="flex items-center gap-2 border-b px-[15px] py-[11px]"
              style={{ borderColor: K.line2, background: "#FBFBFC" }}
            >
              <span className="text-[12.5px] font-bold">색인 이력</span>
              <span className="text-[10.5px]" style={{ color: K.faint }}>
                최근 10회
              </span>
            </div>
            {data.history.length === 0 ? (
              <p className="px-[15px] py-3 text-[12px]" style={{ color: K.faint }}>
                아직 색인 이력이 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr style={{ background: "#FBFBFC" }}>
                      {[
                        "시각",
                        "종류",
                        "페이지",
                        "임베딩",
                        "걸린 시간",
                        "결과"
                      ].map((h, i) => (
                        <th
                          key={h}
                          className={`px-[15px] py-2 text-[10.5px] font-semibold ${
                            i >= 2 && i <= 4 ? "text-right" : ""
                          }`}
                          style={{ color: K.faint, borderBottom: `1px solid ${K.line2}` }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.id}>
                        <td
                          className="px-[15px] py-2.5 text-[11.5px]"
                          style={{ borderBottom: `1px solid ${K.line2}` }}
                        >
                          {row.when_label}
                        </td>
                        <td
                          className="px-[15px] py-2.5"
                          style={{ borderBottom: `1px solid ${K.line2}` }}
                        >
                          <KindBadge mode={row.mode} />
                        </td>
                        <td
                          className="px-[15px] py-2.5 text-right font-mono text-[10.5px]"
                          style={{
                            borderBottom: `1px solid ${K.line2}`,
                            color: K.sub
                          }}
                        >
                          {row.mode === "incremental"
                            ? `${Math.max(0, row.pages_processed - row.pages_skipped).toLocaleString()} / ${row.pages_total.toLocaleString()}`
                            : row.pages_processed.toLocaleString()}
                        </td>
                        <td
                          className="px-[15px] py-2.5 text-right font-mono text-[10.5px]"
                          style={{
                            borderBottom: `1px solid ${K.line2}`,
                            color: K.sub
                          }}
                        >
                          +{row.embeddings_added.toLocaleString()}
                        </td>
                        <td
                          className="px-[15px] py-2.5 text-right text-[11.5px]"
                          style={{ borderBottom: `1px solid ${K.line2}` }}
                        >
                          {row.duration_label}
                        </td>
                        <td
                          className="px-[15px] py-2.5"
                          style={{ borderBottom: `1px solid ${K.line2}` }}
                        >
                          <StatusBadge status={row.status} />
                          {row.status === "failed" && row.error_message ? (
                            <div
                              className="mt-1 text-[10.5px]"
                              style={{ color: K.danger }}
                            >
                              {row.error_message}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-2">
            <Box title="검색 규칙">
              {(data.rules ?? []).map((r) => (
                <BoxRow key={r.left} left={r.left} right={r.right} />
              ))}
              <p className="mt-2.5 text-[11px]" style={{ color: K.faint }}>
                규칙은 두뇌 → L3-02 자료 찾기에서 관리합니다
              </p>
            </Box>

            <div
              className="overflow-hidden rounded-[12px] border"
              style={{ borderColor: K.line, background: K.panel }}
            >
              <div
                className="flex items-center gap-2 border-b px-[15px] py-[11px]"
                style={{ borderColor: K.line2, background: "#FBFBFC" }}
              >
                <span className="text-[12.5px] font-bold">색인에서 빼는 것</span>
                <span className="flex-1" />
                <Btn
                  className="!px-2.5 !py-1 !text-[10.5px]"
                  disabled={saving}
                  onClick={() => void addExcludePath()}
                >
                  ＋ 추가
                </Btn>
              </div>
              <div className="px-[15px] py-1">
                <BoxRow
                  left={`${data.exclude.min_block_length}자 미만 블록`}
                  right="제외"
                />
                <BoxRow left="이미지·파일 캡션" right="포함" />
                {data.exclude.exclude_paths.map((path) => (
                  <div
                    key={path}
                    className="flex items-center justify-between gap-2 border-b py-2 text-[12px]"
                    style={{ borderColor: K.line2 }}
                  >
                    <span style={{ color: K.sub }}>{path}</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold"
                      style={{ color: K.danger }}
                      onClick={() => void removeExcludePath(path)}
                    >
                      제거
                    </button>
                  </div>
                ))}
              </div>
              <div
                className="border-t px-[15px] py-2.5 text-[11px]"
                style={{
                  borderColor: K.line2,
                  background: "#FBFBFC",
                  color: K.faint
                }}
              >
                쓸모없는 페이지를 빼면 검색이 정확해지고 비용도 줄어듭니다
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: K.faint }}>
            색인은 노션을 <strong>읽기만</strong> 합니다. 쓰지 않으므로 업무 중에
            돌아도 사용자는 느끼지 못합니다.
          </p>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
