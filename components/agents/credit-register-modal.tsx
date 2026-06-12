"use client";
import { useCallback, useRef, useState } from "react";
import { fetchUsdKrwRateForDate, formatKrw } from "@/lib/arte/usd-krw-rate";
import { supabase } from "@/lib/supabase/client";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

type ParsedInfo = {
  service_name: string;
  payment_type: string;
  amount: string;
  currency: string;
  amount_krw: string;
  usd_krw_rate: number | null;
  paid_at: string;
  memo: string;
};

type ParseReceiptResponse = {
  service_name?: string;
  payment_type?: string;
  amount?: string;
  currency?: string;
  amount_krw?: string;
  paid_at?: string;
  memo?: string;
};

const PAYMENT_TYPES = ["크레딧", "초과결제", "기타"];
const CURRENCIES = ["KRW", "USD"] as const;

const emptyForm = (): ParsedInfo => ({
  service_name: "",
  payment_type: "크레딧",
  amount: "",
  currency: "KRW",
  amount_krw: "",
  usd_krw_rate: null,
  paid_at: new Date().toISOString().slice(0, 10),
  memo: ""
});

async function convertAmountToKrw(
  amount: string,
  currency: string,
  paidAt: string
): Promise<{ amount_krw: string; usd_krw_rate: number | null }> {
  const num = parseFloat(amount.replace(/,/g, "")) || 0;
  if (currency === "USD") {
    const rate = await fetchUsdKrwRateForDate(paidAt);
    return { amount_krw: String(Math.round(num * rate)), usd_krw_rate: rate };
  }
  return { amount_krw: String(Math.round(num)), usd_krw_rate: null };
}

