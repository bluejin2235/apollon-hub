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

export async function isSuperAdmin(): Promise<boolean> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.role === "슈퍼관리자";
}

export function Chip({
  on,
  children,
  onClick
}: {
  on: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[20px] border px-[13px] py-[5px] text-[12px]"
      style={{
        background: on ? K.luna : K.panel,
        color: on ? "#fff" : K.sub,
        borderColor: on ? K.luna : K.line,
        fontWeight: on ? 700 : 400
      }}
    >
      {children}
    </button>
  );
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

export function SettingsBox({
  title,
  desc,
  children
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="mb-3 rounded-[12px] border p-4"
      style={{ background: K.panel, borderColor: K.line }}
    >
      <h4 className="mb-1 text-[13px] font-bold">{title}</h4>
      {desc ? (
        <p className="mb-3 text-[12px]" style={{ color: K.sub }}>
          {desc}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function CheckRow({
  checked,
  disabled,
  onChange,
  children,
  lock
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  children: ReactNode;
  lock?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 text-[13px] leading-[2.2] ${
        disabled ? "" : "cursor-pointer"
      }`}
      style={{ color: disabled ? K.faint : K.ink }}
    >
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        {children}
        {lock ? (
          <span className="ml-1 text-[11.5px]" style={{ color: K.faint }}>
            {lock}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function DayLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
      {children}
    </p>
  );
}
