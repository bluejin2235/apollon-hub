"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadFile } from "@/lib/website/api";
import {
  KEY_STORE_LONG_EDGE,
  INSIGHT_KEY_MIN_LONG_EDGE,
  insightKeyCropTooSmallMessage
} from "@/lib/website/image-long-edge";
import {
  WORK_KEY_RATIO,
  WORK_KEY_STORE_HEIGHT,
  WORK_KEY_STORE_WIDTH,
  workKeyCropFitsMin
} from "@/lib/website/key-image-rules";
import { showToast } from "@/components/website/toast";
import { describeUploadError } from "@/lib/website/upload-error";
import { newStoredFilename, uploadObjectPath, type UploadBucket } from "@/lib/website/upload-path";
import { mediaUrl } from "@/lib/website/work-detail";
import "./ui/work-admin.css";

export type InsightCropRatio = "1:1" | "3:4" | "16:9";

const ALL_RATIOS: InsightCropRatio[] = ["1:1", "3:4", "16:9"];

const RATIOS: {
  id: InsightCropRatio;
  rw: number;
  rh: number;
  title: string;
  desc: string;
  cls: string;
  shape: string;
  tag: string;
}[] = [
  {
    id: "1:1",
    rw: 1,
    rh: 1,
    title: "1 : 1 정사각",
    desc: "사진 한 장 · 컬처",
    cls: "r-1-1",
    shape: "s-1-1",
    tag: "1 : 1"
  },
  {
    id: "3:4",
    rw: 3,
    rh: 4,
    title: "3 : 4 세로",
    desc: "인터뷰 · 긴 글",
    cls: "r-3-4",
    shape: "s-3-4",
    tag: "3 : 4"
  },
  {
    id: "16:9",
    rw: 16,
    rh: 9,
    title: "16 : 9 가로",
    desc: "뉴스 · 짧은 글",
    cls: "r-16-9",
    shape: "s-16-9",
    tag: "16 : 9"
  }
];

export function ratioMeta(id: InsightCropRatio) {
  return RATIOS.find((item) => item.id === id) ?? RATIOS[1]!;
}

export function ratioFromSize(width: number | null, height: number | null): InsightCropRatio | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const a = width / height;
  const scores: { id: InsightCropRatio; d: number }[] = [
    { id: "1:1", d: Math.abs(a - 1) },
    { id: "3:4", d: Math.abs(a - 3 / 4) },
    { id: "16:9", d: Math.abs(a - 16 / 9) }
  ];
  scores.sort((x, y) => x.d - y.d);
  const best = scores[0]!;
  return best.d < 0.08 ? best.id : null;
}

function cropRect(
  imgW: number,
  imgH: number,
  rw: number,
  rh: number,
  zoom: number,
  panX: number,
  panY: number
) {
  const cropAspect = rw / rh;
  const imgAspect = imgW / imgH;
  let cropW: number;
  let cropH: number;
  if (imgAspect > cropAspect) {
    cropH = imgH / zoom;
    cropW = cropH * cropAspect;
  } else {
    cropW = imgW / zoom;
    cropH = cropW / cropAspect;
  }
  cropW = Math.min(cropW, imgW);
  cropH = Math.min(cropH, imgH);
  const maxX = Math.max(0, imgW - cropW);
  const maxY = Math.max(0, imgH - cropH);
  return {
    x: maxX * panX,
    y: maxY * panY,
    w: cropW,
    h: cropH
  };
}

/** 워크 대표 — 확대 없이 최대 16:9 대비 scale(0.55~1) 로 크기만 */
function workKeyCropRect(imgW: number, imgH: number, scale: number, panX: number, panY: number) {
  const cropAspect = WORK_KEY_RATIO;
  const imgAspect = imgW / imgH;
  let maxW: number;
  let maxH: number;
  if (imgAspect >= cropAspect) {
    maxH = imgH;
    maxW = maxH * cropAspect;
  } else {
    maxW = imgW;
    maxH = maxW / cropAspect;
  }
  const s = Math.min(1, Math.max(0.55, scale));
  const w = Math.min(imgW, maxW * s);
  const h = Math.min(imgH, maxH * s);
  const maxX = Math.max(0, imgW - w);
  const maxY = Math.max(0, imgH - h);
  return { x: maxX * panX, y: maxY * panY, w, h, maxX, maxY };
}

