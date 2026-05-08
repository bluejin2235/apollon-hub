"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ServiceCard from "@/components/service-card";
import { portalServices } from "@/lib/services";
import { supabase } from "@/lib/supabase/client";

type AuthState = "checking" | "ready";
type Profile = {
  id: string;
  email: string;
  name: string;
  department: string;
};

export default function ServiceHubPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const ensureSession = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session?.user?.email) {
        router.replace("/");
        return;
      }

      const { data: profileData, error } = await supabase
        .from("profiles")
        .select("id, email, name, department")
        .eq("email", session.user.email)
        .single();

      if (error || !profileData) {
        await supabase.auth.signOut();
        router.replace("/");
        return;
      }

      setProfile(profileData);
      setAuthState("ready");
    };

    void ensureSession();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (authState === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-300">
        인증 상태를 확인하는 중...
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-apollon-500/30 bg-cyan-900/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-apollon-500/90 text-center text-sm font-bold leading-7 text-white">
              A
            </div>
            <p className="text-xl font-medium text-white">Apollon Hub</p>
          </div>

          <div className="flex items-center gap-6">
            <p className="text-sm text-slate-100">
              {profile?.name ?? "-"} / {profile?.department ?? "-"}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <Link
                href="/settings"
                className="rounded-md px-3 py-1.5 text-slate-100 transition hover:bg-white/10 hover:text-white"
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md px-3 py-1.5 text-slate-100 transition hover:bg-white/10 hover:text-white"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-16 md:px-8">
        <section className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2 xl:max-w-5xl">
          {portalServices.map((service) => (
            <ServiceCard
              key={service.title}
              title={service.title}
              description={service.description}
              icon={service.icon}
              href={service.href}
              comingSoon={service.comingSoon}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
