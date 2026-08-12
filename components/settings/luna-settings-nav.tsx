"use client";

import { useEffect, useState } from "react";
import {
  LUNA_MENUS,
  menuDef,
  type LunaMenuSlug,
  type LunaSubSlug
} from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

type BadgeCounts = {
  candidatesPending: number;
  brainPending: number;
  knowledgeConflict: number;
  selfstudyStuck: number;
};

type Props = {
  menu: LunaMenuSlug;
  sub: LunaSubSlug | null;
  onMenuChange: (menu: LunaMenuSlug) => void;
  onSubChange: (sub: LunaSubSlug) => void;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function LunaSettingsNav({ menu, sub, onMenuChange, onSubChange }: Props) {
  const [badges, setBadges] = useState<BadgeCounts>({
    candidatesPending: 0,
    brainPending: 0,
    knowledgeConflict: 0,
    selfstudyStuck: 0
  });

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const res = await fetch("/api/luna/dashboard", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          candidates?: { pending?: number };
          brain?: { revert_pending?: number };
          knowledge?: { conflict_count?: number };
          selfstudy?: { stuck_today?: number };
        };
        setBadges({
          candidatesPending: json.candidates?.pending ?? 0,
          brainPending: json.brain?.revert_pending ?? 0,
          knowledgeConflict: json.knowledge?.conflict_count ?? 0,
          selfstudyStuck: json.selfstudy?.stuck_today ?? 0
        });
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const subs = menuDef(menu).subs ?? [];

  return (
    <div className="space-y-3">
      <nav
        className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden"
        aria-label="LUNA 메뉴"
      >
        {LUNA_MENUS.map((item) => {
          const active = menu === item.slug;
          const badge =
            item.slug === "candidates"
              ? badges.candidatesPending
              : item.slug === "brain"
                ? badges.brainPending
                : 0;
          return (
            <button
              key={item.slug}
              type="button"
              onClick={() => onMenuChange(item.slug)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] transition ${
                active
                  ? "bg-[#534AB7] font-medium text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {item.label}
              <NavBadge count={badge} />
            </button>
          );
        })}
      </nav>

      {subs.length > 0 ? (
        <nav
          className="flex gap-4 overflow-x-auto border-b border-slate-200 [-ms-overflow-style:none] [scrollbar-width:none] md:overflow-visible [&::-webkit-scrollbar]:hidden"
          aria-label="LUNA 하위 탭"
        >
          {subs.map((item) => {
            const active = sub === item.slug;
            let conflictBadge = 0;
            if (
              menu === "knowledge" &&
              item.slug === "conflict" &&
              badges.knowledgeConflict > 0
            ) {
              conflictBadge = badges.knowledgeConflict;
            } else if (
              menu === "selfstudy" &&
              item.slug === "stuck" &&
              badges.selfstudyStuck > 0
            ) {
              conflictBadge = badges.selfstudyStuck;
            }
            return (
              <button
                key={item.slug}
                type="button"
                onClick={() => onSubChange(item.slug)}
                className={`shrink-0 border-b-2 px-1 pb-2.5 text-[13px] transition ${
                  active
                    ? "border-[#534AB7] font-medium text-[#3C3489]"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {item.label}
                {conflictBadge > 0 ? (
                  <span className="ml-1 font-bold text-[#993C1D]">
                    {conflictBadge > 99 ? "99+" : conflictBadge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
