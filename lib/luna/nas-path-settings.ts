/** Work서버 경로 표기 — 사용자별 설정 (DB `luna_nas_path_settings`) */

export type NasPathDisplayMode = "office" | "custom" | "unc";

export type NasPathSettings = {
  mode: NasPathDisplayMode;
  /** custom 모드: T 드라이브 접두사 (예 Z:\Work\) */
  prefixT: string;
  /** custom 모드: P 드라이브 접두사 (예 Z:\Partners\) */
  prefixP: string;
};

export const NAS_PATH_SETTINGS_STORAGE_KEY = "luna:nas-path-settings";

/** @deprecated 구 localStorage 키 — 최초 마이그레이션용 */
export const LEGACY_NAS_DRIVE_MODE_STORAGE_KEY = "luna:nas-drive-mode";

export const OFFICE_PREFIX_T = "T:\\";
export const OFFICE_PREFIX_P = "P:\\";
export const UNC_PREFIX_T = "\\\\aiw\\work\\";
export const UNC_PREFIX_P = "\\\\aiw\\partners\\";

export const DEFAULT_NAS_PATH_SETTINGS: NasPathSettings = {
  mode: "office",
  prefixT: "",
  prefixP: ""
};

export function nasPathSettingsLabel(settings: NasPathSettings): string {
  if (settings.mode === "office") return "사무실 PC";
  if (settings.mode === "unc") return "UNC";
  return "원격";
}

export function normalizePrefixInput(raw: string): string {
  return raw.replace(/\//g, "\\").trim();
}

/** 접두사와 nas_directory.path 를 이어 붙일 때만 사용 — 경로 본문은 변경하지 않는다 */
export function joinNasPrefix(prefix: string, relativePath: string): string {
  const p = normalizePrefixInput(prefix);
  const rel = relativePath.replace(/\//g, "\\").replace(/^\\+/, "");
  if (!p) return rel;
  const withSep = p.endsWith("\\") ? p : `${p}\\`;
  return rel ? `${withSep}${rel}` : withSep;
}

export function parseNasPathSettingsRow(row: unknown): NasPathSettings {
  if (!row || typeof row !== "object") return { ...DEFAULT_NAS_PATH_SETTINGS };
  const r = row as Record<string, unknown>;
  const mode = r.display_mode ?? r.mode;
  const parsedMode =
    mode === "custom" || mode === "unc" || mode === "office" ? mode : "office";
  return {
    mode: parsedMode,
    prefixT:
      typeof r.prefix_t === "string"
        ? r.prefix_t
        : typeof r.prefixT === "string"
          ? r.prefixT
          : "",
    prefixP:
      typeof r.prefix_p === "string"
        ? r.prefix_p
        : typeof r.prefixP === "string"
          ? r.prefixP
          : ""
  };
}

export function serializeNasPathSettings(settings: NasPathSettings): {
  display_mode: NasPathDisplayMode;
  prefix_t: string;
  prefix_p: string;
} {
  return {
    display_mode: settings.mode,
    prefix_t: normalizePrefixInput(settings.prefixT),
    prefix_p: normalizePrefixInput(settings.prefixP)
  };
}

export function loadCachedNasPathSettings(): NasPathSettings {
  if (typeof window === "undefined") return { ...DEFAULT_NAS_PATH_SETTINGS };
  try {
    const raw = localStorage.getItem(NAS_PATH_SETTINGS_STORAGE_KEY);
    if (raw) {
      return parseNasPathSettingsRow(JSON.parse(raw));
    }
    const legacy = localStorage.getItem(LEGACY_NAS_DRIVE_MODE_STORAGE_KEY);
    if (legacy === "raidrive") {
      return { mode: "custom", prefixT: "", prefixP: "" };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_NAS_PATH_SETTINGS };
}

export function cacheNasPathSettings(settings: NasPathSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      NAS_PATH_SETTINGS_STORAGE_KEY,
      JSON.stringify(serializeNasPathSettings(settings))
    );
  } catch {
    /* ignore */
  }
}
