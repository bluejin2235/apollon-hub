import { RestaurantDetailView } from "@/components/restaurants/restaurant-detail-view";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function RestaurantDetailPage({ params }: PageProps) {
  const { id } = await params;
  if (!id) {
    return <p className="text-slate-600">잘못된 링크입니다.</p>;
  }
  return <RestaurantDetailView id={id} />;
}
