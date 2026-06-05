"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SupplyLoanDetailModal } from "@/components/supplies/supply-loan-detail-modal";
import { SupplyPrintLabelButton } from "@/components/supplies/supply-print-label-button";
import { SupplyRegisterModal } from "@/components/supplies/supply-register-modal";
import { SupplyToast } from "@/components/supplies/toast";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { SupplyZoneSidebar, type ZoneSupplyListItem } from "@/components/supplies/supply-zone-sidebar";
import { WarehouseMapModal } from "@/components/supplies/warehouse-map-modal";
import { isMobileDevice } from "@/lib/supplies/device";
import { formatSupplyLocation, mapSupplyRow, SUPPLY_LOCATION_SELECT } from "@/lib/supplies/locations";
import { deleteSupply, getAvailableQuantity } from "@/lib/supplies/operations";
import {
  formatSupplyDate,
  formatSupplyDateTime,
  imagePublicUrls,
  loanStatusLabel,
  parseComponents,
  supplyDetailPath,
  supplyLoanPath,
  supplyReturnPath,
  supplyStatusBadge
} from "@/lib/supplies/utils";
import type {
  PrintJobWithRequester,
  ProfileLite,
  SupplyLocation,
  SupplyLoanWithRelations,
  SupplyWithRelations
} from "@/lib/supplies/types";
import { useCanManageSupply } from "@/lib/services/use-service-permissions";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SupplyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { status, profile } = useRequirePortalSession();

  const [supply, setSupply] = useState<SupplyWithRelations | null>(null);
  const [loans, setLoans] = useState<SupplyLoanWithRelations[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJobWithRequester[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [imageTab, setImageTab] = useState<"return" | "register">("register");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [selectedLoan, setSelectedLoan] = useState<SupplyLoanWithRelations | null>(null);
  const [zoneSupplies, setZoneSupplies] = useState<ZoneSupplyListItem[]>([]);
  const [locations, setLocations] = useState<SupplyLocation[]>([]);
  const [managers, setManagers] = useState<ProfileLite[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [availableQty, setAvailableQty] = useState(0);

  const canManageResult = useCanManageSupply(supply?.manager_id);

  const latestReturnLoan = useMemo(
    () =>
      loans
        .filter((l) => l.status === "returned" && l.return_image_path)
        .sort(
          (a, b) =>
            new Date(b.returned_at ?? 0).getTime() - new Date(a.returned_at ?? 0).getTime()
        )[0],
    [loans]
  );

  useEffect(() => {
    setImageTab(latestReturnLoan?.return_image_path ? "return" : "register");
  }, [latestReturnLoan]);

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
      setLoans([]);
      setPrintJobs([]);
      setLocations([]);
      setManagers([]);
      setAvailableQty(0);
      setLoading(false);
      return;
    }

    const mapped = mapSupplyRow(sup as Record<string, unknown>);
    setSupply(mapped);
    setAvailableQty(await getAvailableQuantity(id));

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

    const loadedLoans = (loanRows ?? []) as SupplyLoanWithRelations[];
    setLoans(loadedLoans);

    const { data: printRows } = await supabase
      .from("print_jobs")
      .select("id, created_at, requester:profiles!requested_by(name)")
      .eq("supply_id", id)
      .order("created_at", { ascending: false });

    setPrintJobs((printRows ?? []) as unknown as PrintJobWithRequester[]);

    const [{ data: allLocs }, { data: profRows }] = await Promise.all([
      supabase
        .from("supply_locations")
        .select(SUPPLY_LOCATION_SELECT)
        .eq("is_active", true)
        .order("zone_code")
        .order("slot_code"),
      supabase.from("profiles").select("id, name, email").order("name")
    ]);

    setLocations((allLocs ?? []) as SupplyLocation[]);
    setManagers((profRows ?? []) as ProfileLite[]);
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
        <p className="text-slate-600">물품을 찾을 수 없습니다.</p>
        <Link href="/supplies" className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  const badge = supplyStatusBadge(supply.status);
  const supplyImages = imagePublicUrls(supply.image_paths);
  const latestReturnImageUrl = latestReturnLoan?.return_image_path
    ? imagePublicUrls([latestReturnLoan.return_image_path])[0]
    : null;
  const hasReturnImage = Boolean(latestReturnLoan?.return_image_path);
  const galleryImages =
    imageTab === "return" && latestReturnLoan?.return_image_path && latestReturnImageUrl
      ? [latestReturnImageUrl]
      : supplyImages;
  const myActiveLoan =
    profile?.id && loans.find((l) => l.borrower_id === profile.id && l.status === "active");
  const showDelete = canManageResult ?? false;
  const showPrintLabel = canManageResult ?? false;
  const showEdit = canManageResult ?? false;
  const hasZoneSidebar = Boolean(supply.location?.zone_code);

  const printJobRequesterName = (job: PrintJobWithRequester) => {
    const requester = job.requester;
    if (!requester) return "—";
    if (Array.isArray(requester)) return requester[0]?.name?.trim() || "—";
    return requester.name?.trim() || "—";
  };

  const formatLoanComponentsLabel = (raw: string | null | undefined) => {
    if (!raw?.trim()) return null;
    const label = parseComponents(raw)
      .filter((row) => row.name.trim().length > 0)
      .map((row) => `${row.name}×${row.qty}`)
      .join(", ");
    return label || null;
  };

  const loanQuantityCell = (loan: SupplyLoanWithRelations) => {
    const componentsLabel = formatLoanComponentsLabel(loan.loan_components);
    return (
      <td className="px-3 py-2">
        <div>{loan.loan_quantity ?? 1}</div>
        {componentsLabel ? (
          <p className="mt-0.5 text-xs text-slate-500">{componentsLabel}</p>
        ) : null}
      </td>
    );
  };

  const gallerySection =
    supplyImages.length > 0 || hasReturnImage ? (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {hasReturnImage ? (
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setImageTab("return");
                setGalleryIdx(0);
              }}
              className={
                imageTab === "return"
                  ? "rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              }
            >
              최종 반납 이미지
            </button>
            <button
              type="button"
              onClick={() => {
                setImageTab("register");
                setGalleryIdx(0);
              }}
              className={
                imageTab === "register"
                  ? "rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              }
            >
              등록 이미지
            </button>
          </div>
        ) : null}
        {galleryImages.length > 0 ? (
          <>
            <div className="flex max-h-48 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100 lg:max-h-52">
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="block w-full cursor-pointer rounded-xl transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                aria-label="이미지 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={galleryImages[galleryIdx]}
                  alt=""
                  className="max-h-48 w-full object-contain lg:max-h-52"
                />
              </button>
            </div>
            {imageTab === "return" ? (
              <p className="mt-2 text-center text-xs font-medium text-slate-500">최종 반납시 촬영 이미지</p>
            ) : null}
            {imageTab === "register" && supplyImages.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {supplyImages.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => {
                      setGalleryIdx(i);
                      setLightboxOpen(true);
                    }}
                    className={`h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition hover:opacity-90 ${i === galleryIdx ? "border-violet-500" : "border-slate-200"}`}
                    aria-label={`이미지 ${i + 1} 보기`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">등록 이미지 없음</p>
        )}
      </section>
    ) : null;

  const statusLabel = badge.label;
  const componentRows = parseComponents(supply.components).filter((row) => row.name.trim().length > 0);

  const supplyInfoSection = (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">물품 정보</h2>
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          📍 보관위치 안내
        </button>
      </div>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-900">
        <li>
          <span className="font-medium text-slate-500">구역</span> : {formatSupplyLocation(supply.location)}
        </li>
        <li>
          <span className="font-medium text-slate-500">담당자</span> : {supply.manager?.name?.trim() || "—"}
        </li>
        <li>
          <span className="font-medium text-slate-500">상태</span> : {statusLabel}
        </li>
        <li>
          <span className="font-medium text-slate-500">설명</span> : {supply.description?.trim() || "—"}
        </li>
        <li>
          <span className="font-medium text-slate-500">구성품</span>
          {componentRows.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">구성품 없음</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[200px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-3 py-2">품명</th>
                    <th className="px-3 py-2 text-right">총수량</th>
                    <th className="px-3 py-2 text-right">대출가능</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {componentRows.map((row, i) => (
                    <tr key={`${row.name}-${row.qty}-${i}`}>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {row.qty}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {supply.status === "available"
                          ? row.qty
                          : supply.status === "partially_borrowed"
                            ? availableQty
                            : 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </li>
      </ul>
    </section>
  );

  const printJobHistorySection = (
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">QR 라벨 출력 이력</h2>
      {printJobs.length === 0 ? (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          출력 이력이 없습니다.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm lg:min-w-0">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-3 py-2">출력자</th>
                <th className="px-3 py-2">출력일시</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {printJobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2">{printJobRequesterName(job)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {formatSupplyDateTime(job.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      {showPrintLabel && profile?.id ? (
        <SupplyPrintLabelButton supply={supply} requestedBy={profile.id} onToast={setToast} />
      ) : null}
      {supply.status === "available" || supply.status === "partially_borrowed" ? (
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
      {showEdit ? (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          수정
        </button>
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
        ← 물품 목록
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

      {hasZoneSidebar && supply.location ? (
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[12rem_1fr] lg:items-start lg:gap-6">
          <SupplyZoneSidebar
            zoneCode={supply.location.zone_code}
            zoneName={supply.location.zone_name}
            currentId={supply.id}
            items={zoneSupplies}
          />
          <div className="min-w-0 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {gallerySection}

              {supplyInfoSection}
            </div>

            <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                        <th className="px-3 py-2">대출수량</th>
                        <th className="px-3 py-2">목적</th>
                        <th className="px-3 py-2">대출일</th>
                        <th className="px-3 py-2">반납예정일</th>
                        <th className="px-3 py-2">최종반납일</th>
                        <th className="px-3 py-2">상태</th>
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
                          {loanQuantityCell(loan)}
                          <td className="max-w-[120px] truncate px-3 py-2 lg:max-w-none" title={loan.purpose}>
                            {loan.purpose}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {formatSupplyDateTime(loan.borrowed_at)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {formatSupplyDate(loan.due_date)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}
                          </td>
                          <td className="px-3 py-2">{loanStatusLabel(loan.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {printJobHistorySection}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {gallerySection}

            {supplyInfoSection}
          </div>

          <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                      <th className="px-3 py-2">대출수량</th>
                      <th className="px-3 py-2">목적</th>
                      <th className="px-3 py-2">대출일</th>
                      <th className="px-3 py-2">반납예정일</th>
                      <th className="px-3 py-2">최종반납일</th>
                      <th className="px-3 py-2">상태</th>
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
                        {loanQuantityCell(loan)}
                        <td className="max-w-[120px] truncate px-3 py-2 sm:max-w-none" title={loan.purpose}>
                          {loan.purpose}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {formatSupplyDateTime(loan.borrowed_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {formatSupplyDate(loan.due_date)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                          {loan.returned_at ? formatSupplyDateTime(loan.returned_at) : "—"}
                        </td>
                        <td className="px-3 py-2">{loanStatusLabel(loan.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {printJobHistorySection}
        </div>
      )}

      <SupplyToast message={toast} onClose={() => setToast(null)} />

      <ImageLightbox
        images={galleryImages}
        index={galleryIdx}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onIndexChange={setGalleryIdx}
      />

      {selectedLoan ? (
        <SupplyLoanDetailModal loan={selectedLoan} onClose={() => setSelectedLoan(null)} />
      ) : null}

      {profile?.id ? (
        <SupplyRegisterModal
          open={editOpen}
          mode="edit"
          initialSupply={supply}
          managers={managers}
          locations={locations}
          currentUserId={profile.id}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            void load();
          }}
        />
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
              물품 삭제
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              이 물품을 삭제하면 대출 기록을 포함한 모든 데이터가 영구 삭제됩니다. 정말 삭제하시겠습니까?
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

      <WarehouseMapModal open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}
