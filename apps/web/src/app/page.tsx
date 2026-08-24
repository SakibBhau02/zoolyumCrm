"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  CalendarCheck,
  Globe2,
  ListTodo,
  Plug,
  Radio,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/components/shared";
import { BrandLogo } from "@/components/brand-logo";

const EASE = [0.22, 1, 0.36, 1] as const;

const modules = [
  { icon: Radio, name: "Pulse", desc: "Lead pipeline with scoring & weighted forecast" },
  { icon: Users, name: "Accounts", desc: "Client health scores and churn watch" },
  { icon: Workflow, name: "Flow", desc: "Projects, risk flags, milestones & files" },
  { icon: ListTodo, name: "Tasks", desc: "Execution with time logs & My Day" },
  { icon: CalendarCheck, name: "People", desc: "Attendance, leaves, payroll & utilization" },
  { icon: Banknote, name: "Capital", desc: "Invoices, expenses, collections & profitability" },
  { icon: BarChart3, name: "Insight", desc: "Cross-module correlations & executive view" },
  { icon: Globe2, name: "Portal", desc: "Branded client portal with approvals" },
  { icon: ShieldCheck, name: "Control", desc: "RBAC, integrations, audit trail" },
];

function LandingCard({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: EASE }}
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10"
      )}
    >
      {children}
    </motion.div>
  );
}

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="bg-mesh pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[50rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <BrandLogo />
        <div className="flex items-center gap-2">
          <Link
            href="/portal-login"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Client portal
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gradient px-4 py-2 text-[12.5px] font-bold text-white shadow-lg shadow-violet-500/25 transition-transform hover:scale-[1.02]"
          >
            Sign in <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-[11px] font-semibold text-primary">
            <Plug className="size-3" /> 9 modules · one operating system
          </span>
          <h1 className="mx-auto max-w-3xl font-heading text-4xl font-bold leading-tight md:text-6xl">
            Every signal in your agency,{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "var(--brand-gradient, linear-gradient(135deg, oklch(0.56 0.23 290), oklch(0.6 0.21 310), oklch(0.62 0.16 220)))",
              }}
            >
              on one dashboard
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
            Zoolyum OS unifies leads, clients, projects, tasks, people, finance and insights — from first
            pitch to final payment.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-[13px] font-bold text-white shadow-lg shadow-violet-500/30 transition-transform hover:scale-[1.02]"
            >
              Open dashboard <ArrowRight className="size-4" />
            </Link>
            <span className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
              demo · <span className="font-mono text-foreground">sakib@zoolyum.com</span>
            </span>
          </div>
        </motion.div>

        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => (
            <LandingCard key={m.name} index={i}>
              <div className="flex size-10 items-center justify-center rounded-xl bg-brand-gradient-soft">
                <m.icon className="size-5 text-primary" />
              </div>
              <h3 className="mt-3 font-heading text-[15px] font-semibold">{m.name}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{m.desc}</p>
            </LandingCard>
          ))}
        </div>
      </section>
    </main>
  );
}