import { SuppliesShell } from "@/components/supplies/supplies-shell";

export default function SuppliesLayout({ children }: { children: React.ReactNode }) {
  return <SuppliesShell>{children}</SuppliesShell>;
}
