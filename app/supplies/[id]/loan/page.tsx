"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { QrScanner } from "@/components/supplies/qr-scanner";
import { SupplyInfoCard } from "@/components/supplies/supply-info-card";
import { SupplyScanConfirmModal } from "@/components/supplies/supply-scan-confirm-modal";
import { SupplyToast } from "@/components/supplies/toast";
import { isMobileDevice } from "@/lib/supplies/device";
import { mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { borrowSupply } from "@/lib/supplies/operations";
import { parseSupplyIdFromQr, supplyIdsMatch } from "@/lib/supplies/qr";
import { supplyDetailPath } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

type LoanStep = "scanning" | "verified" | "submitting";

export default function SupplyLoanPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [step, setStep] = useState<LoanStep>("scanning");
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    setMobile(isMobileDevice());
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("supplies")
      .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT})`)
      .eq("id", id)
      .maybeSingle();

    if (data) setSupply(mapSupplyRow(data as Record<string, unknown>));
  }, [id]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setDueDate(d.toISOString().slice(0, 10));
  }, [status, load]);

  const handleQrScan = useCallback(
    (decodedText: string) => {
      const scannedId = parseSupplyIdFromQr(decodedText);
      if (!scannedId) {
        setToast("올바른 비품 QR 코드가 아닙니다. 다시 스캔해 주세요.");
        setScanKey((k) => k + 1);
        return;
      }
      if (!supply) {
        setToast("비품 정보를 불러오는 중입니다. 잠시 후 다시 스캔해 주세요.");
        setScanKey((k) => k + 1);
        return;
      }
      if (!supplyIdsMatch(scannedId, { id: supply.id, code: supply.code })) {
        setToast("다른 비품의 QR입니다. 다시 스캔해 주세요.");
        setScanKey((k) => k + 1);
        return;
      }
      setToast(null);
      setScanConfirmOpen(true);
    },
    [supply]
  );

  const handleRescan = () => {
    setError(null);
    setScanConfirmOpen(false);
    setStep("scanning");
    setScanKey((k) => k + 1);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile?.id || !supply) return;
    if (!purpose.trim()) {
      setError("사용 목적을 입력해 주세요.");
      return;
    }
    if (!dueDate) {
      setError("반납예정일을 선택해 주세요.");
      return;
    }

    setStep("submitting");
    setError(null);
    const { error: err } = await borrowSupply({
      supplyId: supply.id,
      borrowerId: profile.id,
      purpose,
      dueDate
    });
    if (err) {
      setStep("verified");
      setError(err);
      return;
    }
    router.push(supplyDetailPath(supply.id));
  };

  if (status !== "ready") return null;

  if (!mobile) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-semibold text-slate-900">모바일에서만 사용 가능합니다</p>
        <p className="mt-2 text-sm text-slate-600">대출 신청은 스마트폰에서 QR 스캔 후 진행해 주세요.</p>
        <Link href={supplyDetailPath(id)} className="mt-6 inline-block text-sm font-medium text-violet-600 hover:underline">
          비품 상세로
        </Link>
      </div>
    );
  }

  if (!supply) {
    return <p className="text-sm text-slate-500">비품을 찾을 수 없습니다.</p>;
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href={supplyDetailPath(id)} className="text-sm font-medium text-violet-600 hover:underline">
        ← 상세
      </Link>
      <h1 className="text-xl font-bold text-slate-900">대출 신청</h1>

      {step === "scanning" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">비품에 부착된 QR 코드를 스캔해 주세요.</p>
          <SupplyInfoCard supply={supply} />
          <QrScanner key={scanKey} active={!scanConfirmOpen} onScan={handleQrScan} />
          <SupplyScanConfirmModal
            open={scanConfirmOpen}
            supply={supply}
            onConfirm={() => {
              setScanConfirmOpen(false);
              setStep("verified");
            }}
            onRescan={() => {
              setScanConfirmOpen(false);
              setScanKey((k) => k + 1);
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-emerald-700">QR 확인 완료</p>
            <button
              type="button"
              onClick={handleRescan}
              disabled={step === "submitting"}
              className="text-sm font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50"
            >
              다시 스캔
            </button>
          </div>
          <SupplyInfoCard supply={supply} />
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <label className="block text-sm font-medium text-slate-700">
              사용 목적 <span className="text-rose-600">*</span>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              반납예정일 <span className="text-rose-600">*</span>
              <input
                type="date"
                value={dueDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </label>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <button
              type="submit"
              disabled={step === "submitting" || supply.status !== "available"}
              className="w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {step === "submitting" ? "처리 중…" : "대출 신청 완료"}
            </button>
            {supply.status !== "available" ? (
              <p className="text-center text-xs text-amber-700">현재 대출할 수 없는 상태입니다.</p>
            ) : null}
          </form>
        </div>
      )}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