function drawCrop(
  canvas: HTMLCanvasElement | null,
  img: HTMLImageElement | null,
  rect: { x: number; y: number; w: number; h: number }
) {
  if (!canvas || !img || rect.w <= 0 || rect.h <= 0) return;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, cssW, cssH);
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const res = await fetch(src, { mode: "cors" });
  if (!res.ok) throw new Error("image_fetch");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load"));
    };
    img.src = url;
  });
}

type Props = {
  open: boolean;
  src: string;
  siteUrl: string;
  folder: string;
  /** 기본 인사이트 세 가지. 워크는 ['16:9'] */
  ratios?: InsightCropRatio[];
  initialRatio?: InsightCropRatio;
  /** insight = 기존 UI, work-key = 목업 스테이지 UI */
  chrome?: "insight" | "work-key";
  bucket?: UploadBucket;
  uploadRole?: string;
  onClose: () => void;
  onSaved: (next: { src: string; width: number; height: number; ratio: InsightCropRatio }) => void;
};

export function InsightCropModal({
  open,
  src,
  siteUrl,
  folder,
  ratios = ALL_RATIOS,
  initialRatio,
  chrome = "insight",
  bucket = "insights",
  uploadRole = "insight-key",
  onClose,
  onSaved
}: Props) {
  const allowed = useMemo(() => {
    const set = new Set(ratios);
    return RATIOS.filter((item) => set.has(item.id));
  }, [ratios]);

  const defaultRatio =
    initialRatio && allowed.some((item) => item.id === initialRatio)
      ? initialRatio
      : allowed[0]?.id ?? "3:4";

  const [ratio, setRatio] = useState<InsightCropRatio>(defaultRatio);
  const [zoom, setZoom] = useState(100);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const cropRef = useRef<HTMLCanvasElement>(null);
  const deskRef = useRef<HTMLCanvasElement>(null);
  const mobRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "pan" | "resize";
    x: number;
    y: number;
    panX: number;
    panY: number;
    scale: number;
  } | null>(null);

  const isWorkKey = chrome === "work-key";
  const showRatioPicker = !isWorkKey && allowed.length > 1;
  const meta = ratioMeta(ratio);

  const rect = useMemo(() => {
    if (!img || !img.naturalWidth) return { x: 0, y: 0, w: 0, h: 0, maxX: 0, maxY: 0 };
    if (isWorkKey) {
      return workKeyCropRect(img.naturalWidth, img.naturalHeight, scale, pan.x, pan.y);
    }
    const r = cropRect(
      img.naturalWidth,
      img.naturalHeight,
      meta.rw,
      meta.rh,
      zoom / 100,
      pan.x,
      pan.y
    );
    return { ...r, maxX: Math.max(0, img.naturalWidth - r.w), maxY: Math.max(0, img.naturalHeight - r.h) };
  }, [img, isWorkKey, scale, pan.x, pan.y, meta.rw, meta.rh, zoom]);

  const storeSize = useMemo(() => {
    if (rect.w <= 0) return { w: 0, h: 0 };
    const long = Math.max(rect.w, rect.h);
    if (long <= 0) return { w: 0, h: 0 };
    // 워크: 긴 변을 항상 2560으로. 인사이트: 넘을 때만 줄임.
    const s = isWorkKey
      ? KEY_STORE_LONG_EDGE / long
      : long > KEY_STORE_LONG_EDGE
        ? KEY_STORE_LONG_EDGE / long
        : 1;
    return {
      w: Math.max(1, Math.round(rect.w * s)),
      h: Math.max(1, Math.round(rect.h * s))
    };
  }, [rect.w, rect.h, isWorkKey]);

  const trimMessage = useMemo(() => {
    if (!img || !isWorkKey) return "";
    const trimX = Math.max(0, Math.round(img.naturalWidth - rect.w));
    const trimY = Math.max(0, Math.round(img.naturalHeight - rect.h));
    if (trimY > 0 && trimX === 0) return `위아래 ${trimY}px 이 잘립니다`;
    if (trimX > 0 && trimY === 0) return `좌우 ${trimX}px 이 잘립니다`;
    if (trimX > 0 && trimY > 0) return `좌우 ${trimX}px · 위아래 ${trimY}px 이 잘립니다`;
    return "원본 전체가 들어갑니다";
  }, [img, isWorkKey, rect.w, rect.h]);

  useEffect(() => {
    if (!open) return;
    setRatio(defaultRatio);
    setZoom(100);
    setScale(1);
    setPan({ x: 0.5, y: 0.5 });
    setImg(null);
    let cancelled = false;
    const url = mediaUrl(siteUrl, src) || src;
    void loadImage(url)
      .then((loaded) => {
        if (!cancelled) setImg(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          showToast({ tone: "error", message: "이미지를 불러오지 못했습니다" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, src, siteUrl, defaultRatio]);

  const paint = useCallback(() => {
    drawCrop(cropRef.current, img, rect);
    drawCrop(deskRef.current, img, rect);
    drawCrop(mobRef.current, img, rect);
  }, [img, rect]);

  useEffect(() => {
    paint();
  }, [paint, ratio]);

  useEffect(() => {
    if (!open) return;
    function onResize() {
      paint();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, paint]);

  function onPointerDown(event: React.PointerEvent, mode: "pan" | "resize" = "pan") {
    if (!img) return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setGrabbing(true);
    drag.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      scale
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = drag.current;
    if (!start || !img) return;
    if (start.mode === "resize" && isWorkKey) {
      const stage = stageRef.current;
      if (!stage) return;
      const dy = event.clientY - start.y;
      const delta = (-dy / stage.clientHeight) * 1.4;
      setScale(Math.min(1, Math.max(0.55, start.scale + delta)));
      return;
    }
    const maxX = Math.max(1, rect.maxX || img.naturalWidth - rect.w);
    const maxY = Math.max(1, rect.maxY || img.naturalHeight - rect.h);
    const stage = stageRef.current ?? cropRef.current;
    const refW = stage && "clientWidth" in stage ? stage.clientWidth : 1;
    const refH = stage && "clientHeight" in stage ? stage.clientHeight : 1;
    const dx = ((event.clientX - start.x) / Math.max(1, refW)) * rect.w;
    const dy = ((event.clientY - start.y) / Math.max(1, refH)) * rect.h;
    // 남는 축으로만 이동
    const nextX = rect.maxX > 1 ? Math.min(1, Math.max(0, start.panX - dx / maxX)) : 0.5;
    const nextY = rect.maxY > 1 ? Math.min(1, Math.max(0, start.panY - dy / maxY)) : 0.5;
    setPan({ x: nextX, y: nextY });
  }

  function onPointerUp(event: React.PointerEvent) {
    drag.current = null;
    setGrabbing(false);
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // already released
    }
  }

  async function save() {
    if (!img || rect.w <= 0) return;
    setBusy(true);
    try {
      if (isWorkKey) {
        if (!workKeyCropFitsMin(img.naturalWidth, img.naturalHeight)) {
          showToast({
            tone: "error",
            message: `자른 결과가 ${WORK_KEY_STORE_WIDTH}×${WORK_KEY_STORE_HEIGHT} 미만입니다. 더 큰 이미지를 올려주세요.`
          });
          return;
        }
      } else {
        const long = Math.max(rect.w, rect.h);
        if (long < INSIGHT_KEY_MIN_LONG_EDGE) {
          showToast({ tone: "error", message: insightKeyCropTooSmallMessage() });
          return;
        }
      }

      const outW = storeSize.w;
      const outH = storeSize.h;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (next) => (next ? resolve(next) : reject(new Error("toBlob_failed"))),
          "image/jpeg",
          0.92
        );
      });
      const raw = new File([blob], "key-crop.jpg", { type: "image/jpeg" });
      const filename = newStoredFilename("jpg");
      const res = await uploadFile(raw, bucket, uploadObjectPath(folder, filename), {
        fields: { role: uploadRole }
      });
      if (!res.ok || !res.data?.publicUrl) {
        const parsed = describeUploadError(
          res.ok ? "request_failed" : res.error,
          res.ok ? 0 : res.status,
          res.ok ? undefined : res.details
        );
        showToast({ tone: "error", message: parsed.message });
        return;
      }
      onSaved({
        src: res.data.publicUrl,
        width: res.data.width ?? outW,
        height: res.data.height ?? outH,
        ratio
      });
      onClose();
    } catch (err) {
      showToast({
        tone: "error",
        message: err instanceof Error ? err.message : "자르기를 저장하지 못했습니다"
      });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  if (isWorkKey) {
    const imgW = img?.naturalWidth ?? 0;
    const imgH = img?.naturalHeight ?? 0;
    const winLeft = imgW > 0 ? (rect.x / imgW) * 100 : 0;
    const winTop = imgH > 0 ? (rect.y / imgH) * 100 : 0;
    const winW = imgW > 0 ? (rect.w / imgW) * 100 : 100;
    const winH = imgH > 0 ? (rect.h / imgH) * 100 : 100;
    const previewUrl = mediaUrl(siteUrl, src) || src;

    return (
      <div className="wa ov on" role="dialog" aria-modal="true" aria-label="16:9 로 자르기">
        <div className="mw key-crop-mw">
          <div className="mwh">
            <b>16:9 로 자르기</b>
            <button type="button" className="xb" onClick={onClose} aria-label="닫기">
              ×
            </button>
          </div>
          <div className="key-crop-body">
            <div
              ref={stageRef}
              className={`key-crop-stage${grabbing ? " grabbing" : ""}`}
              style={imgW && imgH ? { aspectRatio: `${imgW} / ${imgH}` } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="key-crop-src" src={previewUrl} alt="" draggable={false} />
              <div
                className="key-crop-win"
                style={{ left: `${winLeft}%`, top: `${winTop}%`, width: `${winW}%`, height: `${winH}%` }}
                onPointerDown={(e) => onPointerDown(e, "pan")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <div className="key-crop-grid" aria-hidden>
                  <i className="v1" />
                  <i className="v2" />
                  <i className="h1" />
                  <i className="h2" />
                </div>
                <div
                  className="key-crop-handle t"
                  onPointerDown={(e) => onPointerDown(e, "resize")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
                <div
                  className="key-crop-handle b"
                  onPointerDown={(e) => onPointerDown(e, "resize")}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
              <div className="key-crop-badge">16 : 9 고정</div>
            </div>

            <div className="key-crop-info">
              <span>
                원본 <b>{imgW && imgH ? `${imgW} × ${imgH}` : "—"}</b>
              </span>
              <span>→</span>
              <span>
                저장 <b>{storeSize.w && storeSize.h ? `${storeSize.w} × ${storeSize.h}` : "—"}</b>
              </span>
              <span className="sp" />
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setPan({ x: 0.5, y: 0.5 });
                  setScale(1);
                }}
              >
                가운데로
              </button>
            </div>

            <div className="tip on key-crop-tip">
              틀을 끌어 어느 부분을 쓸지 고릅니다.
              <br />
              목록 카드와 상세 페이지에 쓰입니다. 16:9 로만 저장됩니다.
            </div>
          </div>
          <div className="mwf key-crop-foot">
            <span className="key-crop-trim">{trimMessage}</span>
            <span className="sp" />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button
              type="button"
              className="btn acc"
              onClick={() => void save()}
              disabled={busy || !img}
            >
              이 부분으로 자르기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wa ov on" role="dialog" aria-modal="true" aria-label="비율 고르고 자르기">
      <div className="mw crop-mw">
        <div className="mwh">
          <b>비율 고르고 자르기</b>
          <button type="button" className="xb" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="mwb">
          <div className="cropzone">
            <div className={`cropbox ${meta.cls}${grabbing ? " grabbing" : ""}`}>
              <canvas
                ref={cropRef}
                onPointerDown={(e) => onPointerDown(e, "pan")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          </div>
          <div className="side">
            {showRatioPicker ? (
              <>
                <h4>비율</h4>
                <div className="ratios">
                  {allowed.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === ratio ? "rbtn on" : "rbtn"}
                      onClick={() => {
                        setRatio(item.id);
                        setZoom(100);
                        setPan({ x: 0.5, y: 0.5 });
                      }}
                    >
                      <span className={`shape ${item.shape}`} />
                      <div>
                        <div className="t">{item.title}</div>
                        <div className="d">{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <h4>크기</h4>
            <div className="zoom">
              <span className="zm">－</span>
              <input
                type="range"
                min={100}
                max={220}
                value={zoom}
                aria-label="크기"
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              <span className="zm">＋</span>
            </div>
            <h4>이렇게 보입니다</h4>
            <div className="prev">
              <div className="prevbox">
                <div className={`im ${meta.cls}`}>
                  <canvas ref={deskRef} />
                </div>
                <div className="cp">데스크탑</div>
              </div>
              <div className="prevbox mob">
                <div className={`im ${meta.cls}`}>
                  <canvas ref={mobRef} />
                </div>
                <div className="cp">모바일</div>
              </div>
            </div>
            <p className="hint-line">틀 안에서 끌어 위치를 옮깁니다</p>
          </div>
        </div>
        <div className="mwf">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn acc" onClick={() => void save()} disabled={busy || !img}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
