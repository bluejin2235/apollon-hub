"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GlossaryBrowser,
  type GlossaryBrowserMeta
} from "@/components/glossary/GlossaryBrowser";
import {
  KnowledgeShell,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { GLOSSARY_CATEGORIES, type GlossaryStats } from "@/lib/glossary/types";

export function LunaKnowledgeGlossary() {
  const router = useRouter();
  const [stats, setStats] = useState<GlossaryStats | null>(null);

  const categoryLine = useMemo(() => {
    if (!stats?.by_category) return "—";
    const parts = GLOSSARY_CATEGORIES.map(
      (cat) => stats.by_category[cat] ?? "—"
    );
    if (parts.every((p) => p === "—" || p == null)) return "—";
    return parts.join(" / ");
  }, [stats]);

  function handleMeta(meta: GlossaryBrowserMeta) {
    setStats(meta.stats);
  }

  return (
    <KnowledgeShell>
      <GlossaryBrowser
        includeStats
        onMeta={handleMeta}
        topSlot={
          <StatGrid>
            <StatCard label="전체 용어" value={stats ? stats.total : "—"} />
            <StatCard label="분류별 개수" value={categoryLine} small />
            <StatCard
              label="이번 주 수정"
              value={stats ? stats.week_updated : "—"}
            />
            <StatCard
              label="확인 대기 후보"
              value={stats ? stats.pending_candidates : "—"}
              valueClassName={
                stats && stats.pending_candidates > 0
                  ? "text-[#993C1D]"
                  : undefined
              }
              onClick={() =>
                router.push(
                  "/settings?tab=luna&luna=candidates&sub=pending&filter=glossary"
                )
              }
            />
          </StatGrid>
        }
      />
    </KnowledgeShell>
  );
}
