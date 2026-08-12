"use client";

import type { ReactNode } from "react";
import { K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

export async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function brainFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    if (res.status === 403) throw new Error("슈퍼관리자만 볼 수 있습니다.");
    throw new Error(json?.error ?? "요청에 실패했습니다.");
  }
  return json as T;
}

export function InfoBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-3.5 rounded-[9px] px-3.5 py-[11px] text-[13px]"
      style={{ background: K.panel, color: K.sub }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-2 text-[13px] font-bold ${className}`}>{children}</div>
  );
}

export function BrainCard({
  highlight,
  className = "",
  children
}: {
  highlight?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`mb-3 rounded-[12px] p-4 ${className}`}
      style={{
        background: K.panel,
        border: highlight ? "2px solid #e4d3ae" : `1px solid ${K.line}`
      }}
    >
      {children}
    </div>
  );
}

export function CardTop({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">{children}</div>
  );
}

export function KvLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-[12.5px] leading-[1.95]" style={{ color: K.sub }}>
      <b className="font-bold" style={{ color: K.ink }}>
        {label}
      </b>{" "}
      · {children}
    </div>
  );
}

export function DiffBlock({ children }: { children: ReactNode }) {
  return (
    <div
      className="whitespace-pre-wrap break-words rounded-[9px] px-3 py-2.5 text-[12.5px] leading-[1.65]"
      style={{ background: K.chip, color: K.ink }}
    >
      {children}
    </div>
  );
}

export function BtnRow({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function BtnNote({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11.5px]" style={{ color: K.faint }}>
      {children}
    </span>
  );
}

export function RunBar({
  text,
  children
}: {
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[9px] px-3.5 py-3"
      style={{ background: K.panel }}
    >
      <div className="flex-1 text-[13px]" style={{ color: K.sub }}>
        {text}
      </div>
      {children}
    </div>
  );
}

export function Avatar() {
  return (
    <div
      className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-extrabold"
      style={{ background: K.luna, color: K.lunaSoft }}
    >
      L
    </div>
  );
}

export function BarChart({
  bars,
  height = 70,
  highlightLast = true
}: {
  bars: Array<{ label: string; value: number; tone?: "down" }>;
  height?: number;
  highlightLast?: boolean;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="mt-2.5 flex items-end gap-2" style={{ height }}>
      {bars.map((b, i) => {
        const isLast = highlightLast && i === bars.length - 1;
        let background = "#CECBF6";
        if (b.tone === "down") background = "#F0997B";
        if (isLast) background = K.luna;
        const h = b.value > 0 ? Math.max(4, Math.round((b.value / max) * (height - 18))) : 2;
        return (
          <div
            key={`${b.label}-${i}`}
            className="flex flex-1 flex-col items-center justify-end gap-1"
            title={`${b.label} · ${b.value.toLocaleString()}`}
          >
            <i
              className="block w-full rounded-[2px]"
              style={{ height: h, background }}
            />
            <span className="text-[10.5px]" style={{ color: K.faint }}>
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 2,100,000 → "2.1M" */
export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}

export function formatMonthDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
