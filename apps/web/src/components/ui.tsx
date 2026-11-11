"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, ChevronDown, X } from "lucide-react";
import { cn } from "./shared";

const EASE = [0.22, 1, 0.36, 1] as const;

export function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 text-meta font-semibold text-muted-foreground">
      {children}
      {required && <span className="text-rose-500">*</span>}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  /** Renders the red asterisk next to the label. */
  required?: boolean;
  /** Replaces the hint with an inline validation message. */
  error?: string | null;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
      {error ? (
        <span className="flex items-center gap-1 text-micro font-medium text-rose-500">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </span>
      ) : (
        hint && <span className="text-micro text-muted-foreground/70">{hint}</span>
      )}
    </label>
  );
}

/**
 * Numbered (or icon-led) block inside a form. The hairline + uppercase label
 * keeps a long form scannable without adding boxes around everything.
 */
export function FormSection({
  title,
  hint,
  icon,
  step,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  step?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center gap-2.5">
        {step != null ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-micro font-bold tabular-nums text-primary ring-1 ring-primary/15">
            {step}
          </span>
        ) : (
          icon && <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
        )}
        <h4 className="shrink-0 text-meta font-bold uppercase tracking-[0.09em] text-muted-foreground">{title}</h4>
        <span aria-hidden className="h-px flex-1 bg-border/70" />
        {action}
      </div>
      {hint && <p className="mb-3 text-meta leading-relaxed text-muted-foreground/80">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * Progressive disclosure. Everything optional lives in here so the first
 * screen only asks for what the user actually came to do.
 */
export function Collapsible({
  title,
  hint,
  icon,
  badge,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  // Opening a panel near the bottom of a scrolling form would otherwise reveal
  // content below the fold — pull it into view instead.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  return (
    <div ref={panelRef} className={cn("overflow-hidden rounded-2xl border border-border/70 bg-muted/20", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        {icon && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground ring-1 ring-border/70">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-body font-semibold">
            {title}
            {badge}
          </span>
          {hint && <span className="mt-0.5 block truncate text-meta text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 px-3.5 py-3.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Small counter chip for collapsible headers. */
export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-micro font-bold tabular-nums text-primary">
      {children}
    </span>
  );
}

/**
 * Pill toggles — one tap instead of opening a select. Used for the handful of
 * fields where the choice is obvious (temperature, priority, status).
 */
export function ChipGroup<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode; tone?: string }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="group" className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              size === "sm" ? "px-2.5 py-1 text-meta" : "px-3 py-1.5 text-meta",
              active
                ? o.tone ?? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-foreground"
            )}
          >
            {o.icon}
            {o.label}
            {active && <Check className="size-3.5 opacity-70" />}
          </button>
        );
      })}
    </div>
  );
}

