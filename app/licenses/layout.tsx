import { ReactNode } from "react";
import { LicensesShell } from "@/components/licenses/licenses-shell";

export default function LicensesLayout({ children }: { children: ReactNode }) {
  return <LicensesShell>{children}</LicensesShell>;
}
