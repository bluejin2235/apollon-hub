import type { Metadata } from "next";
import { IssueNewForm } from "@/components/issues/issue-new-form";

export const metadata: Metadata = {
  title: "새 문의"
};

export default function NewIssuePage() {
  return <IssueNewForm />;
}
