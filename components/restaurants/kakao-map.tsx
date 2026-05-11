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
  event: { addListener: (target: unknown, evt: string, fn: () => void) => void };
  InfoWindow: new (opts: { content: string }) => {
    open: (map: unknown, marker: unknown) => void;
    setContent: (html: string) => void;
  };
  MarkerImage: new (src: string, size: unknown, opts?: { offset?: unknown }) => unknown;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};

type KakaoMapInstance = InstanceType<Maps["Map"]>;
type KakaoMarkerInstance = InstanceType<Maps["Marker"]>;
type KakaoInfoWindowInstance = InstanceType<Maps["InfoWindow"]>;

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
};

const SEONGSU = { lat: 37.5446, lng: 127.0557 };

const pinImageByColor = new Map<string, unknown>();

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

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function KakaoMapPanel({ restaurants, selectedId, focusNonce = 0, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<KakaoMapInstance | null>(null);
  const markers = useRef<Map<string, KakaoMarkerInstance>>(new Map());
  const infoRef = useRef<KakaoInfoWindowInstance | null>(null);

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
        infoRef.current = new M.InfoWindow({ content: "" });
        window.setTimeout(() => map.relayout(), 120);
      } catch (e) {
        console.error(e);
      }
    };
    void run();
    return () => {
      cancelled = true;
      // Unmount: clear latest markers on ref (intentional read at cleanup time).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const snap = markers.current;
      snap.forEach((m) => m.setMap(null));
      snap.clear();
      mapInst.current = null;
      infoRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const M = maps();
    const iw = infoRef.current;
    markers.current.forEach((m) => m.setMap(null));
    markers.current.clear();

    restaurants.forEach((r) => {
      if (r.lat == null || r.lng == null) return;
      const pos = new M.LatLng(r.lat, r.lng);
      const color = categoryMarkerColor(r);
      const marker = new M.Marker({ position: pos, map, image: markerIcon(M, color) });
      M.event.addListener(marker, "click", () => {
        onMarkerClick?.(r.id);
        if (iw) {
          iw.setContent(
            `<div style="padding:8px 10px;font-size:12px;max-width:220px;border-left:3px solid ${color}"><strong>${escHtml(r.name)}</strong><br/><span style="color:#64748b">${escHtml(r.address)}</span></div>`
          );
          iw.open(map, marker);
        }
      });
      markers.current.set(r.id, marker);
    });

    fitBounds(restaurants);
  }, [restaurants, fitBounds, onMarkerClick]);

  useEffect(() => {
    const map = mapInst.current;
    const iw = infoRef.current;
    if (!map || !selectedId) return;
    const r = restaurants.find((x) => x.id === selectedId);
    if (!r || r.lat == null || r.lng == null || Number.isNaN(r.lat) || Number.isNaN(r.lng)) return;

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
    const marker = markers.current.get(selectedId);
    if (marker && iw) {
      const color = categoryMarkerColor(r);
      iw.setContent(
        `<div style="padding:8px 10px;font-size:12px;max-width:240px;border-left:3px solid ${color}"><strong>${escHtml(r.name)}</strong><br/><span style="color:#64748b">${escHtml(r.address)}</span></div>`
      );
      iw.open(map, marker);
    }

    const t = window.setTimeout(applyFocus, 80);
    return () => window.clearTimeout(t);
  }, [selectedId, focusNonce, restaurants]);

  return <div ref={containerRef} className="h-full min-h-[360px] w-full rounded-xl border border-slate-200 bg-white shadow-inner" />;
}
