"use client";

import { useCallback, useEffect, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import { supabase } from "@/lib/supabase/client";

type ScanSettings = {
  id: number;
  enabled: boolean;
  scan_hour: number;
  scan_minute: number;
  drives: string;
  last_run_at: string | null;
  last_status: string | null;
  last_total: number | null;
  last_duration_sec: number | null;
  updated_at: string | null;
};

type ImportantPath = {
  id: string;
  drive: string;
  path: string;
  note: string | null;
  created_at: string;
  matched: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 10, 20, 30, 40, 50];

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function formatRunAt(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}`;
}

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s}초`;
  return `${m}분 ${s}초`;
}

function statusBadge(status: string | null): {
  label: string;
  className: string;
} {
  const s = (status ?? "").toLowerCase();
  if (s === "done") {
    return { label: status || "done", className: "bg-emerald-100 text-emerald-800" };
  }
  if (s === "running") {
    return { label: status || "running", className: "bg-amber-100 text-amber-900" };
  }
  if (s === "failed") {
    return { label: status || "failed", className: "bg-red-100 text-red-800" };
  }
  return { label: status || "-", className: "bg-slate-100 text-slate-600" };
}

function parsePastedPath(raw: string): { drive: string; path: string } | null {
  const trimmed = raw.trim();
  const m = trimmed.match(/^([A-Za-z]):[/\\](.*)$/);
  if (!m) return null;
  return {
    drive: m[1]!.toUpperCase(),
    path: m[2]!.replace(/\//g, "\\").replace(/^\\+/, "").trim()
  };
}

export function LunaNasTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [markedCount, setMarkedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [paths, setPaths] = useState<ImportantPath[]>([]);

  const [enabled, setEnabled] = useState(true);
  const [scanHour, setScanHour] = useState(3);
  const [scanMinute, setScanMinute] = useState(0);
  const [drives, setDrives] = useState("T,P");

  const [addDrive, setAddDrive] = useState("T");
  const [addPath, setAddPath] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [nasRes, pathsRes] = await Promise.all([
      fetch("/api/luna/nas", { headers }),
      fetch("/api/luna/nas/paths", { headers })
    ]);

    if (nasRes.ok) {
      const json = (await nasRes.json()) as {
        settings?: ScanSettings | null;
        marked_count?: number;
        total_count?: number;
      };
      const s = json.settings ?? null;
      setSettings(s);
      setMarkedCount(json.marked_count ?? 0);
      setTotalCount(json.total_count ?? 0);
      if (s) {
        setEnabled(s.enabled === true);
        setScanHour(typeof s.scan_hour === "number" ? s.scan_hour : 3);
        setScanMinute(typeof s.scan_minute === "number" ? s.scan_minute : 0);
        setDrives(typeof s.drives === "string" && s.drives ? s.drives : "T,P");
      }
    } else {
      setToast(`불러오기 실패: ${await nasRes.text()}`);
    }

    if (pathsRes.ok) {
      const json = (await pathsRes.json()) as { paths?: ImportantPath[] };
      setPaths(json.paths ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    const token = await getAccessToken();
    if (!token || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/luna/nas", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled,
          scan_hour: scanHour,
          scan_minute: scanMinute,
          drives
        })
      });
      if (!res.ok) {
        setToast(`저장 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { settings?: ScanSettings };
      if (json.settings) setSettings(json.settings);
      setToast("설정은 최대 10분 뒤 스캐너에 반영됩니다");
    } finally {
      setSaving(false);
    }
  }

  async function addSingle() {
    const token = await getAccessToken();
    if (!token || adding) return;

    let drive = addDrive;
    let path = addPath.trim();
    const parsed = parsePastedPath(path);
    if (parsed) {
      drive = parsed.drive;
      path = parsed.path;
    }
    if (!path) {
      setToast("경로를 입력하세요");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/luna/nas/paths", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ drive, path })
      });
      if (!res.ok) {
        setToast(`추가 실패: ${await res.text()}`);
        return;
      }
      setAddPath("");
      setToast("추가했습니다");
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function addBulk() {
    const token = await getAccessToken();
    if (!token || adding) return;
    const bulk = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (bulk.length === 0) {
      setToast("경로를 입력하세요");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/luna/nas/paths", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bulk })
      });
      if (!res.ok) {
        setToast(`추가 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { inserted?: number };
      setBulkText("");
      setBulkMode(false);
      setToast(`${json.inserted ?? 0}건 추가했습니다`);
      await load();
    } finally {
      setAdding(false);
    }
  }

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

  async function applyImportance() {
    const token = await getAccessToken();
    if (!token || applying) return;
    setApplying(true);
    try {
      const res = await fetch("/api/luna/nas/paths/apply", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setToast(`마킹 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { result?: unknown };
      setToast(
        typeof json.result === "number" || typeof json.result === "string"
          ? `마킹 완료: ${json.result}`
          : "마킹을 다시 적용했습니다"
      );
      await load();
    } finally {
      setApplying(false);
    }
  }

  function onPathInputChange(value: string) {
    const parsed = parsePastedPath(value);
    if (parsed && !value.includes("\n")) {
      setAddDrive(parsed.drive);
      setAddPath(parsed.path);
      return;
    }
    setAddPath(value);
  }

  if (loading) {
    return <p className="text-[12px] text-slate-500">불러오는 중…</p>;
  }

  const badge = statusBadge(settings?.last_status ?? null);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-slate-800">스캔 설정</h3>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            자동 스캔 켜기
          </label>
          <label className="text-[12px] text-slate-600">
            시
            <select
              className="ml-1 rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={scanHour}
              onChange={(e) => setScanHour(Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            분
            <select
              className="ml-1 rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={scanMinute}
              onChange={(e) => setScanMinute(Number(e.target.value))}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 text-[12px] text-slate-600 sm:min-w-[160px]">
            대상 드라이브
            <input
              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 font-mono text-[12px]"
              value={drives}
              onChange={(e) => setDrives(e.target.value)}
              placeholder="T,P"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveSettings()}
            className="rounded-lg bg-[#534AB7] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          설정은 최대 10분 뒤 스캐너에 반영됩니다
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-slate-800">최근 실행</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">마지막 실행</p>
            <p className="text-[13px] font-medium text-slate-900">
              {formatRunAt(settings?.last_run_at ?? null)}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">상태</p>
            <span
              className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">인덱싱 건수</p>
            <p className="text-[13px] font-medium text-slate-900">
              {(settings?.last_total ?? 0).toLocaleString("ko-KR")}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] text-slate-500">소요 시간</p>
            <p className="text-[13px] font-medium text-slate-900">
              {formatDuration(settings?.last_duration_sec ?? null)}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">
          전체 인덱스 {totalCount.toLocaleString("ko-KR")}건
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-800">
            중요 경로
            <span className="ml-1.5 font-normal text-slate-400">
              ({paths.length})
            </span>
          </h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setBulkMode((v) => !v)}
              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
            >
              {bulkMode ? "단일 입력" : "여러 줄 입력"}
            </button>
            {!bulkMode ? (
              <button
                type="button"
                onClick={() => void addSingle()}
                disabled={adding}
                className="rounded bg-[#534AB7] px-2 py-1 text-[11px] text-white disabled:opacity-50"
              >
                ＋ 추가
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void addBulk()}
                disabled={adding}
                className="rounded bg-[#534AB7] px-2 py-1 text-[11px] text-white disabled:opacity-50"
              >
                일괄 등록
              </button>
            )}
          </div>
        </div>

        {bulkMode ? (
          <textarea
            className="h-28 w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
            placeholder={"T:\\02 Project\\2024\\프로젝트명\\01 Planning\nP:\\..."}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className="rounded border border-slate-200 px-2 py-1 text-[12px]"
              value={addDrive}
              onChange={(e) => setAddDrive(e.target.value)}
            >
              <option value="T">T</option>
              <option value="P">P</option>
            </select>
            <input
              className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 font-mono text-[11px] sm:min-w-[240px]"
              value={addPath}
              onChange={(e) => onPathInputChange(e.target.value)}
              placeholder="02 Project\2024\프로젝트명\01 Planning"
            />
          </div>
        )}
        <p className="text-[11px] text-slate-500">
          T:\ 를 뺀 경로만. 예) 02 Project\2024\프로젝트명\01 Planning
        </p>

        <div className="max-h-[360px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {paths.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-slate-400">
              등록된 중요 경로가 없습니다.
            </p>
          ) : (
            paths.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${
                    p.drive.toUpperCase() === "P"
                      ? "bg-teal-100 text-teal-800"
                      : "bg-[#EEEDFE] text-[#26215C]"
                  }`}
                >
                  {p.drive}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-800">
                  {p.path}
                </span>
                {p.matched ? (
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                    title="매칭됨"
                  />
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
                    경로 없음
                  </span>
                )}
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => void removePath(p.id)}
                  className="shrink-0 text-[11px] text-slate-500 hover:text-red-600 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold text-slate-800">마킹 상태</h3>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12px] text-slate-700">
            현재 마킹된 항목{" "}
            <span className="font-semibold">
              {markedCount.toLocaleString("ko-KR")}
            </span>
            건
          </p>
          <button
            type="button"
            disabled={applying}
            onClick={() => void applyImportance()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:border-[#534AB7] disabled:opacity-50"
          >
            {applying ? "적용 중…" : "지금 마킹 다시 적용"}
          </button>
        </div>
      </section>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
