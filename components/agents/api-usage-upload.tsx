"use client";

import { useCallback, useRef, useState } from "react";
import {
  extractCsvDateRange,
  formatCsvEmptyRangeMessage,
  formatUsd,
  parseUsageCsv,
  type ApiUsageProvider,
  type ApiUsageRow
} from "@/lib/arte/api-usage";
import { supabase } from "@/lib/supabase/client";

const PROVIDERS: { id: ApiUsageProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" }
];

type Props = {
  onSaved?: () => void;
};

export function ApiUsageUpload({ onSaved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<ApiUsageProvider>("openai");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApiUsageRow[] | null>(null);
  const [emptyRange, setEmptyRange] = useState<{ min: string; max: string } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const resetPreview = useCallback(() => {
    setPreview(null);
    setEmptyRange(null);
    setParseError(null);
    setSaveMsg(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      resetPreview();
      setFileName(file.name);
      try {
        const text = await file.text();
        const rows = parseUsageCsv(provider, text);
        if (rows.length === 0) {
          const range = extractCsvDateRange(provider, text);
          setPreview(null);
          setParseError(null);
          if (range) {
            setEmptyRange(range);
          } else {
            setEmptyRange(null);
            setParseError("CSV에서 날짜를 찾을 수 없습니다. 파일 형식을 확인해 주세요.");
          }
          return;
        }
        setEmptyRange(null);
        setPreview(rows);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "CSV 파싱 실패");
      }
    },
    [provider, resetPreview]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onSave = useCallback(async () => {
    if (!preview?.length) return;
    setSaving(true);
    setSaveMsg(null);

    const {
      data: { session }
    } = await supabase.auth.getSession();
    const uploadedBy = session?.user?.id ?? null;
    const uploadedAt = new Date().toISOString();

    const payload = preview.map((r) => ({
      provider: r.provider,
      date: r.date,
      model: r.model,
      api_key_label: r.api_key_label,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      input_cost_usd: r.input_cost_usd,
      output_cost_usd: r.output_cost_usd,
      cost_usd: r.cost_usd,
      uploaded_by: uploadedBy,
      created_at: uploadedAt
    }));

    const { error } = await supabase.from("api_usage").upsert(payload, {
      onConflict: "provider,date,model,api_key_label"
    });

    setSaving(false);
    if (error) {
      console.error("[api_usage upsert]", error);
      setSaveMsg(`저장 실패: ${error.message}`);
      return;
    }

    setSaveMsg(`${preview.length}건 저장되었습니다.`);
    setPreview(null);
    setFileName(null);
    onSaved?.();
  }, [preview, onSaved]);

  const previewTotal = preview?.reduce((s, r) => s + r.cost_usd, 0) ?? 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">출처 선택</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProvider(p.id);
                resetPreview();
                setFileName(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                provider === p.id
                  ? p.id === "anthropic"
                    ? "bg-violet-600 text-white"
                    : "bg-emerald-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragOver
            ? "border-violet-400 bg-violet-50/50"
            : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className="text-sm font-medium text-slate-800">CSV 파일을 드래그하거나 선택하세요</p>
        <p className="mt-1 text-xs text-slate-500">
          {provider === "anthropic"
            ? "Anthropic Usage Export (usage_date_utc, model, api_key, token_type, cost_usd …)"
            : "OpenAI Usage Export (start_time_iso, model, api_key_id, input_tokens, output_tokens …)"}
        </p>
        <button
          type="button"
          className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          onClick={() => inputRef.current?.click()}
        >
          파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        {fileName ? <p className="mt-3 text-xs text-slate-600">선택: {fileName}</p> : null}
      </section>

      {parseError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {parseError}
        </p>
      ) : null}

      {emptyRange ? (
        <p
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          role="status"
        >
          이 기간에 사용 데이터가 없습니다. 건너뜁니다.
          <span className="mt-1 block text-emerald-700">{formatCsvEmptyRangeMessage(emptyRange)}</span>
        </p>
      ) : null}

      {preview ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">파싱 미리보기</h2>
          <p className="mt-2 text-sm text-slate-600">
            저장 예정 <span className="font-semibold text-slate-900">{preview.length}건</span>
            {" · "}
            합계 비용 <span className="font-semibold text-violet-700">{formatUsd(previewTotal)}</span>
          </p>
          <div className="mt-3 max-h-48 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">날짜</th>
                  <th className="px-3 py-2">모델</th>
                  <th className="px-3 py-2">API 키</th>
                  <th className="px-3 py-2 text-right">Input $</th>
                  <th className="px-3 py-2 text-right">Output $</th>
                  <th className="px-3 py-2 text-right">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.slice(0, 20).map((row, i) => (
                  <tr key={`${row.date}-${row.model}-${row.api_key_label}-${i}`}>
                    <td className="px-3 py-1.5">{row.date}</td>
                    <td className="max-w-[140px] truncate px-3 py-1.5" title={row.model}>
                      {row.model}
                    </td>
                    <td className="max-w-[100px] truncate px-3 py-1.5" title={row.api_key_label}>
                      {row.api_key_label}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(row.input_cost_usd)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatUsd(row.output_cost_usd)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {formatUsd(row.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 20 ? (
            <p className="mt-2 text-xs text-slate-500">외 {preview.length - 20}건…</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "Supabase에 저장"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setPreview(null);
                setEmptyRange(null);
                setFileName(null);
              }}
            >
              취소
            </button>
          </div>
        </section>
      ) : null}

      {saveMsg ? (
        <p
          className={`text-sm ${saveMsg.startsWith("저장 실패") ? "text-rose-700" : "text-emerald-700"}`}
          role="status"
        >
          {saveMsg}
        </p>
      ) : null}
    </div>
  );
}
