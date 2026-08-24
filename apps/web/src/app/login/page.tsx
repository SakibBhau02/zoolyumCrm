"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";
import { useBranding } from "@/lib/branding-context";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { branding } = useBranding();
  const appName = branding?.appName ?? "Zoolyum OS";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="bg-mesh pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative w-full max-w-md"
      >
        <div className="glass rounded-3xl border border-border/60 p-8 shadow-2xl shadow-primary/10">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandLogo height={36} />
            <h1 className="mt-4 font-heading text-2xl font-bold">
              Welcome to{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: "var(--brand-gradient, linear-gradient(135deg, oklch(0.56 0.23 290), oklch(0.6 0.21 310), oklch(0.62 0.16 220)))",
                }}
              >
                {appName}
              </span>
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Your agency operating system — every signal, one dashboard.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-muted-foreground">Work email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@zoolyum.com"
                  required
                  className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11.5px] font-semibold text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-10 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 text-[13px] font-bold text-white transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight className="size-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Demo: <span className="font-mono font-medium text-foreground">sakib@zoolyum.com</span> /{" "}
            <span className="font-mono font-medium text-foreground">zoolyum123</span>
          </p>
        </div>
      </motion.div>
    </main>
  );
}