"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

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

interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  zoom?: { min: number; max: number; step: number };
}

interface ExtendedConstraintSet extends MediaTrackConstraintSet {
  zoom?: number;
}

function scanLog(appendDebugLog: (message: string) => void, message: string) {
  console.log(message);
  appendDebugLog(message);
}

function DebugLogPanel({ debugLog }: { debugLog: string[] }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[100] max-h-[40vh] overflow-y-auto bg-black px-4 py-4"
      role="log"
      aria-live="polite"
    >
      {debugLog.length === 0 ? (
        <p className="font-mono text-sm text-yellow-300">[qr-scanner] 로그 대기 중…</p>
      ) : (
        <div className="space-y-2">
          {debugLog.map((log, i) => (
            <p key={i} className="font-mono text-sm text-yellow-300">
              {log}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function supportsBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
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

function CameraScannerFrame({
  starting,
  error,
  videoRef,
  canvasRef
}: {
  starting: boolean;
  error: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
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

function stopMediaStream(stream: MediaStream | null, video: HTMLVideoElement | null) {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  if (video) {
    video.srcObject = null;
  }
}

async function tryApplyZoom(
  stream: MediaStream,
  targetZoom: number = 2.0,
  appendDebugLog?: (message: string) => void
): Promise<void> {
  const log = (message: string) => {
    console.log(message);
    if (appendDebugLog) appendDebugLog(message);
  };

  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) {
    log("[qr-scanner] videoTrack 없음");
    return;
  }

  const capabilities = videoTrack.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined;
  log("[qr-scanner] capabilities: " + JSON.stringify(capabilities));

  if (!capabilities?.zoom) {
    log("[qr-scanner] 줌 미지원");
    return;
  }

  log("[qr-scanner] 줌 capabilities: " + JSON.stringify(capabilities.zoom));

  const zoom = Math.min(targetZoom, capabilities.zoom.max);

  try {
    const constraints: ExtendedConstraintSet = { zoom };
    await videoTrack.applyConstraints({ advanced: [constraints] });
    log("[qr-scanner] 줌 적용 성공: " + zoom);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("[qr-scanner] 줌 적용 실패: " + msg);
  }
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
      stopMediaStream(streamRef.current, videoRef.current);
      streamRef.current = null;
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
        await tryApplyZoom(stream, 2.0, appendDebugLogRef.current);

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
    <CameraScannerFrame
      starting={starting}
      error={error}
      videoRef={videoRef}
      canvasRef={canvasRef}
    />
  );
}

function JsQrScanner({
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
      stopMediaStream(streamRef.current, videoRef.current);
      streamRef.current = null;
    };

    const start = async () => {
      try {
        scanLog(appendDebugLogRef.current, "[qr-scanner] jsQR 사용");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        streamRef.current = stream;
        await tryApplyZoom(stream, 2.0, appendDebugLogRef.current);

        const video = videoRef.current;
        if (!video) {
          throw new Error("비디오 요소를 찾을 수 없습니다.");
        }

        video.srcObject = stream;
        video.playsInline = true;
        await video.play();

        scanLog(appendDebugLogRef.current, "[qr-scanner] 카메라 시작 완료");
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

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, w, h);

          const imageData = ctx.getImageData(0, 0, w, h);
          const result = jsQR(imageData.data, imageData.width, imageData.height);
          if (!result?.data || handledRef.current) return;

          handledRef.current = true;
          scanLog(appendDebugLogRef.current, `[qr-scanner] 인식 성공: ${result.data}`);
          cleanup();
          onScanRef.current(result.data);
        }, 100);
      } catch (e) {
        setStarting(false);
        cleanup();
        console.error("[qr-scanner] jsQR scanner start failed", e);
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
    <CameraScannerFrame
      starting={starting}
      error={error}
      videoRef={videoRef}
      canvasRef={canvasRef}
    />
  );
}

export function QrScanner({ onScan, active = true }: Props) {
  const useNative = supportsBarcodeDetector();
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const appendDebugLog = useCallback((message: string) => {
    setDebugLog((prev) => [...prev, message]);
  }, []);

  useEffect(() => {
    if (active) setDebugLog([]);
  }, [active]);

  if (!active) {
    return (
      <div className="space-y-3">
        <div className="relative min-h-[300px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 pb-44">
        {useNative ? (
          <NativeBarcodeScanner onScan={onScan} active={active} appendDebugLog={appendDebugLog} />
        ) : (
          <JsQrScanner onScan={onScan} active={active} appendDebugLog={appendDebugLog} />
        )}
      </div>
      <DebugLogPanel debugLog={debugLog} />
    </>
  );
}
