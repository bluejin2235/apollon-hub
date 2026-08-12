"use client";

import type { ReactNode } from "react";
import { K } from "@/lib/luna/knowledge-format";

export function KnowledgeShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto max-w-[1180px] rounded-[12px] p-6"
      style={{ background: K.bg, color: K.ink }}
    >
      {children}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3.5 grid grid-cols-2 gap-2.5 min-[901px]:grid-cols-4">
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  valueClassName,
  small
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClassName?: string;
  small?: boolean;
}) {
  return (
    <div
      className="rounded-[9px] px-3.5 py-3"
      style={{ background: K.panel }}
    >
      <div className="text-[12px]" style={{ color: K.sub }}>
        {label}
      </div>
      <div
        className={`mt-0.5 font-bold tracking-[-0.4px] ${small ? "text-[15px]" : "text-[22px]"} ${valueClassName ?? ""}`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px]" style={{ color: K.faint }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>
  );
}

export function FieldInput({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff] ${className}`}
      style={{
        borderColor: K.line,
        background: K.panel,
        color: K.ink
      }}
    />
  );
}

export function FieldSelect({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-[9px] border px-[11px] py-2 text-[13px] outline-none focus:border-[#d9d2ff] ${className}`}
      style={{
        borderColor: K.line,
        background: K.panel,
        color: K.ink
      }}
    >
      {children}
    </select>
  );
}

export function Btn({
  children,
  primary,
  ok,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  ok?: boolean;
}) {
  let bg: string = K.panel;
  let color = "#33363c";
  let border: string = K.line;
  if (primary) {
    bg = K.luna;
    color = "#fff";
    border = K.luna;
  } else if (ok) {
    bg = K.talk;
    color = "#fff";
    border = K.talk;
  }
  return (
    <button
      type="button"
      {...props}
      className={`cursor-pointer rounded-[9px] border px-[13px] py-2 text-[12.5px] font-bold disabled:opacity-50 ${className}`}
      style={{ background: bg, color, borderColor: border }}
    >
      {children}
    </button>
  );
}

type BadgeKind = "org" | "me" | "src" | "warn" | "ok" | "red";

const BADGE_STYLES: Record<BadgeKind, { bg: string; color: string }> = {
  org: { bg: K.lunaSoft, color: K.lunaInk },
  me: { bg: K.talkSoft, color: K.talk },
  src: { bg: K.chip, color: K.sub },
  warn: { bg: K.candSoft, color: K.candInk },
  ok: { bg: K.talkSoft, color: K.talk },
  red: { bg: K.dangerSoft, color: K.danger }
};

export function Badge({
  kind,
  children,
  className = ""
}: {
  kind: BadgeKind;
  children: ReactNode;
  className?: string;
}) {
  const s = BADGE_STYLES[kind];
  return (
    <span
      className={`inline-block rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold ${className}`}
      style={{ background: s.bg, color: s.color }}
    >
      {children}
    </span>
  );
}

export function ListCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[12px] border"
      style={{ background: K.panel, borderColor: K.line }}
    >
      {children}
    </div>
  );
}

export function ListItem({ children }: { children: ReactNode }) {
  return (
    <div
      className="border-b px-4 py-[13px] last:border-b-0"
      style={{ borderColor: K.line2 }}
    >
      {children}
    </div>
  );
}

export function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto text-[11.5px]" style={{ color: K.faint }}>
      {children}
    </span>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2.5 text-center text-[12px]" style={{ color: K.faint }}>
      {children}
    </p>
  );
}

export function Box({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-[12px] border px-4 py-3.5"
      style={{ background: K.panel, borderColor: K.line }}
    >
      <h4 className="mb-2.5 text-[13px] font-bold">{title}</h4>
      {children}
    </div>
  );
}

export function BoxRow({
  left,
  right,
  rightClassName
}: {
  left: ReactNode;
  right: ReactNode;
  rightClassName?: string;
}) {
  return (
    <div
      className="flex justify-between text-[12.5px] leading-[2.05]"
      style={{ color: K.sub }}
    >
      <span>{left}</span>
      <b className={`font-bold ${rightClassName ?? ""}`} style={{ color: K.ink }}>
        {right}
      </b>
    </div>
  );
}

export function LoadingLine() {
  return <p className="text-[12px]" style={{ color: K.faint }}>불러오는 중…</p>;
}

export function ErrorLine({ message }: { message: string }) {
  return <p className="text-[12px]" style={{ color: K.danger }}>{message}</p>;
}
