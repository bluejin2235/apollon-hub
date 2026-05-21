"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SupplyCard } from "@/components/supplies/supply-card";
import { SupplyRegisterModal } from "@/components/supplies/supply-register-modal";
import {
  getSlotsForZone,
  getSupplyZones,
  mapSupplyRow,
  SUPPLY_LOCATION_SELECT,
  zoneSelectLabel
} from "@/lib/supplies/locations";
import { isSupplyManager } from "@/lib/supplies/utils";
import type { ProfileLite, SupplyLocation, SupplyWithRelations } from "@/lib/supplies/types";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SuppliesPage() {
  const { status, profile } = useRequirePortalSession();
  const [supplies, setSupplies] = useState<SupplyWithRelations[]>([]);
  const [locations, setLocations] = useState<SupplyLocation[]>([]);
  const [managers, setManagers] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("전체");
  const [slotFilter, setSlotFilter] = useState<string>("전체");
  const [registerOpen, setRegisterOpen] = useState(false);

  const canRegister = isSupplyManager(profile?.role);
  const zones = useMemo(() => getSupplyZones(locations), [locations]);
  const slotsInZone = useMemo(
    () => (zoneFilter === "전체" ? [] : getSlotsForZone(locations, zoneFilter)),
    [locations, zoneFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [supRes, locRes, profRes] = await Promise.all([
      supabase
        .from("supplies")
        .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT}), manager:profiles!manager_id(id, name, email)`)
        .order("created_at", { ascending: false }),
      supabase
        .from("supply_locations")
        .select(SUPPLY_LOCATION_SELECT)
        .eq("is_active", true)
        .order("zone_code")
        .order("slot_code"),
      supabase.from("profiles").select("id, name, email").order("name")
    ]);

    const rows = (supRes.data ?? []).map((r) => mapSupplyRow(r as Record<string, unknown>));

    setSupplies(rows);
    setLocations((locRes.data ?? []) as SupplyLocation[]);
    setManagers((profRes.data ?? []) as ProfileLite[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return supplies.filter((s) => {
      if (zoneFilter !== "전체" && s.location?.zone_code !== zoneFilter) return false;
      if (slotFilter !== "전체" && s.location_id !== slotFilter) return false;
      if (!kw) return true;
      return (
        s.name.toLowerCase().includes(kw) ||
        s.code.toLowerCase().includes(kw) ||
        (s.location?.slot_code?.toLowerCase().includes(kw) ?? false)
      );
    });
  }, [supplies, search, zoneFilter, slotFilter]);

  if (status !== "ready") return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">비품 관리</h1>
          <p className="mt-1 text-sm text-slate-600">비품 등록, 대출, 반납을 관리합니다.</p>
        </div>
        {canRegister ? (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            비품 등록
          </button>
        ) : null}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="물품명, 코드(A01_001) 검색"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              setSlotFilter("전체");
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            aria-label="대분류 구역"
          >
            <option value="전체">전체 대분류</option>
            {zones.map((z) => (
              <option key={z.zone_code} value={z.zone_code}>
                {zoneSelectLabel(z)}
              </option>
            ))}
          </select>
          <select
            value={slotFilter}
            onChange={(e) => setSlotFilter(e.target.value)}
            disabled={zoneFilter === "전체"}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            aria-label="세부 위치"
          >
            <option value="전체">전체 위치</option>
            {slotsInZone.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.slot_code}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          등록된 비품이 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {filtered.map((s) => (
            <SupplyCard key={s.id} supply={s} />
          ))}
        </div>
      )}

      <SupplyRegisterModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSaved={() => void load()}
        locations={locations}
        managers={managers}
      />
    </div>
  );
}
