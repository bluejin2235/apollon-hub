"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DevnoteError } from "@/components/devnote/devnote-ui";
import { loadDevnoteIdeas } from "@/lib/devnote/ideas";
import {
  DEVNOTE_IDEA_STAGES,
  type DevnoteIdeaRow,
  type DevnoteIdeaStage
} from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

export function DevnoteIdeasScreen() {
  const [rows, setRows] = useState<DevnoteIdeaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDevnoteIdeas(supabase)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<DevnoteIdeaStage, DevnoteIdeaRow[]>();
    for (const stage of DEVNOTE_IDEA_STAGES) map.set(stage.key, []);
    for (const row of rows) {
      map.get(row.stage)?.push(row);
    }
    return map;
  }, [rows]);

  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트</p>
      <h1 className="text-[26px] font-bold tracking-tight text-[#15171C]">
        만들고 싶은 것
      </h1>
      <p className="mt-2 text-xs text-[#858C9A]">
        next · someday · seed 로 나눠 둡니다.
      </p>

      {error ? <div className="mt-6"><DevnoteError message={error} /></div> : null}

      {loading ? (
        <p className="mt-6 text-sm text-[#858C9A]">불러오는 중…</p>
      ) : (
        <div className="mt-7 flex flex-col gap-8">
          {rows.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
              <p className="text-[13px] text-[#858C9A]">아직 적힌 것이 없습니다.</p>
            </div>
          ) : null}
          {DEVNOTE_IDEA_STAGES.map((stage) => {
            const items = byStage.get(stage.key) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={stage.key}>
                <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-[#15171C]">
                  {stage.label}
                  <span className="font-normal tabular-nums text-[11px] text-[#858C9A]">
                    {items.length}
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="text-[13px] text-[#858C9A]">없음</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {items.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-[10px] border border-[#E2E5EA] bg-white px-4 py-3"
                      >
                        <p className="font-semibold text-[#15171C]">{row.title}</p>
                        {row.body ? (
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#4A505C]">
                            {row.body}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-[11.5px] text-[#858C9A]">
                          {row.service_slug ? (
                            <Link
                              href={`/devnote/s/${row.service_slug}`}
                              className="hover:underline"
                            >
                              {row.service_name}
                            </Link>
                          ) : (
                            row.service_name
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
