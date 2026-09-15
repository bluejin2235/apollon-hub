import { Suspense } from "react";
import { DevnoteServiceScreen } from "@/components/devnote/devnote-service-screen";

export default async function DevnoteServicePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-[#858C9A]">불러오는 중…</p>}>
      <DevnoteServiceScreen slug={slug} />
    </Suspense>
  );
}
