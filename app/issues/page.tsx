import type { Metadata } from "next";
import { IssuesHome } from "@/components/issues/issues-home";

export const metadata: Metadata = {
  title: "문의 게시판"
};

export default function IssuesPage() {
  return <IssuesHome />;
}
