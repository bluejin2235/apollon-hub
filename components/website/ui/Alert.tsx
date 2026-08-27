import type { ReactNode } from "react";

import "./work-admin.css";

export type AlertTone = "w" | "e" | "o" | "i";

type AlertProps = {
  tone: AlertTone;
  children?: ReactNode;
  className?: string;
};

export function Alert({ tone, children, className }: AlertProps) {
  const extra = className ? ` ${className}` : "";
  return <div className={`wa al ${tone}${extra}`}>{children}</div>;
}
