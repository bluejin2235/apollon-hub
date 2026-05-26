"use client";

import { Html5Qrcode } from "html5-qrcode";
import { useEffect, useId, useRef, useState } from "react";

type Props = {
  onScan: (decodedText: string) => void;
  /** false면 카메라 중지 (재스캔 시 key 변경 권장) */
  active?: boolean;
};

function pickRearCamera(cameras: { id: string; label: string }[]): string {
  if (cameras.length === 0) {
    throw new Error("카메라를 찾을 수 없습니다.");
  }
  const back = cameras.find((c) => /back|rear|environment|후면|wide/i.test(c.label));
  return (back ?? cameras[cameras.length - 1]).id;
}

export function QrScanner({ onScan, active = true }: Props) {
  const readerId = useId().replace(/:/g, "");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!active) return;

    handledRef.current = false;
    setError(null);
    setStarting(true);

    const scanner = new Html5Qrcode(readerId);
    scannerRef.current = scanner;

    const start = async () => {
      try {
        const cameras = await Html5Qrcode.getCameras();
        const cameraId = pickRearCamera(cameras);

        await scanner.start(
          cameraId,
          {
            fps: 30,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const edge = Math.min(viewfinderWidth, viewfinderHeight) * 0.72;
              return { width: edge, height: edge };
            },
            aspectRatio: 1.0,
            videoConstraints: {
              facingMode: { ideal: "environment" },
              focusMode: "continuous",
              advanced: [{ zoom: 2 }]
            },
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true
            }
          },
          (decodedText) => {
            if (handledRef.current) return;
            handledRef.current = true;
            void scanner
              .stop()
              .then(() => scanner.clear())
              .catch(() => {})
              .finally(() => onScanRef.current(decodedText));
          },
          () => {
            /* 프레임마다 미인식 — 무시 */
          }
        );
        setStarting(false);
      } catch (e) {
        setStarting(false);
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setError("카메라 권한이 필요합니다. 브라우저 설정에서 카메라를 허용해 주세요.");
          return;
        }
        setError(e instanceof Error ? e.message : "카메라를 시작할 수 없습니다.");
      }
    };

    void start();

    return () => {
      handledRef.current = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (!s) return;
      void s.stop().then(() => s.clear()).catch(() => {});
    };
  }, [active, readerId]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6">
          <div className="aspect-square w-full max-w-[260px] rounded-xl border-2 border-violet-400 shadow-[0_0_24px_rgba(139,92,246,0.35)]" />
          <p className="text-center text-xs font-medium text-white/90">QR 코드를 사각형 안에 맞춰 주세요</p>
        </div>
        <div id={readerId} className="min-h-[300px] w-full [&_video]:object-cover" />
        {starting ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/70 text-sm text-white">
            카메라 준비 중…
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
