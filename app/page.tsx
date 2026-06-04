"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_TITLE } from "@/lib/portal/app-title";
import { supabase } from "@/lib/supabase/client";

const POST_LOGIN_FALLBACK = "/hub";

/** 오픈 리다이렉트 방지: "/"로 시작하는 내부 경로만 허용 */
function resolvePostLoginPath(redirectParam: string | null): string {
  if (!redirectParam?.trim()) return POST_LOGIN_FALLBACK;

  const path = redirectParam.trim();
  if (!path.startsWith("/")) return POST_LOGIN_FALLBACK;
  if (path.startsWith("//")) return POST_LOGIN_FALLBACK;
  if (/^https?:/i.test(path)) return POST_LOGIN_FALLBACK;

  return path;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const postLoginPath = useMemo(
    () => resolvePostLoginPath(searchParams.get("redirect")),
    [searchParams]
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (session) {
        router.replace(postLoginPath);
      }
    };

    void checkSession();
  }, [router, postLoginPath]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage("");

    if (!email || !password) {
      setErrorMessage("이메일과 비밀번호를 입력해주세요.");
      setLoading(false);
      return;
    }

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError || !signInData.user?.id) {
        console.error("Supabase signInWithPassword failed", {
          error: signInError,
          email
        });

        const rawMessage = signInError?.message ?? "";
        const isInvalidCredentials = /invalid login credentials/i.test(rawMessage);

        if (isInvalidCredentials) {
          setErrorMessage("이메일 또는 비밀번호가 올바르지 않습니다.");
        } else {
          setErrorMessage(
            `로그인 실패: ${rawMessage || "인증 정보를 확인할 수 없습니다."}`
          );
        }
        return;
      }

      // auth.users.id === profiles.id 보장. id 기반 조회.
      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, name, department, role, status")
        .eq("id", signInData.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Supabase profiles fetch failed after sign-in", {
          error: profileError,
          userId: signInData.user.id
        });
        await supabase.auth.signOut();
        setErrorMessage(`프로필 조회 실패: ${profileError.message}`);
        return;
      }

      if (!profileRow) {
        console.error("Supabase profiles 0 rows after sign-in", {
          userId: signInData.user.id,
          userEmail: signInData.user.email
        });
        await supabase.auth.signOut();
        setErrorMessage(
          "프로필 정보를 찾을 수 없습니다. 관리자에게 문의해 주세요."
        );
        return;
      }

      router.push(postLoginPath);
    } catch (unexpectedError) {
      console.error("Unexpected login flow error", unexpectedError);
      setErrorMessage("예상치 못한 오류가 발생했습니다. 콘솔 로그를 확인해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center">
      <section className="apollon-card w-full max-w-md p-8 shadow-glow">
        <p className="text-sm font-medium tracking-wide text-apollon-600">{APP_TITLE}</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">팀 포털 로그인</h1>
        <p className="mt-2 text-sm text-slate-600">
          단일 계정으로 내부 서비스에 접근하세요.
        </p>

        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
              이메일
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              placeholder="team@apollon.ai"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-200">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
              placeholder="비밀번호를 입력하세요"
            />
          </div>

          {errorMessage ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-apollon-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-apollon-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center">
          <p className="text-sm text-slate-600">로딩 중…</p>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
