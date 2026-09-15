"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function DevnoteButton({
  tone = "ghost",
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "ghost" | "primary";
  children: ReactNode;
}) {
  const base =
    "rounded-[7px] px-3 py-1.5 text-[13px] disabled:opacity-50";
  const toneClass =
    tone === "primary"
      ? "border border-[#15171C] bg-[#15171C] text-white"
      : "border border-[#E2E5EA] bg-white text-[#4A505C] hover:bg-[#F7F8FA]";
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`${base} ${toneClass} ${className}`}
    >
      {children}
    </button>
  );
}

export function DevnoteError({ message }: { message: string }) {
  return (
    <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
      {message}
    </p>
  );
}
