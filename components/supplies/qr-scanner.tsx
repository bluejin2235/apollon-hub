"use client";

import { Html5Qrcode } from "html5-qrcode";
import { useCallback, useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

type BarcodeDetector = InstanceType<NonNullable<Window["BarcodeDetector"]>>;

type Props = {
  onScan: (decodedText: string) => void;
  /** false면 카메라 중지 (재스캔 시 key 변경 권장) */
  active?: boolean;
};

function scanLog(appendDebugLog: (message: string) => void, message: string) {
  console.log(message);
  appendDebugLog(message);
}

function DebugLogPanel({ debugLog }: { debugLog: string[] }) {
  if (debugLog.length === 0) return null;
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-2">
      {debugLog.map((log, i) => (
        <p key={i} className="font-mono text-xs text-yellow-300">
          {log}
        </p>
      ))}
    </div>
  );
}

function supportsBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function pickRearCamera(cameras: { id: string; label: string }[]): string {
  if (cameras.length === 0) {
    throw new Error("카메라를 찾을 수 없습니다.");
  }
  const back = cameras.find((c) => /back|rear|environment|후면|wide/i.test(c.label));
  return (back ?? cameras[cameras.length - 1]).id;
}

function ScannerOverlay({ starting }: { starting: boolean }) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6">
        <div className="aspect-square w-full max-w-[260px] rounded-xl border-2 border-violet-400 shadow-[0_0_24px_rgba(139,92,246,0.35)]" />
        <p className="text-center text-xs font-medium text-white/90">QR 코드를 사각형 안에 맞춰 주세요</p>
      </div>
      {starting ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/70 text-sm text-white">
          카메라 준비 중…
        </div>
      ) : null}
    </>
  );
}

function NativeBarcodeScanner({
  onScan,
  active,
  appendDebugLog
}: {
  onScan: (decodedText: string) => void;
  active: boolean;
  appendDebugLog: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const appendDebugLogRef = useRef(appendDebugLog);
  appendDebugLogRef.current = appendDebugLog;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!active) return;

    handledRef.current = false;
    setError(null);
    setStarting(true);

    const cleanup = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }
      detectorRef.current = null;
    };

    const start = async () => {
      try {
        scanLog(appendDebugLogRef.current, "[qr-scanner] BarcodeDetector 사용");

        const Detector = window.BarcodeDetector;
        if (!Detector) {
          throw new Error("BarcodeDetector를 사용할 수 없습니다.");
        }

        const detector = new Detector({ formats: ["qr_code"] });
        detectorRef.current = detector;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          throw new Error("비디오 요소를 찾을 수 없습니다.");
        }

        video.srcObject = stream;
        video.playsInline = true;
        await video.play();

        setStarting(false);

        intervalRef.current = setInterval(() => {
          if (handledRef.current || !videoRef.current || !canvasRef.current) return;

          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return;

          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }

          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, w, h);

          void detector
            .detect(canvas)
            .then((codes) => {
              const text = codes[0]?.rawValue;
              if (!text || handledRef.current) return;
              handledRef.current = true;
              scanLog(appendDebugLogRef.current, `[qr-scanner] 인식 성공: ${text}`);
              cleanup();
              onScanRef.current(text);
            })
            .catch(() => {
              /* 프레임마다 미인식 — 무시 */
            });
        }, 100);
      } catch (e) {
        setStarting(false);
        cleanup();
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
      cleanup();
    };
  }, [active]);

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <ScannerOverlay starting={starting} />
        <video
          ref={videoRef}
          className="min-h-[300px] w-full object-cover"
          muted
          playsInline
          autoPlay
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden />
      </div>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Html5QrcodeFallback({
  onScan,
  active,
  readerId,
  appendDebugLog
}: {
  onScan: (decodedText: string) => void;
  active: boolean;
  readerId: string;
  appendDebugLog: (message: string) => void;
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const appendDebugLogRef = useRef(appendDebugLog);
  appendDebugLogRef.current = appendDebugLog;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    if (!active) return;

    handledRef.current = false;
    setError(null);
    setStarting(true);

    const scanner = new Html5Qrcode(readerId, {
      verbose: false,
      useBarCodeDetectorIfSupported: true
    });
    scannerRef.current = scanner;

    const start = async () => {
      try {
        scanLog(appendDebugLogRef.current, "[qr-scanner] html5-qrcode 폴백");

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
              facingMode: { ideal: "environment" }
            }
          },
          (decodedText) => {
            scanLog(appendDebugLogRef.current, `[qr-scanner] 인식 성공: ${decodedText}`);
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
    <>
      <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <ScannerOverlay starting={starting} />
        <div id={readerId} className="min-h-[300px] w-full [&_video]:object-cover" />
      </div>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function QrScanner({ onScan, active = true }: Props) {
  const readerId = useId().replace(/:/g, "");
  const useNative = supportsBarcodeDetector();
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const appendDebugLog = useCallback((message: string) => {
    setDebugLog((prev) => [...prev, message]);
  }, []);

  useEffect(() => {
    if (active) setDebugLog([]);
  }, [active, readerId]);

  if (!active) {
    return (
      <div className="space-y-3">
        <div className="relative min-h-[300px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {useNative ? (
        <NativeBarcodeScanner onScan={onScan} active={active} appendDebugLog={appendDebugLog} />
      ) : (
        <Html5QrcodeFallback
          onScan={onScan}
          active={active}
          readerId={readerId}
          appendDebugLog={appendDebugLog}
        />
      )}
      <DebugLogPanel debugLog={debugLog} />
    </div>
  );
}
