import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ShortSupplyRedirectPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/supplies/${id}/loan`);
}
