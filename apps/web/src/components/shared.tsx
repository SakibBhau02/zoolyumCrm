"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  level = 1,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /**
   * Heading level. A page owns exactly one `h1`; section headers that reuse this
   * component inside a page pass `level={2}` so the document outline stays flat
   * (audit UX-17/UX-18).
   */
  level?: 1 | 2;
  className?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4", className)}>
      <div>
        <Heading className="text-page font-heading font-semibold tracking-tight">{title}</Heading>
        {subtitle && <p className="mt-1 text-body-lg text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}

export function CardShell({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Anchor target for in-page section navigation. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "card-lift rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5",
        id && "scroll-mt-24",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between">
      <div>
        <h3 className="flex items-center gap-1.5 font-heading text-section font-semibold">{icon}{title}</h3>
        {subtitle && <p className="mt-0.5 text-body text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function GradientBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-meta font-semibold text-primary-foreground">
      {children}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  // tasks
  TODO: "bg-muted text-muted-foreground ring-1 ring-border",
  IN_PROGRESS: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  REVIEW: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  DONE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  BLOCKED: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  // leads
  NEW: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  CONTACTED: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
  QUALIFIED: "bg-teal-500/10 text-teal-600 dark:text-teal-300 ring-1 ring-teal-500/20",
  PROPOSAL_SENT: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  NEGOTIATION: "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20",
  WON: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  LOST: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  // projects
  ON_TRACK: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  AT_RISK: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  DELAYED: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  PLANNING: "bg-muted text-muted-foreground ring-1 ring-border",
  ACTIVE: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  PAUSED: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  ARCHIVED: "bg-muted text-muted-foreground ring-1 ring-border",
  // invoices
  DRAFT: "bg-muted text-muted-foreground ring-1 ring-border",
  SENT: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  VIEWED: "bg-primary/10 text-primary dark:text-primary ring-1 ring-primary/20",
  PARTIALLY_PAID: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  PAID: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  OVERDUE: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  CANCELLED: "bg-muted text-muted-foreground ring-1 ring-border",
  VOID: "bg-muted text-muted-foreground ring-1 ring-border",
  // clients
  GREEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  YELLOW: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  RED: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  // people
  PRESENT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  ABSENT: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  LATE: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  HALF_DAY: "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-1 ring-orange-500/20",
  WFH: "bg-sky-500/10 text-sky-600 dark:text-sky-300 ring-1 ring-sky-500/20",
  // expenses
  PENDING: "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-500/20",
  APPROVED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  REJECTED: "bg-rose-500/10 text-rose-600 dark:text-rose-300 ring-1 ring-rose-500/20",
  // other
  CONNECTED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-500/20",
  DISCONNECTED: "bg-muted text-muted-foreground ring-1 ring-border",
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-meta font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground ring-1 ring-border"
      )}
    >
      {label}
    </span>
  );
}

export function DeltaPill({
  value,
  good = true,
}: {
  value: string;
  good?: boolean;
}) {
  const up = value.startsWith("+");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-micro font-semibold tabular-nums",
        good
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "bg-rose-500/10 text-rose-600 dark:text-rose-300"
      )}
    >
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {value}
    </span>
  );
}

const STAT_TONES: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
};

const STAT_TONE_FALLBACK = ["primary", "sky", "emerald", "amber"];

export function StatCard({
  label,
  value,
  sub,
  delta,
  deltaGood,
  icon,
  index = 0,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: string;
  deltaGood?: boolean;
  icon?: React.ReactNode;
  index?: number;
  tone?: keyof typeof STAT_TONES;
}) {
  const resolvedTone = tone ?? STAT_TONE_FALLBACK[index % STAT_TONE_FALLBACK.length];
  return (
    <FadeIn delay={Math.min(index, 3) * 0.06} className="min-w-0">
      <CardShell className="relative overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-meta font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="mt-1.5 text-stat font-heading font-bold tabular-nums tracking-tight">
              {value}
            </p>
            {(delta || sub) && (
              <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                {delta && <DeltaPill value={delta} good={deltaGood ?? true} />}
                {sub && <span className="min-w-0 text-meta leading-snug text-muted-foreground">{sub}</span>}
              </div>
            )}
          </div>
          {icon && (
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                STAT_TONES[resolvedTone]
              )}
            >
              {icon}
            </div>
          )}
        </div>
      </CardShell>
    </FadeIn>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-xl bg-gradient-to-r from-muted via-border/60 to-muted",
        className
      )}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
      <p className="text-body-lg font-medium text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 text-meta text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export const AVATAR_GRADIENTS = [
  "bg-brand-gradient",
  "bg-emerald-gradient",
  "bg-gradient-to-br from-amber-400 to-orange-500",
  "bg-gradient-to-br from-sky-400 to-blue-500",
  "bg-gradient-to-br from-fuchsia-500 to-pink-500",
];

/**
 * Initials avatar with an optional photo. `src` is the WebP every browser
 * renders; `jxlSrc` adds the smaller JPEG XL source for Chrome 155+/Firefox
 * 158+/Safari 17+ via <picture>, falling back to the WebP everywhere else.
 */
export function Avatar({
  name,
  size = "size-8",
  src,
  jxlSrc,
  rounded = "rounded-full",
}: {
  name: string;
  size?: string;
  src?: string | null;
  jxlSrc?: string | null;
  rounded?: string;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const g = AVATAR_GRADIENTS[name.length % AVATAR_GRADIENTS.length];
  if (src) {
    return (
      <span className={cn("relative flex shrink-0 overflow-hidden border border-border/50 bg-muted", size, rounded)}>
        <picture>
          {jxlSrc && <source type="image/jxl" srcSet={jxlSrc} />}
          <img src={src} alt={name} loading="lazy" className="size-full object-cover" />
        </picture>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center text-micro font-bold text-white",
        rounded,
        size,
        g
      )}
    >
      {initials}
    </span>
  );
}
