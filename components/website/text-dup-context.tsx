"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  collectWorkTextMaps,
  dupCountFor,
  exactDupCounts,
  type LocMap
} from "@/lib/website/text-dup";
import type { Loc, WorkDetail } from "@/lib/website/work-detail";

type TextDupContextValue = {
  reportCaption: (id: string, loc: Loc) => void;
  reportAlt: (id: string, loc: Loc) => void;
  captionDup: (value: string, locale: "ko" | "en") => number;
  altDup: (value: string, locale: "ko" | "en") => number;
};

const TextDupContext = createContext<TextDupContextValue | null>(null);

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function TextDupProvider({
  work,
  children
}: {
  work: WorkDetail;
  children: ReactNode;
}) {
  const base = useMemo(() => collectWorkTextMaps(work), [work]);
  const [captionOverlay, setCaptionOverlay] = useState<LocMap>({});
  const [altOverlay, setAltOverlay] = useState<LocMap>({});

  useEffect(() => {
    setCaptionOverlay((prev) => pruneOverlay(prev, base.captions));
    setAltOverlay((prev) => pruneOverlay(prev, base.alts));
  }, [base]);

  const captions = useMemo(
    () => ({ ...base.captions, ...captionOverlay }),
    [base.captions, captionOverlay]
  );
  const alts = useMemo(() => ({ ...base.alts, ...altOverlay }), [base.alts, altOverlay]);

  const captionKo = useMemo(
    () => exactDupCounts(Object.values(captions).map((item) => item.ko)),
    [captions]
  );
  const captionEn = useMemo(
    () => exactDupCounts(Object.values(captions).map((item) => item.en)),
    [captions]
  );
  const altKo = useMemo(() => exactDupCounts(Object.values(alts).map((item) => item.ko)), [alts]);
  const altEn = useMemo(() => exactDupCounts(Object.values(alts).map((item) => item.en)), [alts]);

  const reportCaption = useCallback((id: string, loc: Loc) => {
    setCaptionOverlay((prev) => patchOverlay(prev, id, loc));
  }, []);
  const reportAlt = useCallback((id: string, loc: Loc) => {
    setAltOverlay((prev) => patchOverlay(prev, id, loc));
  }, []);

  const captionDup = useCallback(
    (value: string, locale: "ko" | "en") =>
      dupCountFor(value, locale === "ko" ? captionKo : captionEn),
    [captionKo, captionEn]
  );
  const altDup = useCallback(
    (value: string, locale: "ko" | "en") => dupCountFor(value, locale === "ko" ? altKo : altEn),
    [altKo, altEn]
  );

  const value = useMemo(
    () => ({ reportCaption, reportAlt, captionDup, altDup }),
    [reportCaption, reportAlt, captionDup, altDup]
  );

  return <TextDupContext.Provider value={value}>{children}</TextDupContext.Provider>;
}

export function useTextDup() {
  return useContext(TextDupContext);
}

function pruneOverlay(overlay: LocMap, base: LocMap): LocMap {
  let changed = false;
  const next: LocMap = {};
  for (const [id, loc] of Object.entries(overlay)) {
    if (id in base) next[id] = loc;
    else changed = true;
  }
  if (!changed && Object.keys(next).length === Object.keys(overlay).length) return overlay;
  return next;
}

function patchOverlay(prev: LocMap, id: string, loc: Loc): LocMap {
  const current = prev[id];
  if (current && current.ko === loc.ko && current.en === loc.en) return prev;
  return { ...prev, [id]: loc };
}
