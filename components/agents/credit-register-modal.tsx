"use client";
import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

type ParsedInfo = {
  service_name: string;
  payment_type: string;
  amount_krw: string;
  paid_at: string;
  memo: string;
};

const PAYMENT_TYPES = ["크레딧", "초과결제", "기타"];

export function CreditRegisterModal({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<"upload" | "confirm">("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [form, setForm] = useState<ParsedInfo>({
    service_name: "",
    payment_type: "크레딧",
    amount_krw: "",
    paid_at: new Date().toISOString().slice(0, 10),
    memo: ""
  });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (file: File) => {
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleAnalyze = async () => {
    if (!imageFile) return;
    setParsing(true);
    setParseError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
      });
      const res = await fetch("/api/arte/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType: imageFile.type })
      });
      if (!res.ok) throw new Error("분석 실패");
      const parsed = (await res.json()) as Partial<ParsedInfo>;
      setForm((prev) => ({
        ...prev,
        service_name: parsed.service_name ?? prev.service_name,
        payment_type: parsed.payment_type ?? prev.payment_type,
        amount_krw: parsed.amount_krw ?? prev.amount_krw,
        paid_at: parsed.paid_at ?? prev.paid_at,
        memo: parsed.memo ?? prev.memo
      }));
      setStep("confirm");
    } catch {
      setParseError("이미지 분석에 실패했습니다. 수동으로 입력해 주세요.");
      setStep("confirm");
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!form.service_name || !form.amount_krw || !form.paid_at) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let image_path: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() ?? "jpg";
        const path = `receipts/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("credit-images")
          .upload(path, imageFile);
        if (!uploadError) image_path = path;
      }
      const { error } = await supabase.from("credit_records").insert({
        service_name: form.service_name,
        payment_type: form.payment_type,
        amount_krw: Number(form.amount_krw.replace(/,/g, "")),
        paid_at: form.paid_at,
        memo: form.memo || null,
        image_path,
        registered_by: user?.id ?? null
      });
      if (error) throw error;
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const skipToManual = () => setStep("confirm");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">크레딧 · 추가 결제 등록</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="mb-6 flex items-center gap-2 text-xs">
          {(["upload", "confirm"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-8 bg-slate-200" />}
              <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium ${
                step === s ? "bg-violet-600 text-white" :
                (step === "confirm" && s === "upload") ? "bg-violet-600 text-white" :
                "bg-slate-100 text-slate-400"
              }`}>{i + 1}</div>
              <span className={step === s ? "font-medium text-violet-700" : "text-slate-400"}>
                {s === "upload" ? "이미지 업로드" : "정보 확인·수정"}
              </span>
            </div>
          ))}
        </div>

        {step === "upload" && (
          <div className="space-y-4">
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 p-8 hover:border-violet-300 hover:bg-violet-50 transition"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFileChange(file);
              }}
            >
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="미리보기" className="max-h-40 rounded-lg object-contain" />
              ) : (
                <>
                  <div className="text-3xl text-slate-300">📎</div>
                  <p className="text-sm font-medium text-slate-700">영수증 · 결제화면 이미지 업로드</p>
                  <p className="text-xs text-slate-400">JPG · PNG · PDF · 스크린샷 모두 가능</p>
                  <p className="text-xs text-slate-400">업로드하면 금액·날짜·서비스명을 자동으로 읽어드려요</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
            />
            {imageFile && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={parsing}
                  className="flex-1 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {parsing ? "분석 중…" : "AI로 정보 읽기"}
                </button>
              </div>
            )}
            <button type="button" onClick={skipToManual} className="w-full text-center text-xs text-slate-400 hover:text-slate-600">
              이미지 없이 직접 입력하기 →
            </button>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            {parseError && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{parseError}</p>
            )}
            {!parseError && imageFile && (
              <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
                ✦ 이미지에서 정보를 읽었습니다. 내용을 확인하고 수정해 주세요.
              </p>
            )}
            {imagePreviewUrl && (
              <div className="flex items-center gap-3">
                <img src={imagePreviewUrl} alt="첨부 이미지" className="h-14 w-14 rounded-lg object-cover border border-slate-200" />
                <button type="button" onClick={() => setStep("upload")} className="text-xs text-violet-600 hover:underline">
                  이미지 교체
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">서비스명</label>
                <input
                  type="text"
                  value={form.service_name}
                  onChange={(e) => setForm((p) => ({ ...p, service_name: e.target.value }))}
                  placeholder="예: Hailuo"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">결제 유형</label>
                <select
                  value={form.payment_type}
                  onChange={(e) => setForm((p) => ({ ...p, payment_type: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">결제 금액 (원)</label>
                <input
                  type="text"
                  value={form.amount_krw}
                  onChange={(e) => setForm((p) => ({ ...p, amount_krw: e.target.value }))}
                  placeholder="예: 45000"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">결제 날짜</label>
                <input
                  type="date"
                  value={form.paid_at}
                  onChange={(e) => setForm((p) => ({ ...p, paid_at: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">메모 (선택)</label>
              <input
                type="text"
                value={form.memo}
                onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
                placeholder="예: 영상 제작용 크레딧 충전"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !form.service_name || !form.amount_krw}
                className="flex-1 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "저장 중…" : "등록 완료"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
