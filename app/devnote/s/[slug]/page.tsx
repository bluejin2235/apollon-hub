export default async function DevnoteServicePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트 · 서비스</p>
      <h1 className="text-[26px] font-bold tracking-tight text-[#15171C]">
        {slug}
      </h1>
    </div>
  );
}
