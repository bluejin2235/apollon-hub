"use client";

import { useParams } from "next/navigation";
import { RestaurantDetailView } from "@/components/restaurants/restaurant-detail-view";

export default function RestaurantDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  if (!id) {
    return <p className="text-slate-600">잘못된 링크입니다.</p>;
  }

  return <RestaurantDetailView id={id} />;
}
