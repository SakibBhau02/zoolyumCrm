"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { CardShell, cn } from "@/components/shared";
import { MaskAmounts } from "@/lib/privacy";
import { Sparkline } from "./viz";

/* ────────────────────────────────────────────────────────────────────────────
   Dashboard primitives.

   Card anatomy is fixed so every block reads the same way:
     identity → main number + change → state → context/spark → next step.
   ──────────────────────────────────────────────────────────────────────────── */

export function InfoTip({ text, label = "What is this?" }: { text: string; label?: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="flex size-5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Info className="size-3" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-52 -translate-x-1/2 rounded-lg border border-border bg-card p-2.5 text-meta leading-relaxed text-muted-foreground shadow-lg group-hover/tip:block group-focus-within/tip:block"
      >
        {text}
      </span>
    </span>
  );
}

export function Delta({
  value,
  suffix = " vs prev.",
  goodWhenUp = true,
}: {
  value: number | null | undefined;
  suffix?: string;
  goodWhenUp?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-meta text-muted-foreground">No prior data</span>;
  }
  const flat = Math.abs(value) < 0.05;
  const up = value > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-meta font-semibold tabular-nums",
        good == null
          ? "text-muted-foreground"
          : good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
      )}
    >
      <Icon className="size-3.5" />
      {Math.abs(value).toFixed(1)}%
      <span className="font-normal text-muted-foreground">{suffix}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  href,
  delta,
  deltaSuffix,
  goodWhenUp = true,
  spark,
  sparkTone = "text-primary",
  definition,
  status,
  tone = "bg-primary/10 text-primary",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  href?: string;
  delta?: number | null;
  deltaSuffix?: string;
  goodWhenUp?: boolean;
  spark?: number[];
  sparkTone?: string;
  definition?: string;
  status?: ReactNode;
  tone?: string;
}) {
  const body = (
    <div className="group relative flex h-full flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", tone)}>{icon}</span>
          <span className="min-w-0 text-micro font-bold uppercase leading-tight tracking-widest text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {definition && <InfoTip text={definition} label={`Definition of ${label}`} />}
          {href && <ArrowUpRight className="size-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary" />}
        </div>
      </div>

      <p className="mt-3 font-heading text-kpi font-bold leading-none tracking-tight tabular-nums">
        {value}
      </p>

      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {delta !== undefined && <Delta value={delta} suffix={deltaSuffix} goodWhenUp={goodWhenUp} />}
        {hint && (
          <span className="min-w-0 truncate text-meta text-muted-foreground">
            <MaskAmounts text={hint} />
          </span>
        )}
      </div>

      {status && <div className="mt-1.5">{status}</div>}

      {spark && spark.length > 1 && (
        <div className="mt-auto pt-2">
          <Sparkline points={spark} height={26} className={sparkTone} />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Panel({
  title,
  subtitle,
  action,
  icon,
  children,
  className,
  tone,
  definition,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: string;
  definition?: string;
}) {
  return (
    <CardShell className={cn("flex h-full flex-col", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {icon && (
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", tone ?? "bg-primary/10 text-primary")}>
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 font-heading text-section font-semibold leading-tight">
              <span className="truncate">{title}</span>
              {definition && <InfoTip text={definition} label={`Definition of ${title}`} />}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-meta text-muted-foreground">
                <MaskAmounts text={subtitle} />
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </CardShell>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-meta font-semibold text-primary hover:underline"
    >
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function severityTone(level: "critical" | "warning" | "info" | "ok") {
  return {
    critical: {
      text: "text-rose-600 dark:text-rose-400",
      tile: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      dot: "bg-rose-500",
      border: "border-rose-500/30",
      label: "Critical",
    },
    warning: {
      text: "text-amber-600 dark:text-amber-400",
      tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
      border: "border-amber-500/30",
      label: "Warning",
    },
    info: {
      text: "text-sky-600 dark:text-sky-400",
      tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      dot: "bg-sky-500",
      border: "border-sky-500/30",
      label: "Info",
    },
    ok: {
      text: "text-emerald-600 dark:text-emerald-400",
      tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
      border: "border-emerald-500/30",
      label: "On track",
    },
  }[level];
}

export function Pill({
  level,
  children,
}: {
  level: "critical" | "warning" | "info" | "ok";
  children: ReactNode;
}) {
  const tone = severityTone(level);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-bold", tone.tile)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {children}
    </span>
  );
}

/** Big single number inside a panel, with its label underneath. */
export function Figure({
  value,
  label,
  tone,
  hint,
}: {
  value: ReactNode;
  label: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className={cn("font-heading text-stat font-bold leading-none tabular-nums", tone)}>{value}</p>
      <p className="mt-1 text-micro uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 truncate text-micro text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
