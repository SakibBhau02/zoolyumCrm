"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { Btn } from "@/components/table";
import { CardShell, cn } from "@/components/shared";
import { Field, Input } from "@/components/ui";
import { BrandLogo } from "@/components/brand-logo";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function PortalLoginPage() {
  const router = useRouter();
  const { branding } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/portal-client/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Login failed");
      }
      const data = await res.json();
      if (typeof window !== "undefined") {
        localStorage.setItem("zoolyum-portal-token", data.portalToken);
      }
      router.push("/portal-client");
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
        <CardShell className="glass rounded-3xl p-8 shadow-2xl shadow-primary/10">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandLogo height={36} />
            <h1 className="mt-4 font-heading text-2xl font-bold">
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: "var(--brand-gradient, linear-gradient(135deg, oklch(0.56 0.23 290), oklch(0.6 0.21 310), oklch(0.62 0.16 220)))",
                }}
              >
                Client Portal
              </span>
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Your projects, invoices and updates — one place.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className="py-2.5 pl-9"
                />
              </div>
            </Field>

            <Field label="Password">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="py-2.5 pl-9 pr-10"
                />
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  title={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {error && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
                {error}
              </p>
            )}

            <Btn
              type="submit"
              variant="primary"
              className={cn(
                "mt-2 inline-flex w-full items-center justify-center py-3",
                busy && "pointer-events-none opacity-60"
              )}
            >
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight className="size-4" />
            </Btn>
          </form>

          <p className="mt-4 text-center text-[11.5px] text-muted-foreground">
            Forgot your password?{" "}
            <a
              href={`mailto:${branding?.email ?? "support@zoolyum.com"}?subject=Portal%20password%20reset`}
              className="font-semibold text-primary hover:underline"
            >
              Contact your agency
            </a>{" "}
            — they can reset it for you.
          </p>

          <Link
            href="/"
            className="mt-6 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to <span className="font-semibold">Zoolyum OS</span>
          </Link>
        </CardShell>
      </motion.div>
    </main>
  );
}