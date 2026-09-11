import { IssuesShell } from "@/components/issues/issues-shell";

export default function IssuesLayout({ children }: { children: React.ReactNode }) {
  return <IssuesShell>{children}</IssuesShell>;
}
