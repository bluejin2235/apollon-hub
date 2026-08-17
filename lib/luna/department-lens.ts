import type { SupabaseClient } from "@supabase/supabase-js";

export const DEPARTMENT_LENS_SEED: Record<string, string | null> = {
  공간기획팀: "lens.space-planning",
  공간파트: "lens.space-planning",
  공간디자인팀: "lens.space-design",
  콘텐츠기획팀: "lens.content-planning",
  콘텐츠파트: "lens.content-planning",
  비주얼디자인팀: "lens.content-design",
  HW디자인팀: "lens.hardware-design",
  전사: null
};

export type DepartmentLensRow = {
  department: string;
  lens_prompt_key: string | null;
  updated_at?: string;
};

export type DepartmentLensResolve = {
  department: string;
  found: boolean;
  lensPromptKey: string | null;
  source: "db" | "seed";
};

export function lensKeyFromMap(
  department: string | null | undefined,
  map: Map<string, string | null>
): { found: boolean; lensPromptKey: string | null } {
  const d = (department ?? "").trim();
  if (!d) return { found: false, lensPromptKey: null };
  if (!map.has(d)) return { found: false, lensPromptKey: null };
  return { found: true, lensPromptKey: map.get(d) ?? null };
}

function seedMap(): Map<string, string | null> {
  return new Map(Object.entries(DEPARTMENT_LENS_SEED));
}

/** profiles.department → L2 lens prompt_key. 테이블이 없으면 seed 를 쓴다. */
export async function resolveDepartmentLens(
  admin: SupabaseClient,
  department: string | null | undefined
): Promise<DepartmentLensResolve> {
  const d = (department ?? "").trim();
  const empty: DepartmentLensResolve = {
    department: d,
    found: false,
    lensPromptKey: null,
    source: "seed"
  };
  if (!d) return empty;

  try {
    const { data, error } = await admin
      .from("luna_department_lens")
      .select("department, lens_prompt_key")
      .eq("department", d)
      .maybeSingle();

    if (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code !== "42P01" && code !== "PGRST205") {
        console.error("[luna/lens] map query", error);
      }
      const seeded = lensKeyFromMap(d, seedMap());
      return {
        department: d,
        found: seeded.found,
        lensPromptKey: seeded.lensPromptKey,
        source: "seed"
      };
    }

    if (!data) {
      return { department: d, found: false, lensPromptKey: null, source: "db" };
    }

    const key =
      typeof data.lens_prompt_key === "string" && data.lens_prompt_key.trim()
        ? data.lens_prompt_key.trim()
        : null;
    return {
      department: d,
      found: true,
      lensPromptKey: key,
      source: "db"
    };
  } catch (err) {
    console.error("[luna/lens] resolve", err);
    const seeded = lensKeyFromMap(d, seedMap());
    return {
      department: d,
      found: seeded.found,
      lensPromptKey: seeded.lensPromptKey,
      source: "seed"
    };
  }
}

export async function listDepartmentLens(
  admin: SupabaseClient
): Promise<DepartmentLensRow[]> {
  const { data, error } = await admin
    .from("luna_department_lens")
    .select("department, lens_prompt_key, updated_at")
    .order("department", { ascending: true });

  if (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01" || code === "PGRST205") {
      return Object.entries(DEPARTMENT_LENS_SEED).map(([department, lens_prompt_key]) => ({
        department,
        lens_prompt_key
      }));
    }
    throw error;
  }

  if ((data ?? []).length > 0) {
    return data as DepartmentLensRow[];
  }

  return Object.entries(DEPARTMENT_LENS_SEED).map(([department, lens_prompt_key]) => ({
    department,
    lens_prompt_key
  }));
}
