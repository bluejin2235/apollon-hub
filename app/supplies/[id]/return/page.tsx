"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { QrScanner } from "@/components/supplies/qr-scanner";
import { SupplyInfoCard } from "@/components/supplies/supply-info-card";
import { SupplyScanConfirmModal } from "@/components/supplies/supply-scan-confirm-modal";
import { SupplyToast } from "@/components/supplies/toast";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyLocation, mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { getActiveLoanForUser, getAvailableQuantity, returnSupply } from "@/lib/supplies/operations";
import { parseSupplyIdFromQr, supplyIdsMatch } from "@/lib/supplies/qr";
import { uploadReturnImage } from "@/lib/supplies/storage";
import { parseComponents, supplyDetailPath } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

type ReturnStep = "scanning" | "verified" | "submitting";

type ActiveLoan = {
  id: string;
  purpose: string;
  due_date: string;
  borrowed_at: string;
  loan_quantity: number;
  loan_components: string | null;
};

type ReturnComponentRow = {
  name: string;
  qty: number;
  selected: boolean;
  maxQty: number;
};

function buildReturnOps(
  loans: ActiveLoan[],
  selectedRows: { name: string; qty: number }[]
): Array<{ loanId: string; returnQuantity: number; returnComponents: string | null }> {
  const remaining = new Map(selectedRows.map((r) => [r.name, r.qty]));
  const sorted = [...loans].sort(
    (a, b) => new Date(a.borrowed_at).getTime() - new Date(b.borrowed_at).getTime()
  );
  const ops: Array<{ loanId: string; returnQuantity: number; returnComponents: string | null }> =
    [];

  for (const loan of sorted) {
    const parts = parseComponents(loan.loan_components).filter(
      (r) => r.name.trim() && r.qty > 0
    );

    if (parts.length === 0) {
      const totalRemaining = [...remaining.values()].reduce((s, v) => s + v, 0);
      if (totalRemaining <= 0) continue;
      const retQty = Math.min(loan.loan_quantity ?? 1, totalRemaining);
      const firstKey = remaining.keys().next().value;
      if (firstKey) {
        remaining.set(firstKey, (remaining.get(firstKey) ?? 0) - retQty);
      }
      ops.push({ loanId: loan.id, returnQuantity: retQty, returnComponents: null });
      continue;
    }

    const loanParts: string[] = [];
    let loanReturnQty = 0;
    for (const part of parts) {
      const avail = remaining.get(part.name) ?? 0;
      if (avail <= 0) continue;
      const take = Math.min(part.qty, avail);
      if (take > 0) {
        loanParts.push(`${part.name}:${take}`);
        remaining.set(part.name, avail - take);
        loanReturnQty += take;
      }
    }
    if (loanReturnQty > 0) {
      ops.push({
        loanId: loan.id,
        returnQuantity: loanReturnQty,
        returnComponents: loanParts.join(",") || null
      });
    }
  }

  return ops;
}

