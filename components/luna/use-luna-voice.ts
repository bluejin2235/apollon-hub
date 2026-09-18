"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type SpeechRecCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

async function accessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export type LunaVoiceState = {
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
};

export function useLunaVoice(opts: {
  disabled?: boolean;
  onText: (text: string) => void;
}): LunaVoiceState {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const backupRef = useRef("");
  const startedAtRef = useRef(0);
  const onTextRef = useRef(opts.onText);
  onTextRef.current = opts.onText;

  const cleanup = useCallback(() => {
    try {
      speechRef.current?.stop();
    } catch {
      /* ignore */
    }
    speechRef.current = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startSpeechBackup = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = "ko-KR";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const t = last?.[0]?.transcript?.trim() ?? "";
        if (t) backupRef.current = t;
      };
      rec.onerror = () => undefined;
      rec.onend = () => undefined;
      rec.start();
      speechRef.current = rec;
    } catch {
      /* Safari 권한 거부 등 */
    }
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob, seconds: number) => {
    const token = await accessToken();
    if (!token) throw new Error("login");
    const form = new FormData();
    const mime = blob.type || "audio/webm";
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
    form.append("file", blob, `speech.${ext}`);
    form.append("seconds", String(Math.max(1, Math.round(seconds))));
    const res = await fetch("/api/luna/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as { text?: string };
    const text = typeof json.text === "string" ? json.text.trim() : "";
    if (!text) throw new Error("empty");
    return text;
  }, []);

  const finish = useCallback(
    async (blob: Blob | null) => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      cleanup();
      try {
        if (blob && blob.size > 400) {
          const text = await transcribeBlob(blob, seconds);
          onTextRef.current(text);
          setError(null);
          return;
        }
      } catch (err) {
        console.error("[luna/voice] api", err);
      }
      const backup = backupRef.current.trim();
      if (backup) {
        onTextRef.current(backup);
        setError(null);
        return;
      }
      setError("알아듣지 못했어요. 직접 써 주세요.");
    },
    [cleanup, transcribeBlob]
  );

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
      return;
    }
    void finish(null);
  }, [finish]);

  const start = useCallback(() => {
    if (opts.disabled || listening) return;
    setError(null);
    backupRef.current = "";
    chunksRef.current = [];
    startedAtRef.current = Date.now();

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        if (typeof MediaRecorder === "undefined") {
          startSpeechBackup();
          setListening(true);
          return;
        }
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
        const rec = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        recorderRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || "audio/webm"
          });
          void finish(blob);
        };
        rec.start();
        startSpeechBackup();
        setListening(true);
        window.setTimeout(() => {
          if (recorderRef.current === rec && rec.state === "recording") rec.stop();
        }, 20_000);
      } catch {
        const Ctor = speechCtor();
        if (!Ctor) {
          setError("마이크를 쓸 수 없어요. 직접 써 주세요.");
          return;
        }
        try {
          const rec = new Ctor();
          rec.lang = "ko-KR";
          rec.interimResults = false;
          rec.continuous = false;
          rec.onresult = (ev) => {
            const t = ev.results[0]?.[0]?.transcript?.trim() ?? "";
            if (t) onTextRef.current(t);
            else setError("알아듣지 못했어요. 직접 써 주세요.");
            cleanup();
          };
          rec.onerror = () => {
            setError("마이크를 쓸 수 없어요. 직접 써 주세요.");
            cleanup();
          };
          rec.onend = () => cleanup();
          rec.start();
          speechRef.current = rec;
          setListening(true);
        } catch {
          setError("마이크를 쓸 수 없어요. 직접 써 주세요.");
        }
      }
    })();
  }, [cleanup, finish, listening, opts.disabled, startSpeechBackup]);

  return { listening, error, start, stop };
}
