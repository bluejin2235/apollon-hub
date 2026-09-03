"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "@/lib/website/api";
import { KEY_STORE_LONG_EDGE, INSIGHT_KEY_MIN_LONG_EDGE, insightKeyCropTooSmallMessage } from "@/lib/website/image-long-edge";
import { showToast } from "@/components/website/toast";
import { describeUploadError } from "@/lib/website/upload-error";
import { newStoredFilename, uploadObjectPath } from "@/lib/website/upload-path";
import { mediaUrl } from "@/lib/website/work-detail";
import "./ui/work-admin.css";

export type InsightCropRatio = "1:1" | "3:4" | "16:9";

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
  initialRatio?: InsightCropRatio;
  onClose: () => void;
  onSaved: (next: { src: string; width: number; height: number; ratio: InsightCropRatio }) => void;
};

export function InsightCropModal({
  open,
  src,
  siteUrl,
  folder,
  initialRatio,
  onClose,
  onSaved
}: Props) {
  const [ratio, setRatio] = useState<InsightCropRatio>(initialRatio ?? "3:4");
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const cropRef = useRef<HTMLCanvasElement>(null);
  const deskRef = useRef<HTMLCanvasElement>(null);
  const mobRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const meta = ratioMeta(ratio);
  const zoomFactor = zoom / 100;
  const rect =
    img && img.naturalWidth
      ? cropRect(img.naturalWidth, img.naturalHeight, meta.rw, meta.rh, zoomFactor, pan.x, pan.y)
      : { x: 0, y: 0, w: 0, h: 0 };

  useEffect(() => {
    if (!open) return;
    setRatio(initialRatio ?? "3:4");
    setZoom(100);
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
  }, [open, src, siteUrl, initialRatio]);

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

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!img) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGrabbing(true);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = drag.current;
    const canvas = cropRef.current;
    if (!start || !canvas || !img) return;
    const maxX = Math.max(1, img.naturalWidth - rect.w);
    const maxY = Math.max(1, img.naturalHeight - rect.h);
    const dx = ((event.clientX - start.x) / canvas.clientWidth) * rect.w;
    const dy = ((event.clientY - start.y) / canvas.clientHeight) * rect.h;
    setPan({
      x: Math.min(1, Math.max(0, start.panX - dx / maxX)),
      y: Math.min(1, Math.max(0, start.panY - dy / maxY))
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = null;
    setGrabbing(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }

  async function save() {
    if (!img || rect.w <= 0) return;
    setBusy(true);
    try {
      const long = Math.max(rect.w, rect.h);
      if (long < INSIGHT_KEY_MIN_LONG_EDGE) {
        showToast({ tone: "error", message: insightKeyCropTooSmallMessage() });
        return;
      }
      const scale = long > KEY_STORE_LONG_EDGE ? KEY_STORE_LONG_EDGE / long : 1;
      const outW = Math.max(1, Math.round(rect.w * scale));
      const outH = Math.max(1, Math.round(rect.h * scale));
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
      const res = await uploadFile(raw, "insights", uploadObjectPath(folder, filename), {
        fields: { role: "insight-key" }
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

  return (
    <div className="ov on" role="dialog" aria-modal="true" aria-label="비율 고르고 자르기">
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
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          </div>
          <div className="side">
            <h4>비율</h4>
            <div className="ratios">
              {RATIOS.map((item) => (
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
