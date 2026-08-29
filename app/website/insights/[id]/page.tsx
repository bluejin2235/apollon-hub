import { Suspense } from "react";
import { InsightEditor } from "@/components/website/insight-editor";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InsightEditPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중...</p>}>
      <InsightEditor insightId={id} siteUrl={process.env.WEBSITE_API_URL ?? ""} />
    </Suspense>
  );
}
