"use client";

import { useCallback, useEffect, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import {
  Badge,
  Btn,
  Box,
  BoxRow,
  ErrorLine,
  FieldInput,
  FieldSelect,
  KnowledgeShell,
  ListCard,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import {
  formatDurationSec,
  formatKnowledgeDate,
  formatScanTime,
  K
} from "@/lib/luna/knowledge-format";
import { LunaNasPathSettingsPanel } from "@/components/luna/knowledge/LunaNasPathSettingsPanel";
import { supabase } from "@/lib/supabase/client";

type PathRow = {
  id: string;
  drive: string;
  path: string;
  file_count: number;
  latest_modified: string | null;
};

type ScanSettings = {
  enabled: boolean;
  scan_hour: number;
  scan_minute: number;
  drives: string;
  last_run_at: string | null;
  last_status: string | null;
  last_duration_sec: number | null;
};

type HistoryRow = {
  ran_at: string;
  status: string | null;
  note: string;
  duration_sec: number | null;
};

const PAGE_SIZE = 20;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatLastScan(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatScanTime(d.getHours(), d.getMinutes());
  return sameDay ? `오늘 ${time}` : formatKnowledgeDate(iso);
}

function formatNextScan(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const time = formatScanTime(d.getHours(), d.getMinutes());
  if (isTomorrow) return `내일 ${time}`;
  return `${formatKnowledgeDate(iso)} ${time}`;
}

function scanStatusLabel(status: string | null): {
  text: string;
  color: string;
} {
  const s = (status ?? "").toLowerCase();
  if (s === "done" || s === "success") {
    return { text: "성공", color: K.talk };
  }
  if (s === "failed") {
    return { text: "실패", color: K.danger };
  }
  return { text: status || "—", color: K.faint };
}

export function LunaKnowledgeWorkserver() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [pathsTotal, setPathsTotal] = useState(0);
  const [markedCount, setMarkedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [pathCount, setPathCount] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [nextScanAt, setNextScanAt] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [drive, setDrive] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (drive !== "all") params.set("drive", drive);
    if (query) params.set("q", query);

    const res = await fetch(`/api/luna/nas/overview?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      settings?: ScanSettings | null;
      paths?: PathRow[];
      paths_total?: number;
      marked_count?: number;
      total_count?: number;
      path_count?: number;
      history?: HistoryRow[];
      next_scan_at?: string | null;
    };
    setSettings(json.settings ?? null);
    setPaths(json.paths ?? []);
    setPathsTotal(json.paths_total ?? 0);
    setMarkedCount(json.marked_count ?? 0);
    setTotalCount(json.total_count ?? 0);
    setPathCount(json.path_count ?? 0);
    setHistory(json.history ?? []);
    setNextScanAt(json.next_scan_at ?? null);
    setLoading(false);
  }, [drive, limit, query]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function removePath(id: string) {
    const token = await getAccessToken();
    if (!token || busyId) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/luna/nas/paths", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        setToast(`삭제 실패: ${await res.text()}`);
        return;
      }
      setToast("삭제했습니다");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const lastStatus = scanStatusLabel(settings?.last_status ?? null);
  const remaining = Math.max(0, pathsTotal - paths.length);

  return (
    <KnowledgeShell>
      <LunaNasPathSettingsPanel />

      <StatGrid>
        <StatCard
          label="인덱싱 파일"
          value={totalCount > 0 ? totalCount.toLocaleString("ko-KR") : "—"}
        />
        <StatCard
          label="중요 마킹"
          value={markedCount > 0 ? markedCount.toLocaleString("ko-KR") : "—"}
          sub={pathCount > 0 ? `${pathCount}개 경로` : undefined}
        />
        <StatCard
          label="마지막 스캔"
          value={formatLastScan(settings?.last_run_at ?? null)}
          small
          sub={
            settings?.last_run_at ? (
              <span style={{ color: lastStatus.color }}>
                {lastStatus.text}
                {settings.last_duration_sec != null
                  ? ` · ${formatDurationSec(settings.last_duration_sec)}`
                  : ""}
              </span>
            ) : undefined
          }
        />
        <StatCard
          label="다음 스캔"
          value={formatNextScan(nextScanAt)}
          small
          sub={settings?.enabled === false ? "비활성" : settings ? "자동" : undefined}
        />
      </StatGrid>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error ? (
        <>
          <ListCard>
            <div className="flex flex-wrap items-center gap-2 px-4 py-[13px] pb-2.5">
              <div className="min-w-[200px] flex-1">
                <div className="text-[13px] font-bold">
                  중요 경로 마킹{" "}
                  <span className="font-normal" style={{ color: K.faint }}>
                    {pathCount > 0 ? `${pathCount}개` : "—"}
                  </span>
                </div>
                <div className="text-[11.5px]" style={{ color: K.sub }}>
                  여기 등록된 경로의 파일을 루나가 우선 검색합니다
                </div>
              </div>
              <FieldInput
                className="w-[150px]"
                placeholder="경로 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <FieldSelect
                className="w-[100px]"
                value={drive}
                onChange={(e) => setDrive(e.target.value)}
              >
                <option value="all">전체</option>
                <option value="T">T 드라이브</option>
                <option value="P">P 드라이브</option>
              </FieldSelect>
              <Btn disabled>경로 추가</Btn>
            </div>

            <div className="text-[12.5px]">
              <div
                className="flex gap-2.5 px-4 py-2 text-[11.5px]"
                style={{ background: "#fafbfc", color: K.sub, borderBottom: `1px solid ${K.line2}` }}
              >
                <span className="w-[30px] shrink-0">드라이브</span>
                <span className="min-w-0 flex-1">경로</span>
                <span className="w-14 shrink-0 text-right">파일</span>
                <span className="w-[74px] shrink-0 text-right">최근 수정</span>
                <span className="w-[26px] shrink-0" />
              </div>
              {paths.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px]" style={{ color: K.faint }}>
                  등록된 중요 경로가 없습니다.
                </div>
              ) : (
                paths.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2.5 border-b px-4 py-2 last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <span className="w-[30px] shrink-0" style={{ color: K.faint }}>
                      {row.drive}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={row.path}
                    >
                      {row.path}
                    </span>
                    <span className="w-14 shrink-0 text-right">
                      {row.file_count > 0 ? row.file_count : "—"}
                    </span>
                    <span
                      className="w-[74px] shrink-0 text-right"
                      style={{ color: K.faint }}
                    >
                      {row.latest_modified
                        ? formatKnowledgeDate(row.latest_modified).slice(5)
                        : "—"}
                    </span>
                    <button
                      type="button"
                      className="w-[26px] shrink-0 text-right"
                      style={{ color: K.faint }}
                      disabled={busyId === row.id}
                      onClick={() => void removePath(row.id)}
                      aria-label="삭제"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
              {remaining > 0 ? (
                <button
                  type="button"
                  className="w-full py-2.5 text-center text-[12px]"
                  style={{ color: K.faint }}
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  더 보기 · {remaining}개 남음
                </button>
              ) : null}
            </div>
          </ListCard>

          <div className="mt-3.5 grid grid-cols-1 gap-3.5 min-[901px]:grid-cols-2">
            <Box title="스캔 설정">
              <BoxRow
                left="실행 시각"
                right={
                  settings
                    ? `매일 ${formatScanTime(settings.scan_hour, settings.scan_minute)}`
                    : "—"
                }
              />
              <BoxRow
                left="대상 드라이브"
                right={settings?.drives?.replace(/,/g, " · ") || "—"}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn disabled>설정 변경</Btn>
                <Btn disabled>지금 스캔</Btn>
              </div>
            </Box>

            <Box title="스캔 이력">
              {history.length === 0 ? (
                <p className="text-[12px]" style={{ color: K.faint }}>
                  스캔 이력이 없습니다.
                </p>
              ) : (
                history.map((h, i) => {
                  const st = scanStatusLabel(h.status);
                  const d = new Date(h.ran_at);
                  const label = Number.isNaN(d.getTime())
                    ? "—"
                    : `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${formatScanTime(d.getHours(), d.getMinutes())}`;
                  return (
                    <div
                      key={i}
                      className="flex gap-2 text-[12.5px] leading-[2.05]"
                      style={{ color: K.sub }}
                    >
                      <span className="w-[84px] shrink-0">{label}</span>
                      <span className="w-10 shrink-0" style={{ color: st.color }}>
                        {st.text}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{h.note}</span>
                      <b className="shrink-0 font-bold" style={{ color: K.ink }}>
                        {formatDurationSec(h.duration_sec)}
                      </b>
                    </div>
                  );
                })
              )}
              <p className="mt-2.5 text-[11px]" style={{ color: K.faint }}>
                스캔은 회사 PC 로그온 세션에서만 실행됩니다
              </p>
            </Box>
          </div>
        </>
      ) : null}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </KnowledgeShell>
  );
}
