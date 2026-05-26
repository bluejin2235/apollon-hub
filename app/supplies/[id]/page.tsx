"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SupplyLoanDetailModal } from "@/components/supplies/supply-loan-detail-modal";
import { SupplyPrintLabelButton } from "@/components/supplies/supply-print-label-button";
import { SupplyToast } from "@/components/supplies/toast";
import { SupplyZoneSidebar, type ZoneSupplyListItem } from "@/components/supplies/supply-zone-sidebar";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyLocation, mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { deleteSupply } from "@/lib/supplies/operations";
import {
  canDeleteSupply,
  canPrintSupplyLabel,
  formatSupplyDate,
  formatSupplyDateTime,
  imagePublicUrls,
  loanStatusLabel,
  supplyDetailPath,
  supplyLoanPath,
  supplyReturnPath,
  supplyStatusBadge
} from "@/lib/supplies/utils";
import type { SupplyLoanWithRelations, SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SupplyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [loans, setLoans] = useState<SupplyLoanWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<SupplyLoanWithRelations | null>(null);
  const [zoneSupplies, setZoneSupplies] = useState<ZoneSupplyListItem[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setGalleryIdx(0);

    const { data: sup, error } = await supabase
      .from("supplies")
      .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT}), manager:profiles!manager_id(id, name, email)`)
      .eq("id", id)
      .maybeSingle();

    if (error || !sup) {
      setSupply(null);
      setZoneSupplies([]);
      setLoading(false);
      return;
    }

    const mapped = mapSupplyRow(sup as Record<string, unknown>);
    setSupply(mapped);

    const zoneCode = mapped.location?.zone_code;
    if (zoneCode) {
      const { data: locRows } = await supabase
        .from("supply_locations")
        .select("id")
        .eq("zone_code", zoneCode)
        .eq("is_active", true);

      const locIds = (locRows ?? []).map((r) => r.id as string);
      if (locIds.length > 0) {
        const { data: zoneRows } = await supabase
          .from("supplies")
          .select("id, code, name, status")
          .in("location_id", locIds)
          .order("code");

        setZoneSupplies((zoneRows ?? []) as ZoneSupplyListItem[]);
      } else {
        setZoneSupplies([]);
      }
    } else {
      setZoneSupplies([]);
    }

    const { data: loanRows } = await supabase
      .from("supply_loans")
      .select("*, borrower:profiles!borrower_id(id, name, email)")
      .eq("supply_id", id)
      .order("borrowed_at", { ascending: false });

    setLoans((loanRows ?? []) as SupplyLoanWithRelations[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const handleBorrowClick = () => {
    if (!supply) return;
    if (!isMobileDevice()) {
      setToast("모바일에서만 신청 가능합니다");
      return;
    }
    router.push(supplyLoanPath(supply.id));
  };

  const handleConfirmDelete = async () => {
    if (!supply) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    const { error } = await deleteSupply(supply.id);
    setDeleteBusy(false);
    if (error) {
      setDeleteErr(error);
      return;
    }
    router.push("/supplies");
  };

  if (status !== "ready") return null;
  if (loading) return <p className="text-sm text-slate-500">불러오는 중…</p>;

  if (!supply) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center">
        <p className="text-slate-600">비품을 찾을 수 없습니다.</p>
        <Link href="/supplies" className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  const badge = supplyStatusBadge(supply.status);
  const supplyImages = imagePublicUrls(supply.image_paths);
  const latestReturnLoan = loans
    .filter((l) => l.status === "returned" && l.return_image_path)
    .sort(
      (a, b) =>
        new Date(b.returned_at ?? 0).getTime() - new Date(a.returned_at ?? 0).getTime()
    )[0];
  const latestReturnImageUrl = latestReturnLoan?.return_image_path
    ? imagePublicUrls([latestReturnLoan.return_image_path])[0]
    : null;
  const showReturnMainImage = Boolean(latestReturnImageUrl);
  const galleryImages = showReturnMainImage ? [latestReturnImageUrl!] : supplyImages;
  const myActiveLoan =
    profile?.id && loans.find((l) => l.borrower_id === profile.id && l.status === "active");
  const showDelete = canDeleteSupply(profile?.role, profile?.id, supply.manager_id);
  const showPrintLabel = canPrintSupplyLabel(profile?.role, profile?.id, supply.manager_id);
  const hasZoneSidebar = Boolean(supply.location?.zone_code);

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      {showPrintLabel && profile?.id ? (
        <SupplyPrintLabelButton supply={supply} requestedBy={profile.id} onToast={setToast} />
      ) : null}
      {supply.status === "available" ? (
        <button
          type="button"
          onClick={handleBorrowClick}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
        >
          대출 신청
        </button>
      ) : null}
      {myActiveLoan ? (
        <Link
          href={isMobileDevice() ? supplyReturnPath(supply.id) : supplyDetailPath(supply.id)}
          onClick={(e) => {
            if (!isMobileDevice()) {
              e.preventDefault();
              setToast("모바일에서만 반납할 수 있습니다");
            }
          }}
          className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800"
        >
          반납하기
        </Link>
      ) : null}
      {showDelete ? (
        <button
          type="button"
          onClick={() => {
            setDeleteErr(null);
            setDeleteModalOpen(true);
          }}
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
        >
          삭제
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <Link href="/supplies" className="text-sm font-medium text-violet-600 hover:underline">
        ← 비품 목록
      </Link>

      <header className="space-y-3 border-b border-slate-200 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-500">{supply.code}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
          </div>
          {actionButtons}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">{supply.name}</h1>
      </header>

      <div
        className={
          hasZoneSidebar
            ? "flex flex-col gap-6 lg:grid lg:grid-cols-[12rem_1fr_1fr] lg:items-start lg:gap-6"
            : "flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6"
        }
      >
        {hasZoneSidebar && supply.location ? (
          <SupplyZoneSidebar
            zoneCode={supply.location.zone_code}
            zoneName={supply.location.zone_name}
            currentId={supply.id}
            items={zoneSupplies}
          />
        ) : null}

        {galleryImages.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex max-h-48 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 lg:max-h-52">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={galleryImages[galleryIdx]}
                alt=""
                className="max-h-48 w-full object-contain lg:max-h-52"
              />
            </div>
            {showReturnMainImage ? (
              <p className="mt-2 text-center text-xs font-medium text-slate-500">최종 반납시 촬영 이미지</p>
            ) : null}
            {!showReturnMainImage && galleryImages.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {galleryImages.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setGalleryIdx(i)}
                    className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${i === galleryIdx ? "border-violet-500" : "border-slate-200"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">비품 정보</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <dt className="text-slate-500">구역</dt>
              <dd className="font-medium text-slate-900">{formatSupplyLocation(supply.location)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">수량</dt>
              <dd className="font-medium text-slate-900">{supply.quantity}</dd>
            </div>
            <div>
              <dt className="text-slate-500">담당자</dt>
              <dd className="font-medium text-slate-900">{supply.manager?.name?.trim() || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">상태</dt>
              <dd>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              </dd>
            </div>
            {supply.description ? (
              <div className="sm:col-span-2 lg:col-span-1">
                <dt className="text-slate-500">설명</dt>
                <dd className="text-slate-800">{supply.description}</dd>
              </div>
            ) : null}
            {supply.components ? (
              <div className="sm:col-span-2 lg:col-span-1">
                <dt className="text-slate-500">구성품</dt>
                <dd className="whitespace-pre-wrap text-slate-800">{supply.components}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-full">
          <h2 className="text-base font-semibold text-slate-900">대출 이력</h2>
          {loans.length === 0 ? (
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              이력이 없습니다.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm lg:min-w-0">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">대출자</th>
                    <th className="px-3 py-2">목적</th>
                    <th className="px-3 py-2">대출일</th>
                    <th className="px-3 py-2">반납예정</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">반납 특이사항</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loans.map((loan) => (
                    <tr
                      key={loan.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedLoan(loan)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedLoan(loan);
                        }
                      }}
                      className="cursor-pointer transition hover:bg-violet-50/60"
                    >
                      <td className="px-3 py-2">{loan.borrower?.name?.trim() || "—"}</td>
                      <td className="max-w-[120px] truncate px-3 py-2 lg:max-w-[140px]" title={loan.purpose}>
                        {loan.purpose}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {formatSupplyDateTime(loan.borrowed_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {formatSupplyDate(loan.due_date)}
                      </td>
                      <td className="px-3 py-2">{loanStatusLabel(loan.status)}</td>
                      <td
                        className="max-w-[160px] truncate px-3 py-2 text-slate-600"
                        title={loan.return_note ?? undefined}
                      >
                        {loan.status === "returned" && loan.return_note ? loan.return_note : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <SupplyToast message={toast} onClose={() => setToast(null)} />

      {selectedLoan ? (
        <SupplyLoanDetailModal loan={selectedLoan} onClose={() => setSelectedLoan(null)} />
      ) : null}

      {deleteModalOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-supply-title"
          onClick={() => {
            if (!deleteBusy) setDeleteModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-supply-title" className="text-lg font-bold text-slate-900">
              비품 삭제
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              이 비품을 삭제하면 대출 기록을 포함한 모든 데이터가 영구 삭제됩니다. 정말 삭제하시겠습니까?
            </p>
            {deleteErr ? <p className="mt-3 text-sm text-rose-600">{deleteErr}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                onClick={() => setDeleteModalOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                onClick={() => void handleConfirmDelete()}
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
