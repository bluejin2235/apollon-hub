"use client";

import type { ReactNode } from "react";
import { DevnoteShell } from "@/components/devnote/devnote-shell";

export default function DevnoteLayout({ children }: { children: ReactNode }) {
  return <DevnoteShell>{children}</DevnoteShell>;
}
