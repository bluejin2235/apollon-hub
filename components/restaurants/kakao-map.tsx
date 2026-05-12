"use client";

import { useCallback, useEffect, useRef } from "react";
import { loadKakaoMapsSdk } from "@/lib/kakao/load-maps-sdk";
import type { Restaurant } from "@/lib/restaurants/types";
import { categoryMarkerColor } from "@/lib/restaurants/types";

type Maps = {
  Map: new (el: HTMLElement, opts: { center: unknown; level: number }) => {
    setCenter: (c: unknown) => void;
    setLevel: (n: number) => void;
    relayout: () => void;
    setBounds?: (b: unknown) => void;
  };
  LatLng: new (lat: number, lng: number) => unknown;
  LatLngBounds: new () => { extend: (p: unknown) => void };
  Marker: new (opts: { position: unknown; map: unknown; image?: unknown }) => {
    setMap: (m: unknown | null) => void;
    getPosition: () => unknown;
  };
  event: {
    addListener: (target: unknown, evt: string, fn: () => void) => unknown;
    removeListener?: (target: unknown, evt: string, fn: () => void) => void;
  };
  CustomOverlay: new (opts: {
    map: unknown | null;
    position: unknown;
    content: HTMLElement;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
  }) => {
    setMap: (m: unknown | null) => void;
    setPosition: (p: unknown) => void;
  };
  MarkerImage: new (src: string, size: unknown, opts?: { offset?: unknown }) => unknown;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};

type KakaoMapInstance = InstanceType<Maps["Map"]>;
type KakaoMarkerInstance = InstanceType<Maps["Marker"]>;
type KakaoCustomOverlayInstance = InstanceType<Maps["CustomOverlay"]>;

function maps(): Maps {
  const m = (window as unknown as { kakao?: { maps: Maps } }).kakao?.maps;
  if (!m) throw new Error("kakao.maps 없음");
  return m;
}

type Props = {
  restaurants: Restaurant[];
  selectedId: string | null;
  focusNonce?: number;
  onMarkerClick?: (id: string) => void;
  /** 지도 빈 곳 클릭 시 (마커 제외) — 말풍선 닫기·선택 해제용 */
  onMapBackgroundClick?: () => void;
};

const SEONGSU = { lat: 37.5446, lng: 127.0557 };

const pinImageByColor = new Map<string, unknown>();

/** 마커 직후 지도 click이 이어질 때 배경 클릭으로 처리되지 않도록 짧게 무시(ms) */
const MAP_CLICK_SUPPRESS_MS = 280;

function markerIcon(M: Maps, hex: string): unknown {
  let img = pinImageByColor.get(hex);
  if (img) return img;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path fill="${hex}" stroke="#ffffff" stroke-width="1.5" d="M14 2C7.9 2 3 6.4 3 12.1c0 8.5 11 21.9 11 21.9s11-13.4 11-21.9C25 6.4 20.1 2 14 2z"/><circle fill="#ffffff" cx="14" cy="11.5" r="3.5"/></svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  const size = new M.Size(28, 36);
  const offset = new M.Point(14, 34);
  img = new M.MarkerImage(url, size, { offset });
  pinImageByColor.set(hex, img);
  return img;
}

/** 말풍선 DOM: 흰 배경 + 파란 테두리 + 하단 꼬리 (앵커는 래퍼 하단 중앙 = 마커 좌표) */
function buildBubbleRoot(name: string, address: string): HTMLDivElement {
  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;align-items:center;max-width:260px;pointer-events:auto;user-select:none;";

  const box = document.createElement("div");
  box.style.cssText =
    "box-sizing:border-box;width:100%;background:#fff;border:2px solid #3b82f6;border-radius:2px;" +
    "box-shadow:0 2px 10px rgba(0,0,0,0.12);padding:12px 14px;text-align:left;";

  const titleEl = document.createElement("div");
  titleEl.textContent = name;
  titleEl.style.cssText =
    "font-weight:700;font-size:14px;color:#0f172a;line-height:1.35;word-break:break-word;";

  const addrEl = document.createElement("div");
  addrEl.textContent = address;
  addrEl.style.cssText =
    "margin-top:6px;font-size:12px;font-weight:400;color:#2563eb;line-height:1.4;word-break:break-word;";

  box.appendChild(titleEl);
  box.appendChild(addrEl);

  const tail = document.createElement("div");
  tail.setAttribute("aria-hidden", "true");
  tail.style.cssText =
    "width:0;height:0;margin-top:-1px;border-left:10px solid transparent;border-right:10px solid transparent;border-top:12px solid #3b82f6;";

  root.appendChild(box);
  root.appendChild(tail);

  const stopBubble = (e: Event) => e.stopPropagation();
  root.addEventListener("mousedown", stopBubble);
  root.addEventListener("click", stopBubble);
  root.addEventListener("touchstart", stopBubble, { passive: true });

  return root;
}