/** Range slider with the value pinned to the right — faster than typing. */
export function PercentSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={v}
        aria-label={label ?? "Percentage"}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--primary) ${v}%, var(--muted) ${v}%)`,
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/30 [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="w-11 shrink-0 rounded-lg bg-muted py-1 text-center text-meta font-bold tabular-nums text-foreground">
        {v}%
      </span>
    </div>
  );
}

/** Inline validation banner — same shape everywhere. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-body font-medium text-rose-500"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** Label + description on the left, an actual switch on the right. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 transition-colors hover:border-primary/25 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
        className
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold leading-tight">{label}</span>
        {hint && <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            "pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200",
            checked && "translate-x-4"
          )}
        />
      </span>
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-body-lg outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "min-h-20 resize-y", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(inputCls, "appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%3E%3Cpath%20d%3D%22M1%201l4%204%204-4%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%2F%3E%3C%2Fsvg%3E')] bg-[right_0.75rem_center] bg-no-repeat pr-8", props.className)}
    />
  );
}

export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = "md",
  bodyClassName,
  bare = false,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  /** Small uppercase kicker above the title — names the record type. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** One line under the title — sets expectations before the first field. */
  subtitle?: React.ReactNode;
  /** Optional tile rendered before the title, e.g. a section icon. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** `full` = a workspace-sized sheet for records with their own navigation. */
  size?: "md" | "lg" | "xl" | "2xl" | "3xl" | "full";
  /** Override the scrolling body — `full` uses this to render a fixed-height split layout. */
  bodyClassName?: string;
  /**
   * Render the sheet in the page flow instead of as an overlay. Used when the
   * same record view is reachable at its own URL: same chrome, no backdrop.
   */
  bare?: boolean;
  /**
   * Forms with unsaved input pass `false` so a stray backdrop click cannot
   * wipe the work in progress.
   */
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = (document.activeElement as HTMLElement) ?? null;
    const previousOverflow = document.body.style.overflow;
    // A modal owns the viewport: background scroll and tab order both stop here.
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const root = sheetRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (first ?? root).focus({ preventScroll: true });
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !bare) {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, bare]);

  const isFull = size === "full";

  const sheet = (
    <motion.div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      initial={bare ? false : { opacity: 0, scale: 0.96, y: 14 }}
      animate={bare ? undefined : { opacity: 1, scale: 1, y: 0 }}
      exit={bare ? undefined : { opacity: 0, scale: 0.96, y: 14 }}
      transition={{ duration: 0.22, ease: EASE }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex w-full flex-col overflow-hidden border border-border/60 bg-card outline-none",
        bare
          ? "h-[calc(100dvh-9.5rem)] min-h-[520px] rounded-2xl shadow-sm"
          : "shadow-2xl shadow-primary/10",
        !bare && (isFull ? "h-full max-w-[1500px] rounded-none sm:rounded-2xl" : "max-h-[92vh] rounded-2xl"),
        !bare && size === "md" && "max-w-md",
        !bare && size === "lg" && "max-w-2xl",
        !bare && size === "xl" && "max-w-4xl",
        !bare && size === "2xl" && "max-w-5xl",
        !bare && size === "3xl" && "max-w-6xl"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-start justify-between gap-3",
          isFull || bare ? "px-5 py-3.5 sm:px-7" : "px-6 pt-5",
          // A sticky footer frames the sheet — the header needs the matching
          // hairline so scrolled content does not run into the title.
          !!footer && !isFull && !bare && "border-b border-border/60 pb-4"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {icon && (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="mb-0.5 text-micro font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {eyebrow}
              </p>
            )}
            <h3 id={titleId} className="font-heading text-title font-semibold leading-tight">{title}</h3>
            {subtitle && (
              <p className="mt-1 text-meta leading-snug text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={bare ? "Back" : "Close dialog"}
          title={bare ? "Back to projects" : "Close"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50",
            bare && "border border-border"
          )}
        >
          {bare ? <ArrowLeft className="size-3.5" /> : <X className="size-3.5" />}
        </button>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1",
          isFull || bare ? "flex flex-col overflow-hidden sm:px-7" : "overflow-y-auto px-6 py-5",
          bodyClassName
        )}
      >
        {children}
      </div>
      {footer && (
        <div className={cn("shrink-0 border-t border-border/60 bg-card", isFull || bare ? "px-5 py-3 sm:px-7" : "px-6 py-4")}>{footer}</div>
      )}
    </motion.div>
  );

  if (bare) return open ? sheet : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 z-50 flex justify-center bg-black/50 backdrop-blur-sm",
            isFull ? "items-stretch p-0 sm:p-4 lg:p-6" : "items-center p-4"
          )}
          onClick={() => closeOnBackdrop && onClose()}
        >
          {sheet}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-border/60 bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
              <div className="min-w-0">{title}</div>
              <button
                onClick={onClose}
                className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="border-t border-border/60 px-6 py-4">{footer}</div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-card p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-meta font-semibold transition-all",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScoreBar({ score }: { score: number | null }) {
  const s = Math.max(0, Math.min(100, score ?? 0));
  const tone = s >= 70 ? "bg-emerald-500" : s >= 45 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${s}%` }} />
      </div>
      <span className="text-meta font-bold tabular-nums text-muted-foreground">{score ?? "—"}</span>
    </div>
  );
}

export function FormActions({
  busy,
  cancel,
  submitLabel = "Save",
  danger,
  hint,
  formId,
  submitIcon,
}: {
  busy?: boolean;
  cancel: () => void;
  submitLabel?: string;
  danger?: boolean;
  /** Left-aligned helper text, e.g. "* required" or "Assigned automatically". */
  hint?: React.ReactNode;
  /** Set when the bar lives in the modal footer, outside the <form>. */
  formId?: string;
  submitIcon?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3", formId ? "justify-end sm:justify-between" : "mt-6 justify-end")}>
      {formId && hint && (
        <p className="hidden min-w-0 flex-1 truncate text-meta text-muted-foreground sm:block">{hint}</p>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-xl border border-border px-4 py-2 text-body font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          form={formId}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-body font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
            danger
              ? "bg-rose-500 text-white hover:bg-rose-500/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {busy ? (
            <>
              <span className="size-3 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              Saving…
            </>
          ) : (
            <>
              {submitIcon}
              {submitLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}