"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cacheNasPathSettings,
  DEFAULT_NAS_PATH_SETTINGS,
  loadCachedNasPathSettings,
  parseNasPathSettingsRow,
  type NasPathSettings
} from "@/lib/luna/nas-path-settings";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function useNasPathSettings() {
  const [settings, setSettings] = useState<NasPathSettings>(() =>
    loadCachedNasPathSettings()
  );
  const [loading, setLoading] = useState(true);

  const applySettings = useCallback((next: NasPathSettings) => {
    setSettings(next);
    cacheNasPathSettings(next);
  }, []);

  const refresh = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/luna/nas/path-settings", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = (await res.json()) as { settings?: unknown };
        applySettings(parseNasPathSettingsRow(json.settings));
      }
    } catch {
      /* keep cache */
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, loading, refresh, applySettings };
}

export { DEFAULT_NAS_PATH_SETTINGS };
