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
import { borrowSupply, getAvailableQuantity } from "@/lib/supplies/operations";
import { parseSupplyIdFromQr, supplyIdsMatch } from "@/lib/supplies/qr";
import { parseComponents, supplyDetailPath } from "@/lib/supplies/utils";
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
  const [availableQty, setAvailableQty] = useState<number>(0);
  const [loanQuantity, setLoanQuantity] = useState<number>(1);
  const [loanComponentRows, setLoanComponentRows] = useState<
    { name: string; qty: number; selected: boolean }[]
  >([]);

  useEffect(() => {
    setMobile(isMobileDevice());
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("supplies")
      .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT})`)
      .eq("id", id)
      .maybeSingle();

    if (!data) return;

    const mapped = mapSupplyRow(data as Record<string, unknown>);
    setSupply(mapped);

    const avail = await getAvailableQuantity(id);
    setAvailableQty(avail);

    const parsed = parseComponents(mapped.components).filter((row) => row.name.trim().length > 0);
    setLoanComponentRows(parsed.map((row) => ({ name: row.name, qty: row.qty, selected: true })));
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
        setToast("올바른 물품 QR 코드가 아닙니다. 다시 스캔해 주세요.");
        setScanKey((k) => k + 1);
        return;
      }
      if (!supply) {
        setToast("물품 정보를 불러오는 중입니다. 잠시 후 다시 스캔해 주세요.");
        setScanKey((k) => k + 1);
        return;
      }
      if (!supplyIdsMatch(scannedId, { id: supply.id, code: supply.code })) {
        setToast("다른 물품의 QR입니다. 다시 스캔해 주세요.");
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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
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

    const qtyRaw = (e.currentTarget.elements.namedItem("loanQuantity") as HTMLInputElement | null)?.value;
    const parsedQty = parseInt(qtyRaw ?? String(loanQuantity), 10);
    const resolvedLoanQuantity =
      Number.isFinite(parsedQty) && parsedQty >= 1 ? parsedQty : Math.max(1, Math.floor(Number(loanQuantity)) || 1);

    if (resolvedLoanQuantity < 1) {
      setError("대출 수량을 입력해 주세요.");
      return;
    }
    if (resolvedLoanQuantity > availableQty) {
      setError(`대출 가능 수량(${availableQty})을 초과했습니다.`);
      return;
    }

    const hasComponents = loanComponentRows.some((r) => r.name.trim().length > 0);
    const selectedComponents = hasComponents
      ? loanComponentRows
          .filter((r) => r.selected && r.name.trim() && r.qty > 0)
          .map((r) => `${r.name}:${r.qty}`)
          .join(",")
      : "";

    setStep("submitting");
    setError(null);
    const { error: err } = await borrowSupply({
      supplyId: supply.id,
      borrowerId: profile.id,
      purpose,
      dueDate,
      loanQuantity: resolvedLoanQuantity,
      loanComponents: selectedComponents || null
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
          물품 상세로
        </Link>
      </div>
    );
  }

  if (!supply) {
    return <p className="text-sm text-slate-500">물품을 찾을 수 없습니다.</p>;
  }

  const canBorrow =
    supply.status === "available" || supply.status === "partially_borrowed";
  const submitDisabled =
    step === "submitting" ||
    !canBorrow ||
    loanQuantity < 1 ||
    loanQuantity > availableQty;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href={supplyDetailPath(id)} className="text-sm font-medium text-violet-600 hover:underline">
        ← 상세
      </Link>
      <h1 className="text-xl font-bold text-slate-900">대출 신청</h1>

      {step === "scanning" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">물품에 부착된 QR 코드를 스캔해 주세요.</p>
          <SupplyInfoCard supply={supply} />
          <QrScanner key={scanKey} active={!scanConfirmOpen} onScan={handleQrScan} />
          <SupplyScanConfirmModal
            open={scanConfirmOpen}
            supply={supply}
            availableQty={availableQty}
            onConfirm={() => {
              setScanConfirmOpen(false);
              setStep("verified");
              setLoanQuantity(1);
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
            <div>
              <label className="text-sm font-medium text-slate-700">
                대출 수량
                <span className="ml-2 text-xs text-slate-500">
                  (대출 가능: {availableQty}개 / 전체: {supply.quantity}개)
                </span>
              </label>
              <input
                name="loanQuantity"
                type="number"
                min={1}
                max={availableQty}
                value={loanQuantity}
                onChange={(e) => {
                  const next = parseInt(e.target.value, 10);
                  setLoanQuantity(Number.isFinite(next) ? next : 0);
                }}
                className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {loanComponentRows.length > 0 && loanComponentRows[0].name ? (
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">대출 구성품</p>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {loanComponentRows.map((row, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => {
                            const next = [...loanComponentRows];
                            next[i] = { ...next[i], selected: e.target.checked };
                            setLoanComponentRows(next);
                          }}
                        />
                        {row.name}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={row.qty}
                        value={row.selected ? row.qty : 0}
                        disabled={!row.selected}
                        onChange={(e) => {
                          const next = [...loanComponentRows];
                          next[i] = { ...next[i], qty: Number(e.target.value) };
                          setLoanComponentRows(next);
                        }}
                        className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm disabled:opacity-40"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
              disabled={submitDisabled}
              className="w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {step === "submitting" ? "처리 중…" : "대출 신청 완료"}
            </button>
            {!canBorrow ? (
              <p className="text-center text-xs text-amber-700">현재 대출할 수 없는 상태입니다.</p>
            ) : null}
          </form>
        </div>
      )}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
