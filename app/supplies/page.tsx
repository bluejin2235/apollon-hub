"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SupplyCard } from "@/components/supplies/supply-card";
import { SupplyRegisterModal } from "@/components/supplies/supply-register-modal";
import {
  parseSuppliesTabKey,
  SUPPLIES_NAV,
  SuppliesMobileBottomNav,
  suppliesTabKeyToId
} from "@/components/supplies/supplies-nav";
import { WarehouseMapModal } from "@/components/supplies/warehouse-map-modal";
import {
  formatSupplyLocation,
  getSlotsForZone,
  getSupplyZones,
  mapSupplyRow,
  SUPPLY_LOCATION_SELECT,
  zoneSelectLabel
} from "@/lib/supplies/locations";
import { canCreateSupply } from "@/lib/services/permissions";
import type { SupplyLocation, SupplyWithRelations } from "@/lib/supplies/types";
import { imagePublicUrls, supplyDetailPath } from "@/lib/supplies/utils";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { supabase } from "@/lib/supabase/client";

export default function SuppliesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabKey = parseSuppliesTabKey(searchParams.get("tab"));
  const activeTab = suppliesTabKeyToId(tabKey);
  const { status, profile } = useRequirePortalSession();
  const [supplies, setSupplies] = useState<SupplyWithRelations[]>([]);
  const [locations, setLocations] = useState<SupplyLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("전체");
  const [slotFilter, setSlotFilter] = useState<string>("전체");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const navigateTab = (nextTabKey: "loan" | "manage") => {
    router.push(`/supplies?tab=${nextTabKey}`);
  };

  const canRegister = canCreateSupply(profile);
  const zones = useMemo(() => getSupplyZones(locations), [locations]);
  const slotsInZone = useMemo(
    () => (zoneFilter === "전체" ? [] : getSlotsForZone(locations, zoneFilter)),
    [locations, zoneFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const [supRes, locRes] = await Promise.all([
        supabase
          .from("supplies")
          .select(`*, location:supply_locations(${SUPPLY_LOCATION_SELECT}), manager:profiles!manager_id(id, name, email)`)
          .order("created_at", { ascending: false }),
        supabase
          .from("supply_locations")
          .select(SUPPLY_LOCATION_SELECT)
          .eq("is_active", true)
          .order("zone_code")
          .order("slot_code")
      ]);

      const errors: string[] = [];
      if (supRes.error) errors.push(`물품 목록: ${supRes.error.message}`);
      if (locRes.error) errors.push(`보관 위치: ${locRes.error.message}`);

      if (errors.length > 0) {
        console.error("[supplies/page] load", { supRes, locRes });
        setLoadError(errors.join(" · "));
        setSupplies([]);
        setLocations([]);
        return;
      }

      const rows = (supRes.data ?? []).map((r) => mapSupplyRow(r as Record<string, unknown>));

      setSupplies(rows);
      setLocations((locRes.data ?? []) as SupplyLocation[]);
    } catch (e) {
      console.error("[supplies/page] load", e);
      setLoadError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
      setSupplies([]);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return supplies.filter((s) => {
      if (activeTab === "loanable" ? !s.is_loanable : s.is_loanable) return false;
      if (zoneFilter !== "전체" && s.location?.zone_code !== zoneFilter) return false;
      if (slotFilter !== "전체" && s.location_id !== slotFilter) return false;
      if (!kw) return true;
      return (
        s.name.toLowerCase().includes(kw) ||
        (s.code ?? "").toLowerCase().includes(kw) ||
        (s.location?.slot_code?.toLowerCase().includes(kw) ?? false)
      );
    });
  }, [supplies, search, zoneFilter, slotFilter, activeTab]);

  if (status !== "ready") return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">물품 관리</h1>
          <p className="mt-1 text-sm text-slate-600">물품 등록, 대출, 반납을 관리합니다.</p>
        </div>
        {canRegister ? (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
          >
            물품 등록
          </button>
        ) : null}
      </div>

      <div className="mb-4 hidden border-b border-slate-200 md:flex">
        {SUPPLIES_NAV.map((item) => (
          <button
            key={item.tabKey}
            type="button"
            onClick={() => navigateTab(item.tabKey)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
              tabKey === item.tabKey
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 모바일 필터 칩 */}
      <div className="hscroll px-0.5 md:hidden">
        {SUPPLIES_NAV.map((item) => (
          <button
            key={item.tabKey}
            type="button"
            onClick={() => navigateTab(item.tabKey)}
            className={`chip-sm h-[30px] rounded-full border px-3 text-[12px] ${
              tabKey === item.tabKey
                ? "border-[#534AB7] bg-[#EEEDFE] font-medium text-[#3C3489]"
                : "border-[#D3D1C7] bg-white text-[#6B6A64]"
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="chip-sm h-[30px] rounded-full border border-[#D3D1C7] bg-white px-3 text-[12px] text-[#6B6A64]"
        >
          📍 위치안내
        </button>
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
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 md:inline-flex"
          >
            📍 보관위치 안내
          </button>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : loadError ? (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-10 text-center"
          role="alert"
        >
          <p className="text-sm font-medium text-rose-800">데이터를 불러오지 못했습니다</p>
          <p className="mt-2 text-sm text-rose-700">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
          >
            다시 시도
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          {supplies.length === 0 ? "등록된 물품이 없습니다." : "조건에 맞는 물품이 없습니다."}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white md:hidden">
            {filtered.map((s) => {
              const thumb = imagePublicUrls(s.image_paths ?? [])[0];
              return (
                <Link
                  key={s.id}
                  href={supplyDetailPath(s.id)}
                  className="flex min-h-[66px] items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
                >
                  <div className="h-[46px] w-[46px] shrink-0 overflow-hidden rounded-[10px] bg-slate-100">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg text-slate-300">
                        📦
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-slate-900">{s.name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-gray-500">
                      {s.code} · {formatSupplyLocation(s.location)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-600">
                    {s.quantity}개
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="hidden grid-cols-2 gap-4 md:grid md:grid-cols-3 lg:grid-cols-6">
            {filtered.map((s) => (
              <SupplyCard key={s.id} supply={s} />
            ))}
          </div>
        </>
      )}

      {profile?.id ? (
        <SupplyRegisterModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onSaved={() => void load()}
          locations={locations}
          currentUserId={profile.id}
        />
      ) : null}

      <WarehouseMapModal open={mapOpen} onClose={() => setMapOpen(false)} />

      <SuppliesMobileBottomNav activeTabKey={tabKey} />
    </div>
  );
}
