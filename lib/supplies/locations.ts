import type { SupplyLocation, SupplyWithRelations } from "@/lib/supplies/types";

/** PostgREST embed select fragment */
export const SUPPLY_LOCATION_SELECT =
  "id, zone_code, zone_name, slot_code, slot_label, is_active, created_at";

export type SupplyZone = { zone_code: string; zone_name: string };

/** "A. 906호 책장서랍 > A03" */
export function formatSupplyLocation(location: SupplyLocation | null | undefined): string {
  if (!location) return "—";
  const label = location.slot_label?.trim();
  const slot = label ? `${location.slot_code} (${label})` : location.slot_code;
  return `${location.zone_code}. ${location.zone_name} > ${slot}`;
}

export function zoneSelectLabel(zone: SupplyZone): string {
  return `${zone.zone_code}. ${zone.zone_name}`;
}

export function getSupplyZones(locations: SupplyLocation[]): SupplyZone[] {
  const map = new Map<string, string>();
  for (const loc of locations) {
    if (!loc.is_active) continue;
    if (!map.has(loc.zone_code)) map.set(loc.zone_code, loc.zone_name);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone_code, zone_name]) => ({ zone_code, zone_name }));
}

export function getSlotsForZone(locations: SupplyLocation[], zoneCode: string): SupplyLocation[] {
  return locations
    .filter((l) => l.is_active && l.zone_code === zoneCode)
    .sort((a, b) => a.slot_code.localeCompare(b.slot_code));
}

export function parseSupplyLocation(raw: unknown): SupplyLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.zone_code !== "string") return null;
  return {
    id: r.id,
    zone_code: r.zone_code,
    zone_name: String(r.zone_name ?? ""),
    slot_code: String(r.slot_code ?? ""),
    slot_label: (r.slot_label as string | null) ?? null,
    is_active: r.is_active !== false,
    created_at: r.created_at as string | undefined
  };
}

export function mapSupplyRow(row: Record<string, unknown>): SupplyWithRelations {
  const loc = parseSupplyLocation(row.location);
  const mgrRaw = row.manager as { id: string; name: string | null; email?: string } | null;
  const { location: _l, manager: _m, ...rest } = row;
  return {
    ...(rest as SupplyWithRelations),
    image_paths: ((rest.image_paths as string[]) ?? []) as string[],
    location: loc,
    manager: mgrRaw ? { id: mgrRaw.id, name: mgrRaw.name, email: mgrRaw.email } : null
  };
}