export default function SupplyReturnPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [returnComponentRows, setReturnComponentRows] = useState<ReturnComponentRow[]>([]);
  const [step, setStep] = useState<ReturnStep>("scanning");
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [availableQty, setAvailableQty] = useState(0);

  useEffect(() => {
    setMobile(isMobileDevice());
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const loadLoans = useCallback(async (userId: string) => {
    const activeLoans = await getActiveLoanForUser(id, userId);
    setLoans(activeLoans);

    const componentMap: Record<string, number> = {};
    for (const loan of activeLoans) {
      parseComponents(loan.loan_components)
        .filter((r) => r.name.trim() && r.qty > 0)
        .forEach((r) => {
          componentMap[r.name] = (componentMap[r.name] ?? 0) + r.qty;
        });
    }

    if (Object.keys(componentMap).length === 0 && activeLoans.length > 0) {
      const totalQty = activeLoans.reduce((s, l) => s + (l.loan_quantity ?? 1), 0);
      setReturnComponentRows([
        { name: "반납 수량", qty: totalQty, maxQty: totalQty, selected: true }
      ]);
    } else {
      setReturnComponentRows(
        Object.entries(componentMap).map(([name, qty]) => ({
          name,
          qty,
          maxQty: qty,
          selected: true
        }))
      );
    }
  }, [id]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("supplies")
      .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT})`)
      .eq("id", id)
      .maybeSingle();

    if (data) {
      setSupply(mapSupplyRow(data as Record<string, unknown>));
      setAvailableQty(await getAvailableQuantity(id));
    }
  }, [id]);

  useEffect(() => {
    if (status !== "ready" || !profile?.id) return;
    void load();
    void loadLoans(profile.id);
  }, [status, profile?.id, load, loadLoans]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !supply || loans.length === 0) return;

    const selectedRows = returnComponentRows.filter(
      (r) => r.selected && r.name.trim() && r.qty > 0
    );
    if (returnComponentRows.length > 0 && selectedRows.length === 0) {
      setError("반납할 구성품을 선택해 주세요.");
      return;
    }

    const returnOps = buildReturnOps(loans, selectedRows);
    if (returnOps.length === 0) {
      setError("반납 수량을 확인해 주세요.");
      return;
    }

    setStep("submitting");
    setError(null);

    const sortedLoans = [...loans].sort(
      (a, b) => new Date(a.borrowed_at).getTime() - new Date(b.borrowed_at).getTime()
    );
    const { path, error: upErr } = await uploadReturnImage(
      supply.id,
      sortedLoans[0].id,
      file
    );
    if (upErr || !path) {
      setStep("verified");
      setError(upErr ?? "사진 업로드 실패");
      return;
    }

    for (const op of returnOps) {
      const { error: retErr } = await returnSupply({
        loanId: op.loanId,
        supplyId: supply.id,
        returnImagePath: path,
        returnNote: note,
        returnQuantity: op.returnQuantity,
        returnComponents: op.returnComponents
      });

      if (retErr) {
        setStep("verified");
        setError(retErr);
        return;
      }
    }

    router.push(supplyDetailPath(supply.id));
  };

  if (status !== "ready") return null;

  if (!mobile) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-semibold text-slate-900">모바일에서만 사용 가능합니다</p>
        <p className="mt-2 text-sm text-slate-600">반납 처리는 스마트폰에서 QR 스캔 후 진행해 주세요.</p>
        <Link href={supplyDetailPath(id)} className="mt-6 inline-block text-sm font-medium text-violet-600 hover:underline">
          물품 상세로
        </Link>
      </div>
    );
  }

  if (!supply) return <p className="text-sm text-slate-500">물품을 찾을 수 없습니다.</p>;

  if (loans.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="text-slate-600">반납할 대출 기록이 없습니다.</p>
        <Link href={supplyDetailPath(id)} className="mt-4 inline-block text-sm text-violet-600 hover:underline">
          상세로
        </Link>
      </div>
    );
  }

  const locationLabel = formatSupplyLocation(supply.location);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href={supplyDetailPath(id)} className="text-sm font-medium text-violet-600 hover:underline">
        ← 상세
      </Link>
      <h1 className="text-xl font-bold text-slate-900">반납하기</h1>

      {step === "scanning" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">반납할 물품의 QR 코드를 스캔해 주세요.</p>
          <SupplyInfoCard supply={supply} />
          <QrScanner key={scanKey} active={!scanConfirmOpen} onScan={handleQrScan} />
          <SupplyScanConfirmModal
            open={scanConfirmOpen}
            supply={supply}
            availableQty={availableQty}
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
          <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            물품을 보관 위치(<span className="font-semibold">{locationLabel}</span>)에 반납 후 사진을 촬영해 주세요.
          </p>

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            {returnComponentRows.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">반납 구성품</p>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={returnComponentRows.every((r) => r.selected)}
                      onChange={(e) => {
                        setReturnComponentRows(
                          returnComponentRows.map((r) => ({ ...r, selected: e.target.checked }))
                        );
                      }}
                    />
                    전체 선택
                  </label>
                </div>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {returnComponentRows.map((row, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => {
                            const next = [...returnComponentRows];
                            next[i] = { ...next[i], selected: e.target.checked };
                            setReturnComponentRows(next);
                          }}
                        />
                        {row.name}
                      </label>
                      <div className="flex items-center gap-1">
                        {!row.selected ? (
                          <span className="w-16 text-right text-sm text-slate-400">
                            {row.maxQty}개
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={1}
                            max={row.maxQty}
                            value={row.qty}
                            onChange={(e) => {
                              const next = [...returnComponentRows];
                              next[i] = { ...next[i], qty: Number(e.target.value) };
                              setReturnComponentRows(next);
                            }}
                            className="w-16 rounded border border-slate-200 px-2 py-1 text-right text-sm"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="block text-sm font-medium text-slate-700">
              반납 사진 <span className="text-rose-600">*</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="mt-1 block w-full text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-48 w-full rounded-lg border object-contain" />
            ) : null}

            <label className="block text-sm font-medium text-slate-700">
              특이사항
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="파손, 분실 등"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}

            <button
              type="submit"
              disabled={
                !file ||
                step === "submitting" ||
                (returnComponentRows.length > 0 && returnComponentRows.every((r) => !r.selected))
              }
              className="w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {step === "submitting" ? "처리 중…" : "반납 완료"}
            </button>
          </form>
        </div>
      )}

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
