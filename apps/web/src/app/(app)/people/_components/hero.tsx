"use client";

import { cn } from "@/components/shared";

/**
 * Compact one-line identity + key-number strip used at the top of every People
 * tab. The module used to stack a page header, a nav, a KPI row of large
 * StatCards and then the real content, which pushed everything below the fold.
 * This keeps the same information in ~1/4 of the height so a tab fits the
 * viewport instead of asking for a scroll.
 */
export type HeroStat = {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "emerald" | "rose" | "amber" | "sky" | "violet";
};

const TONE: Record<NonNullable<HeroStat["tone"]>, string> = {
  default: "text-foreground",
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-500",
  amber: "text-amber-500",
  sky: "text-sky-500",
  violet: "text-violet-500",
};

export function PeopleHero({
  icon,
  title,
  subtitle,
  stats,
  actions,
  children,
  as = "h1",
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  stats?: HeroStat[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Heading level. The People layout already owns the page `h1`, so tab-level
   * heroes pass `as="h2"` (audit UX-17: two h1s on /people).
   */
  as?: "h1" | "h2";
}) {
  const Heading = as;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-brand-gradient opacity-[0.07] blur-2xl" />
      <div className="relative flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <Heading className="truncate font-heading text-title font-bold leading-tight">{title}</Heading>
            {subtitle && <p className="truncate text-body text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        {!!stats?.length && (
          <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-3 lg:flex lg:w-auto lg:min-w-0 lg:flex-1 lg:flex-wrap lg:items-stretch">
            {stats.map((s) => (
              <div
                key={s.label}
                className="min-w-0 rounded-lg border border-border/50 bg-muted/25 px-2.5 py-1.5 lg:min-w-[78px]"
                title={`${s.label}${s.sub ? ` — ${s.sub}` : ""}`}
              >
                <p className="truncate text-meta font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className={cn("font-heading text-title font-bold leading-tight tabular-nums", TONE[s.tone ?? "default"])}>
                  {s.value}
                  {s.sub && <span className="ml-1 text-meta font-medium text-muted-foreground">{s.sub}</span>}
                </p>
              </div>
            ))}
          </div>
        )}

        {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children && <div className="relative mt-2">{children}</div>}
    </section>
  );
}

/** In-page section switcher — keeps a long page to one short panel at a time. */
export function PeopleTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-body font-semibold transition-colors sm:py-1 sm:text-meta",
              active
                ? "bg-brand-gradient text-white shadow-sm"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-micro font-bold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A compact card body used in the dense dashboards (p-3 instead of CardShell's p-5). */
export function DenseCard({
  title,
  hint,
  icon,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-sm", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-heading text-section font-semibold">
            {icon}{title}
          </p>
          {hint && <p className="truncate text-body text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
