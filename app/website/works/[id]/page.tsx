import { Suspense } from "react";
import { WorkEditor } from "@/components/website/work-editor";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function WorkEditPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중...</p>}>
      <WorkEditor workId={id} siteUrl={process.env.WEBSITE_API_URL ?? ""} />
    </Suspense>
  );
}
