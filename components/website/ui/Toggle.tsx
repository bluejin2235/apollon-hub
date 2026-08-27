"use client";

import type { ReactNode } from "react";

import "./work-admin.css";

type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
};

export function Toggle({ checked, onChange, disabled, children }: ToggleProps) {
  return (
    <button
      type="button"
      className={checked ? "wa tgl on" : "wa tgl"}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden />
      {children}
    </button>
  );
}
