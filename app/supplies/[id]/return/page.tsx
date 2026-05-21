"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyLocation, mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { getActiveLoanForUser, returnSupply } from "@/lib/supplies/operations";
import { uploadReturnImage } from "@/lib/supplies/storage";
import { formatSupplyDate, formatSupplyDateTime, imagePublicUrls, supplyDetailPath } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SupplyReturnPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [loan, setLoan] = useState<{ id: string; purpose: string; due_date: string; borrowed_at: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("supplies")
      .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT})`)
      .eq("id", id)
      .maybeSingle();

    if (data) setSupply(mapSupplyRow(data as Record<string, unknown>));
  }, [id]);

  useEffect(() => {
    if (status !== "ready" || !profile?.id) return;
    void load();
    void getActiveLoanForUser(id, profile.id).then(setLoan);
  }, [status, profile?.id, id, load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !loan || !supply) return;

    setSaving(true);
    setError(null);

    const { path, error: upErr } = await uploadReturnImage(supply.id, loan.id, file);
    if (upErr || !path) {
      setSaving(false);
      setError(upErr ?? "사진 업로드 실패");
      return;
    }

    const { error: retErr } = await returnSupply({
      loanId: loan.id,
      supplyId: supply.id,
      returnImagePath: path,
      returnNote: note
    });

    setSaving(false);
    if (retErr) {
      setError(retErr);
      return;
    }
    router.push(supplyDetailPath(supply.id));
  };

  if (status !== "ready") return null;

  if (!mobile) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-semibold text-slate-900">모바일에서만 사용 가능합니다</p>
        <p className="mt-2 text-sm text-slate-600">반납 처리는 스마트폰에서 진행해 주세요.</p>
        <Link href={supplyDetailPath(id)} className="mt-6 inline-block text-sm font-medium text-violet-600 hover:underline">
          비품 상세로
        </Link>
      </div>
    );
  }

  if (!supply) return <p className="text-sm text-slate-500">비품을 찾을 수 없습니다.</p>;

  if (!loan) {
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm text-sm">
        <p className="font-semibold text-slate-900">{supply.name}</p>
        <p className="text-slate-500">{supply.code}</p>
        <p className="mt-2 text-slate-600">목적: {loan.purpose}</p>
        <p className="text-slate-600">대출: {formatSupplyDateTime(loan.borrowed_at)}</p>
        <p className="text-slate-600">반납예정: {formatSupplyDate(loan.due_date)}</p>
      </div>

      <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        물품을 보관 위치(<span className="font-semibold">{locationLabel}</span>)에 반납 후 사진을 촬영해주세요.
      </p>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          반납 사진 <span className="text-rose-600">*</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="mt-1 w-full text-sm"
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
          disabled={!file || saving}
          className="w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "처리 중…" : "반납 완료"}
        </button>
      </form>
    </div>
  );
}
