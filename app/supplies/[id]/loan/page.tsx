"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyLocation, mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { borrowSupply } from "@/lib/supplies/operations";
import { formatSupplyDate, imagePublicUrls, supplyDetailPath } from "@/lib/supplies/utils";
import type { SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SupplyLoanPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [purpose, setPurpose] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
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

    setSaving(true);
    setError(null);
    const { error: err } = await borrowSupply({
      supplyId: supply.id,
      borrowerId: profile.id,
      purpose,
      dueDate
    });
    setSaving(false);
    if (err) {
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
        <p className="mt-2 text-sm text-slate-600">대출 신청은 스마트폰에서 진행해 주세요.</p>
        <Link href={supplyDetailPath(id)} className="mt-6 inline-block text-sm font-medium text-violet-600 hover:underline">
          비품 상세로
        </Link>
      </div>
    );
  }

  if (!supply) {
    return <p className="text-sm text-slate-500">비품을 찾을 수 없습니다.</p>;
  }

  const thumb = imagePublicUrls(supply.image_paths)[0];

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href={supplyDetailPath(id)} className="text-sm font-medium text-violet-600 hover:underline">
        ← 상세
      </Link>
      <h1 className="text-xl font-bold text-slate-900">대출 신청</h1>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-4">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-100 text-2xl">📦</div>
          )}
          <div>
            <p className="text-xs text-slate-500">{supply.code}</p>
            <p className="font-semibold text-slate-900">{supply.name}</p>
            <p className="text-sm text-slate-600">{formatSupplyLocation(supply.location)}</p>
          </div>
        </div>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
          disabled={saving || supply.status !== "available"}
          className="w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? "처리 중…" : "대출 신청 완료"}
        </button>
        {supply.status !== "available" ? (
          <p className="text-center text-xs text-amber-700">현재 대출할 수 없는 상태입니다.</p>
        ) : null}
      </form>
    </div>
  );
}
