import { ReactNode } from "react";
import { AgentsShell } from "@/components/agents/agents-shell";

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return <AgentsShell>{children}</AgentsShell>;
}
