import { ReactNode } from "react";
import { WebsiteShell } from "@/components/website/website-shell";

export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return <WebsiteShell>{children}</WebsiteShell>;
}
