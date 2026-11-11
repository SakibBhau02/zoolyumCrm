"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Fingerprint, Lock, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-logo";
import { useBranding } from "@/lib/branding-context";
import { apiFetch } from "@/lib/api";
import { biometricErrorMessage, loginWithFingerprint } from "@/lib/webauthn";

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
  const [fingerprintBusy, setFingerprintBusy] = useState(false);

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

  /**
   * Passwordless sign-in with the platform fingerprint sensor (WebAuthn).
   * After the session is issued we also clock the employee in/out based on
   * today's attendance state, so touching the sensor is the whole morning
   * routine: authenticate + punch.
   */
  const fingerprintLogin = async () => {
    setError(null);
    setFingerprintBusy(true);
    try {
      await loginWithFingerprint(email.trim() || undefined);
      // Best-effort punch; an account without an employee record simply skips.
      try {
        const today = await apiFetch<any>("/people/attendance/today");
        const mine = today?.mine;
        if (mine) {
          const action = !mine.checkIn || mine.checkOut ? "in" : "out";
          await apiFetch("/people/attendance/kiosk", {
            method: "POST",
            body: JSON.stringify({ action, mode: "self" }),
          });
        }
      } catch {
        /* punch is optional — never block sign-in */
      }
      // Full navigation so AuthProvider loads /auth/me with the new token.
      window.location.href = "/dashboard";
    } catch (err: any) {
      setError(biometricErrorMessage(err));
    } finally {
      setFingerprintBusy(false);
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
            <h1 className="mt-4 font-heading text-page font-bold">
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
            <p className="mt-1 text-body text-muted-foreground">
              Your agency operating system — every signal, one dashboard.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-meta font-semibold text-muted-foreground">Work email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@zoolyum.com"
                  required
                  className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-body-lg outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-meta font-semibold text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="login-password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-10 text-body-lg outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-body text-rose-600 dark:text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient py-3 text-body-lg font-bold text-white transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight className="size-3.5" />
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            onClick={fingerprintLogin}
            disabled={fingerprintBusy || busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-body font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Fingerprint className="size-3.5 text-primary" />
            {fingerprintBusy ? "Waiting for fingerprint…" : "Sign in with fingerprint"}
          </button>
          <p className="mt-2 text-center text-micro leading-relaxed text-muted-foreground">
            Touch your device sensor (Windows Hello / Touch ID). Signs you in and records your attendance automatically.
          </p>

          {/* Demo credentials are a development convenience only. In a
              production build they would hand the Owner account to anyone who
              opens the login page, so they are compiled out. */}
          {process.env.NODE_ENV !== "production" && (
            <p className="mt-6 text-center text-meta text-muted-foreground">
              Demo: <span className="font-mono font-medium text-foreground">sakib@zoolyum.com</span> /{" "}
              <span className="font-mono font-medium text-foreground">zoolyum123</span>
            </p>
          )}
        </div>
      </motion.div>
    </main>
  );
}