async function resizeImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 1200;
      let { width, height } = img;
      if (width <= MAX && height <= MAX) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      if (width > height) {
        height = Math.round((height * MAX) / width);
        width = MAX;
      } else {
        width = Math.round((width * MAX) / height);
        height = MAX;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
              type: "image/jpeg",
              lastModified: Date.now()
            })
          );
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function CreditRegisterModal({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<"upload" | "confirm">("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState<string | false>(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [form, setForm] = useState<ParsedInfo>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyConversion = useCallback(async (next: ParsedInfo) => {
    if (!next.amount.trim()) {
      setForm({ ...next, amount_krw: "", usd_krw_rate: null });
      return;
    }
    setConverting(true);
    try {
      const converted = await convertAmountToKrw(next.amount, next.currency, next.paid_at);
      setForm({ ...next, ...converted });
    } finally {
      setConverting(false);
    }
  }, []);

  const handleFileChange = async (file: File) => {
    const resized = await resizeImage(file);
    setImageFile(resized);
    setStoragePath(null);
    setImagePreviewUrl(URL.createObjectURL(resized));
  };

  const handleAnalyze = async () => {
    if (!imageFile) return;
    setParsing("업로드 중... (1/2)");
    setParseError(null);
    try {
      const ext = imageFile.name.split(".").pop() ?? "jpg";
      const path = `temp/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("credit-images")
        .upload(path, imageFile);
      if (uploadError) throw uploadError;
      setStoragePath(path);

      setParsing("AI 분석 중... (2/2)");
      const res = await fetch("/api/arte/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: path, mediaType: imageFile.type })
      });
      if (!res.ok) throw new Error("분석 실패");
      const parsed = (await res.json()) as ParseReceiptResponse;

      const currency =
        parsed.currency === "USD" || parsed.currency === "KRW"
          ? parsed.currency
          : parsed.amount_krw
            ? "KRW"
            : "KRW";
      const amount = parsed.amount ?? parsed.amount_krw ?? "";
      const paidAt = parsed.paid_at || form.paid_at;

      const next: ParsedInfo = {
        ...form,
        service_name: parsed.service_name ?? form.service_name,
        payment_type: parsed.payment_type ?? form.payment_type,
        amount,
        currency,
        paid_at: paidAt,
        memo: parsed.memo ?? form.memo,
        amount_krw: "",
        usd_krw_rate: null
      };

      if (amount) {
        const converted = await convertAmountToKrw(amount, currency, paidAt);
        setForm({ ...next, ...converted });
      } else {
        setForm(next);
      }
      setStep("confirm");
    } catch {
      setParseError("이미지 분석에 실패했습니다. 수동으로 입력해 주세요.");
      setStep("confirm");
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!form.service_name || !form.amount || !form.paid_at || !form.amount_krw) return;

    const amountKrw = Number(form.amount_krw.replace(/,/g, ""));
    const { data: duplicates, error: dupError } = await supabase
      .from("credit_records")
      .select("id")
      .eq("service_name", form.service_name)
      .eq("amount_krw", amountKrw)
      .eq("paid_at", form.paid_at);

    if (dupError) {
      console.error(dupError);
      return;
    }

    if ((duplicates?.length ?? 0) > 0) {
      const amountLabel = amountKrw.toLocaleString("ko-KR", { style: "currency", currency: "KRW" });
      const confirmed = window.confirm(
        `동일한 등록 내역이 이미 있습니다.\n(서비스: ${form.service_name}, 금액: ${amountLabel}, 날짜: ${form.paid_at})\n그래도 등록하시겠습니까?`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const [{ data: { user } }, { data: { session } }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession()
      ]);
      let registeredByName = "—";
      if (user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();
        registeredByName = profile?.name?.trim() || "—";
      }
      let image_path: string | null = storagePath;
      if (!image_path && imageFile) {
        const ext = imageFile.name.split(".").pop() ?? "jpg";
        const path = `temp/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("credit-images")
          .upload(path, imageFile);
        if (!uploadError) image_path = path;
      }
      const amountUsd = form.currency === "USD" ? parseFloat(form.amount.replace(/,/g, "")) : null;
      const { error } = await supabase.from("credit_records").insert({
        service_name: form.service_name,
        payment_type: form.payment_type,
        amount_krw: amountKrw,
        amount_usd: amountUsd,
        usd_krw_rate: form.usd_krw_rate,
        currency: form.currency,
        paid_at: form.paid_at,
        memo: form.memo || null,
        image_path,
        registered_by: user?.id ?? null
      });
      if (error) throw error;

      if (session?.access_token) {
        void fetch("/api/arte/notify-credit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            service_name: form.service_name,
            payment_type: form.payment_type,
            amount_krw: amountKrw,
            amount_usd: amountUsd,
            usd_krw_rate: form.usd_krw_rate,
            currency: form.currency,
            paid_at: form.paid_at,
            memo: form.memo || null,
            registered_by_name: registeredByName
          })
        }).catch((notifyError) => {
          console.error("[notify-credit]", notifyError);
        });
      }

      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const skipToManual = () => setStep("confirm");

  const krwPreview =
    form.currency === "USD" && form.amount_krw && form.usd_krw_rate
      ? `≈ ${formatKrw(Number(form.amount_krw))} (1$ = ${form.usd_krw_rate.toLocaleString("ko-KR")}원 기준)`
      : null;

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
                if (file) void handleFileChange(file);
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
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileChange(f); }}
            />
            {imageFile && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={!!parsing}
                  className="flex-1 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {parsing || "AI로 정보 읽기"}
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
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500">결제 금액</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.amount}
                    onChange={(e) => {
                      const next = { ...form, amount: e.target.value };
                      void applyConversion(next);
                    }}
                    placeholder={form.currency === "USD" ? "예: 50.00" : "예: 45000"}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <select
                    value={form.currency}
                    onChange={(e) => {
                      const next = { ...form, currency: e.target.value };
                      void applyConversion(next);
                    }}
                    className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {form.currency === "USD" && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {converting ? "환율 계산 중…" : krwPreview ?? "금액을 입력하면 원화 환산액이 표시됩니다."}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">결제 날짜</label>
                <input
                  type="date"
                  value={form.paid_at}
                  onChange={(e) => {
                    const next = { ...form, paid_at: e.target.value };
                    void applyConversion(next);
                  }}
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
                disabled={saving || converting || !form.service_name || !form.amount || !form.amount_krw}
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
