"use client";

import { useCallback, useEffect, useState } from "react";
import { SupplyToast } from "@/components/supplies/toast";
import {
  cacheNasPathSettings,
  DEFAULT_NAS_PATH_SETTINGS,
  OFFICE_PREFIX_P,
  OFFICE_PREFIX_T,
  serializeNasPathSettings,
  UNC_PREFIX_P,
  UNC_PREFIX_T,
  type NasPathDisplayMode,
  type NasPathSettings
} from "@/lib/luna/nas-path-settings";
import { formatNasFolderPath } from "@/lib/luna/nas-path";
import { supabase } from "@/lib/supabase/client";

const SAMPLE_PATH = "01 사업개발\\2025\\250213 성수동2가 316-52 미디어조형물\\02 Document";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaNasPathSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<NasPathDisplayMode>("office");
  const [prefixT, setPrefixT] = useState("");
  const [prefixP, setPrefixP] = useState("");

  const draftSettings: NasPathSettings = { mode, prefixT, prefixP };

  const previewT = formatNasFolderPath("T", SAMPLE_PATH, draftSettings, false).replace(
    /\\+$/,
    ""
  );
  const previewP = formatNasFolderPath("P", "01 사업개발\\2025", draftSettings, false).replace(
    /\\+$/,
    ""
  );

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const res = await fetch("/api/luna/nas/path-settings", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const json = (await res.json()) as {
        settings?: NasPathSettings;
      };
      const s = json.settings ?? DEFAULT_NAS_PATH_SETTINGS;
      setMode(s.mode);
      setPrefixT(s.prefixT);
      setPrefixP(s.prefixP);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function save() {
    const token = await getAccessToken();
    if (!token || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/luna/nas/path-settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(serializeNasPathSettings(draftSettings))
      });
      if (!res.ok) {
        setToast(`저장 실패: ${await res.text()}`);
        return;
      }
      cacheNasPathSettings(draftSettings);
      setToast("경로 표기 설정을 저장했습니다");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-[12px] text-slate-500">경로 설정 불러오는 중…</p>;
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-[13px] font-semibold text-slate-800">경로 표기 방식</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          자료 카드·복사 경로 앞에 붙는 접두사입니다. DB 경로 본문은 바꾸지 않습니다.
        </p>
      </div>

      <div className="space-y-2.5 text-[12px] text-slate-700">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="nas-path-mode"
            checked={mode === "office"}
            onChange={() => setMode("office")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">사무실 PC</span>
            <span className="ml-2 font-mono text-[11px] text-slate-500">
              {OFFICE_PREFIX_T} · {OFFICE_PREFIX_P}
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="nas-path-mode"
            checked={mode === "custom"}
            onChange={() => setMode("custom")}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium">원격 (RaiDrive 등)</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                type="text"
                disabled={mode !== "custom"}
                value={prefixT}
                onChange={(e) => setPrefixT(e.target.value)}
                placeholder="Z:\Work\"
                className="min-w-[140px] flex-1 rounded border border-slate-200 px-2 py-1 font-mono text-[11px] disabled:bg-slate-50"
                aria-label="T Work 접두사"
              />
              <span className="text-slate-400">·</span>
              <input
                type="text"
                disabled={mode !== "custom"}
                value={prefixP}
                onChange={(e) => setPrefixP(e.target.value)}
                placeholder="Z:\Partners\"
                className="min-w-[140px] flex-1 rounded border border-slate-200 px-2 py-1 font-mono text-[11px] disabled:bg-slate-50"
                aria-label="P Partners 접두사"
              />
            </div>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="nas-path-mode"
            checked={mode === "unc"}
            onChange={() => setMode("unc")}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">UNC</span>
            <span className="ml-2 font-mono text-[11px] text-slate-500">
              {UNC_PREFIX_T} · {UNC_PREFIX_P}
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-lg bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          미리보기 (T)
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-700" title={previewT}>
          {previewT}
        </p>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          미리보기 (P)
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-700" title={previewP}>
          {previewP}
        </p>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="rounded-lg bg-[#534AB7] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
      >
        {saving ? "저장 중…" : "저장"}
      </button>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </section>
  );
}
