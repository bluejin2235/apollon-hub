import { ReactNode } from "react";
import Script from "next/script";
import { RestaurantsShell } from "@/components/restaurants/restaurants-shell";

const kakaoMapKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim();

export default function RestaurantsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {kakaoMapKey ? (
        <Script
          id="kakao-maps-sdk"
          src={`//dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=${encodeURIComponent(kakaoMapKey)}`}
          strategy="afterInteractive"
        />
      ) : null}
      <RestaurantsShell>{children}</RestaurantsShell>
    </>
  );
}
