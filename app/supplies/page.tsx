"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MyLoansWidget } from "@/components/supplies/my-loans-widget";
import { SupplyCard } from "@/components/supplies/supply-card";
import { SupplyFormModal } from "@/components/supplies/supply-form-modal";
import { syncOverdueLoans } from "@/lib/supplies/operations";
import { isSuperAdmin, matchesZoneFilter, statusFilterToSupplyStatus } from "@/lib/supplies/utils";
import {
  STATUS_FILTERS,
  ZONE_FILTERS,
  type ProfileLite,
  type StatusFilterLabel,
  type SupplyCardData,
  type SupplyWithManager,
  type ZoneFilter
} from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SuppliesPage() {
  const { status, profile } = useRequirePortalSession();
  const [supplies, setSupplies] = useState<SupplyWithManager[]>([]);
  const [dueBySupplyId, setDueBySupplyId] = useState<Map<string, string>>(new Map());
  const [managers, setManagers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [zone, setZone] = useState<ZoneFilter>("전체");
  const [statusFilter, setStatusFilter] = useState<StatusFilterLabel>("전체");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = isSuperAdmin(profile?.role);
  const userId = profile?.id ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    await syncOverdueLoans();

    const [supRes, loanRes, profRes] = await Promise.all([
      supabase
        .from("supplies")
        .select("*, manager:profiles!manager_id(id, name, email)")
        .order("code", { ascending: true }),
      supabase
        .from("supply_loans")
        .select("supply_id, due_date")
        .in("status", ["active", "overdue"])
        .is("returned_at", null),
      supabase.from("profiles").select("id, name, email").order("name", { ascending: true })
    ]);

    const rows = (supRes.data ?? []).map((r) => {
      const mgr = r.manager as { id: string; name: string | null; email?: string | null } | null;
      const { manager: _m, ...rest } = r;
      return {
        ...rest,
        manager: mgr ? { id: mgr.id, name: mgr.name, email: mgr.email } : null
      } as SupplyWithManager;
    });

    const dueMap = new Map<string, string>();
    for (const loan of loanRes.data ?? []) {
      if (!dueMap.has(loan.supply_id)) dueMap.set(loan.supply_id, loan.due_date);
    }

    setSupplies(rows);
    setDueBySupplyId(dueMap);
    setManagers((profRes.data ?? []) as ProfileLite[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load, refreshKey]);

  const cards: SupplyCardData[] = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const statusKey = statusFilterToSupplyStatus(statusFilter);

    return supplies
      .filter((s) => matchesZoneFilter(s.category, zone))
      .filter((s) => (statusKey ? s.status === statusKey : true))
      .filter((s) => {
        if (!kw) return true;
        return s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw);
      })
      .map((s) => ({
        ...s,
        activeDueDate: s.status === "borrowed" ? dueBySupplyId.get(s.id) ?? null : null
      }));
  }, [supplies, zone, statusFilter, search, dueBySupplyId]);

  if (status !== "ready") return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">비품 관리</h1>
          <p className="mt-1 text-sm text-slate-600">사내 비품 대출·반납을 관리합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin ? (
            <>
              <Link
                href="/supplies/admin"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                관리자
              </Link>
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
              >
                비품 등록
              </button>
            </>
          ) : null}
        </div>
      </div>

      {userId ? <MyLoansWidget userId={userId} onReturned={() => setRefreshKey((k) => k + 1)} /> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {ZONE_FILTERS.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZone(z)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  zone === z ? "bg-violet-600 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {z}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="물품명, 코드 검색"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm lg:w-56"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                statusFilter === s ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : cards.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          조건에 맞는 비품이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((s) => (
            <SupplyCard key={s.id} supply={s} />
          ))}
        </div>
      )}

      <SupplyFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        managers={managers}
      />
    </div>
  );
}
