"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DevnoteError } from "@/components/devnote/devnote-ui";
import { loadDevnoteDecisions } from "@/lib/devnote/decisions";
import type { DevnoteDecisionListRow } from "@/lib/devnote/types";
import { supabase } from "@/lib/supabase/client";

type ServiceOption = { id: string; name: string; slug: string | null };

export function DevnoteDecisionsScreen() {
  const [rows, setRows] = useState<DevnoteDecisionListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState("all");
  const [keyOnly, setKeyOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDevnoteDecisions(supabase)
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

  const services = useMemo(() => {
    const map = new Map<string, ServiceOption>();
    for (const row of rows) {
      if (!row.service_id || map.has(row.service_id)) continue;
      map.set(row.service_id, {
        id: row.service_id,
        name: row.service_name,
        slug: row.service_slug
      });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (keyOnly && !row.is_key) return false;
      if (serviceId !== "all" && row.service_id !== serviceId) return false;
      if (!q) return true;
      const hay = `${row.what}\n${row.why}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, serviceId, keyOnly]);

  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트</p>
      <h1 className="text-[26px] font-bold tracking-tight text-[#15171C]">
        결정 기록
      </h1>
      <p className="mt-2 text-xs text-[#858C9A]">
        「왜 이렇게 했지」 할 때 제목·본문으로 찾습니다.
      </p>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목·본문 검색"
          aria-label="제목·본문 검색"
          className="w-full rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-2 text-[13px] text-[#15171C] placeholder:text-[#858C9A] sm:min-w-[220px] sm:flex-1"
        />
        <select
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          aria-label="서비스 필터"
          className="rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-2 text-[13px] text-[#15171C]"
        >
          <option value="all">모든 서비스</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-[#15171C]">
          <input
            type="checkbox"
            checked={keyOnly}
            onChange={(e) => setKeyOnly(e.target.checked)}
            className="accent-[#2B5BD7]"
          />
          중요만
        </label>
      </div>

      <p className="mt-3 text-[11px] tabular-nums text-[#858C9A]">
        {loading ? "불러오는 중…" : `${filtered.length} / ${rows.length}건`}
      </p>

      {error ? <DevnoteError message={error} /> : null}

      {loading ? (
        <p className="mt-6 text-sm text-[#858C9A]">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
          <p className="text-[13px] text-[#858C9A]">
            {rows.length === 0
              ? "아직 기록이 없습니다."
              : "조건에 맞는 결정이 없습니다."}
          </p>
        </div>
      ) : (
        <div className="ml-1 mt-6 border-l-2 border-[#E2E5EA] pl-[18px]">
          {filtered.map((row) => (
            <div key={row.id} className="relative pb-[22px] last:pb-0">
              <span
                className={`absolute top-1.5 h-[9px] w-[9px] rounded-full border-2 bg-white -left-[25px] ${
                  row.is_key
                    ? "border-[#2B5BD7] bg-[#2B5BD7]"
                    : "border-[#858C9A]"
                }`}
                aria-hidden
              />
              <div className="rounded-md px-1 py-0.5">
                <p className="font-mono text-[11.5px] text-[#858C9A]">
                  {row.decided_on}
                  {" · "}
                  {row.service_slug ? (
                    <Link
                      href={`/devnote/s/${row.service_slug}?tab=decisions`}
                      className="hover:underline"
                    >
                      {row.service_name}
                    </Link>
                  ) : (
                    row.service_name
                  )}
                  {row.is_key ? " · 중요" : ""}
                </p>
                <p className="mt-0.5 font-semibold text-[#15171C]">{row.what}</p>
                {row.why ? (
                  <p className="mt-0.5 text-[13px] text-[#4A505C]">{row.why}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
