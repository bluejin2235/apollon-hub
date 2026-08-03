"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export type LunaPendingQuestion = {
  id: string;
  question: string;
  context: string | null;
  options: string[] | null;
  category: string | null;
  source: string | null;
  created_at: string;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function useLunaPendingQuestion(enabled: boolean) {
  const [pendingQuestion, setPendingQuestion] =
    useState<LunaPendingQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answeredContent, setAnsweredContent] = useState<string | null>(null);
  const [answeredMessage, setAnsweredMessage] = useState<string | null>(null);

  const loadPendingQuestion = useCallback(async () => {
    if (!enabled) return;
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/luna/questions", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        question?: LunaPendingQuestion | null;
      };
      setPendingQuestion(data.question ?? null);
    } catch {
      /* ignore */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void loadPendingQuestion();
  }, [enabled, loadPendingQuestion]);

  const submitAnswer = useCallback(
    async (answer: string) => {
      if (!pendingQuestion || busy) return null;
      const token = await getAccessToken();
      if (!token) {
        setError("로그인이 필요합니다");
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/luna/questions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            question_id: pendingQuestion.id,
            answer
          })
        });
        if (!res.ok) {
          setError((await res.text()) || "답변 저장에 실패했습니다");
          return null;
        }
        const data = (await res.json()) as {
          message?: string;
          content?: string;
        };
        const message =
          data.message?.trim() || "고맙습니다. 이제 이렇게 찾을게요.";
        const content = data.content?.trim() || answer;
        setAnsweredMessage(message);
        setAnsweredContent(content);
        setPendingQuestion(null);
        return { message, content };
      } catch (err) {
        console.error("[luna/questions]", err);
        setError("답변 저장에 실패했습니다");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [pendingQuestion, busy]
  );

  const clearAnswered = useCallback(() => {
    setAnsweredContent(null);
    setAnsweredMessage(null);
  }, []);

  return {
    pendingQuestion,
    setPendingQuestion,
    busy,
    error,
    setError,
    answeredContent,
    answeredMessage,
    submitAnswer,
    clearAnswered,
    reload: loadPendingQuestion
  };
}