export function KakaoMapPanel({
  restaurants,
  selectedId,
  focusNonce = 0,
  onMarkerClick,
  onMapBackgroundClick
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<KakaoMapInstance | null>(null);
  const markers = useRef<Map<string, KakaoMarkerInstance>>(new Map());
  const overlayRef = useRef<KakaoCustomOverlayInstance | null>(null);
  const overlaySlotRef = useRef<HTMLDivElement | null>(null);
  const mapClickHandlerRef = useRef<(() => void) | null>(null);
  const suppressMapBackgroundUntilRef = useRef(0);
  const onMapBackgroundClickRef = useRef(onMapBackgroundClick);
  onMapBackgroundClickRef.current = onMapBackgroundClick;

  const fitBounds = useCallback((list: Restaurant[]) => {
    const M = maps();
    const map = mapInst.current;
    if (!map) return;
    const withCoords = list.filter((r) => r.lat != null && r.lng != null && !Number.isNaN(r.lat) && !Number.isNaN(r.lng));
    if (withCoords.length === 0) {
      map.setCenter(new M.LatLng(SEONGSU.lat, SEONGSU.lng));
      map.setLevel(5);
      return;
    }
    if (withCoords.length === 1) {
      const r = withCoords[0];
      map.setCenter(new M.LatLng(r.lat as number, r.lng as number));
      map.setLevel(4);
      return;
    }
    const bounds = new M.LatLngBounds();
    withCoords.forEach((r) => bounds.extend(new M.LatLng(r.lat as number, r.lng as number)));
    if (typeof map.setBounds === "function") {
      map.setBounds(bounds);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await loadKakaoMapsSdk();
        if (cancelled || !containerRef.current) return;
        const M = maps();
        const map = new M.Map(containerRef.current, { center: new M.LatLng(SEONGSU.lat, SEONGSU.lng), level: 5 });
        mapInst.current = map;

        const slot = document.createElement("div");
        overlaySlotRef.current = slot;
        const overlay = new M.CustomOverlay({
          map: null,
          position: new M.LatLng(SEONGSU.lat, SEONGSU.lng),
          content: slot,
          xAnchor: 0.5,
          yAnchor: 1,
          zIndex: 3
        });
        overlayRef.current = overlay;

        const onMapClick = () => {
          if (Date.now() < suppressMapBackgroundUntilRef.current) return;
          onMapBackgroundClickRef.current?.();
        };
        mapClickHandlerRef.current = onMapClick;
        M.event.addListener(map, "click", onMapClick);

        window.setTimeout(() => map.relayout(), 120);
      } catch (e) {
        console.error(e);
      }
    };
    void run();
    return () => {
      cancelled = true;
      const map = mapInst.current;
      const M = (window as unknown as { kakao?: { maps: Maps } }).kakao?.maps;
      const handler = mapClickHandlerRef.current;
      if (map && M?.event?.removeListener && handler) {
        M.event.removeListener(map, "click", handler);
      }
      mapClickHandlerRef.current = null;

      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      overlaySlotRef.current = null;

      // eslint-disable-next-line react-hooks/exhaustive-deps
      const snap = markers.current;
      snap.forEach((m) => m.setMap(null));
      snap.clear();
      mapInst.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const M = maps();
    markers.current.forEach((m) => m.setMap(null));
    markers.current.clear();

    restaurants.forEach((r) => {
      if (r.lat == null || r.lng == null) return;
      const pos = new M.LatLng(r.lat, r.lng);
      const color = categoryMarkerColor(r);
      const marker = new M.Marker({ position: pos, map, image: markerIcon(M, color) });
      M.event.addListener(marker, "click", () => {
        suppressMapBackgroundUntilRef.current = Date.now() + MAP_CLICK_SUPPRESS_MS;
        onMarkerClick?.(r.id);
      });
      markers.current.set(r.id, marker);
    });

    fitBounds(restaurants);
  }, [restaurants, fitBounds, onMarkerClick]);

  useEffect(() => {
    const map = mapInst.current;
    const overlay = overlayRef.current;
    const slot = overlaySlotRef.current;
    if (!map || !overlay || !slot) return;

    if (!selectedId) {
      overlay.setMap(null);
      slot.replaceChildren();
      return;
    }

    const r = restaurants.find((x) => x.id === selectedId);
    if (!r || r.lat == null || r.lng == null || Number.isNaN(r.lat) || Number.isNaN(r.lng)) {
      overlay.setMap(null);
      slot.replaceChildren();
      return;
    }

    const M = maps();
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const center = new M.LatLng(lat, lng);

    const applyFocus = () => {
      map.relayout();
      map.setCenter(center);
      map.setLevel(3);
    };

    applyFocus();

    slot.replaceChildren(buildBubbleRoot(r.name, r.address));
    overlay.setPosition(center);
    overlay.setMap(map);

    const t = window.setTimeout(applyFocus, 80);
    return () => window.clearTimeout(t);
  }, [selectedId, focusNonce, restaurants]);

  return <div ref={containerRef} className="h-full min-h-[360px] w-full rounded-xl border border-slate-200 bg-white shadow-inner" />;
}
