import { useCallback, useState } from "react";

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** WGS84 좌표 두 점 사이 거리(m). Haversine 공식. */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 사람이 읽기 쉬운 거리 문자열 (예: 230m, 0.3km, 1.5km, 12km) */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  const km = meters / 1000;
  if (km < 10) {
    return `${km.toFixed(1)}km`;
  }
  return `${Math.round(km)}km`;
}

export type GeolocationStatus = "idle" | "loading" | "granted" | "denied" | "error";

export type GeolocationState = {
  status: GeolocationStatus;
  coords: LatLng | null;
  errorMessage: string | null;
};

const initialState: GeolocationState = {
  status: "idle",
  coords: null,
  errorMessage: null
};

/**
 * 현재 위치 요청 훅.
 * - `request()` 호출 시 권한 요청 → 좌표 보관
 * - `clear()` 호출 시 좌표 폐기 (위치 기반 기능 끄기 용도)
 * - 권한 거부 / 미지원 시 `status === "denied"` 또는 `"error"`, `errorMessage` 메시지 노출
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>(initialState);

  const request = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setState({
        status: "error",
        coords: null,
        errorMessage: "이 브라우저에서는 위치 정보를 지원하지 않습니다."
      });
      return;
    }
    setState((prev) => ({ ...prev, status: "loading", errorMessage: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          status: "granted",
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          errorMessage: null
        });
      },
      (err) => {
        const status: GeolocationStatus = err.code === err.PERMISSION_DENIED ? "denied" : "error";
        setState({
          status,
          coords: null,
          errorMessage:
            err.code === err.PERMISSION_DENIED
              ? "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요."
              : err.code === err.TIMEOUT
                ? "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요."
                : err.message || "위치를 확인하지 못했습니다."
        });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  const clear = useCallback(() => {
    setState(initialState);
  }, []);

  return { state, request, clear };
}
