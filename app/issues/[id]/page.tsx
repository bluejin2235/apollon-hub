import type { Metadata } from "next";
import { IssueDetailView } from "@/components/issues/issue-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "문의"
};

export default async function IssueDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <IssueDetailView seq={id} />;
}
