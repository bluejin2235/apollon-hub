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
  buildHighlightNeedles,
  type GlossaryHighlightTerm,
  type HighlightNeedle
} from "@/lib/glossary/highlight";
import { GlossaryTermPopup } from "@/components/glossary/GlossaryTermPopup";
import { supabase } from "@/lib/supabase/client";

type GlossaryHighlightData = {
  termsById: Map<string, GlossaryHighlightTerm>;
  needles: HighlightNeedle[];
  openTerm: (termId: string, anchor: HTMLElement) => void;
  closeTerm: () => void;
  patchTerm: (term: GlossaryHighlightTerm) => void;
};

const GlossaryHighlightDataContext = createContext<GlossaryHighlightData | null>(null);
const GlossaryHighlightActiveContext = createContext<string | null>(null);

async function accessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function GlossaryHighlightProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<GlossaryHighlightTerm[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await accessToken();
      if (!token || cancelled) return;
      try {
        const res = await fetch("/api/glossary?highlight=1", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const json = (await res.json()) as { terms?: GlossaryHighlightTerm[] };
        if (!cancelled) setTerms(json.terms ?? []);
      } catch (err) {
        console.error("[glossary] highlight load", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const termsById = useMemo(() => {
    const map = new Map<string, GlossaryHighlightTerm>();
    for (const term of terms) map.set(term.id, term);
    return map;
  }, [terms]);

  const needles = useMemo(() => buildHighlightNeedles(terms), [terms]);

  const openTerm = useCallback((termId: string, el: HTMLElement) => {
    setActiveTermId(termId);
    setAnchor(el);
  }, []);

  const closeTerm = useCallback(() => {
    setActiveTermId(null);
    setAnchor(null);
  }, []);

  const patchTerm = useCallback((term: GlossaryHighlightTerm) => {
    setTerms((prev) => {
      const defined = Boolean((term.definition ?? "").trim());
      const idx = prev.findIndex((t) => t.id === term.id);
      if (!defined) {
        if (idx < 0) return prev;
        return prev.filter((t) => t.id !== term.id);
      }
      if (idx < 0) return [...prev, term];
      const next = [...prev];
      next[idx] = { ...next[idx], ...term };
      return next;
    });
  }, []);

  const data = useMemo(
    () => ({
      termsById,
      needles,
      openTerm,
      closeTerm,
      patchTerm
    }),
    [termsById, needles, openTerm, closeTerm, patchTerm]
  );

  return (
    <GlossaryHighlightDataContext.Provider value={data}>
      <GlossaryHighlightActiveContext.Provider value={activeTermId}>
        {children}
        <GlossaryTermPopup
          termId={activeTermId}
          term={activeTermId ? termsById.get(activeTermId) ?? null : null}
          anchor={anchor}
          onClose={closeTerm}
          onSaved={patchTerm}
        />
      </GlossaryHighlightActiveContext.Provider>
    </GlossaryHighlightDataContext.Provider>
  );
}

export function useGlossaryHighlightData() {
  return useContext(GlossaryHighlightDataContext);
}

export function useGlossaryHighlightActive() {
  return useContext(GlossaryHighlightActiveContext);
}

export function useGlossaryHighlight() {
  const data = useGlossaryHighlightData();
  const activeTermId = useGlossaryHighlightActive();
  if (!data) return null;
  return { ...data, activeTermId };
}
