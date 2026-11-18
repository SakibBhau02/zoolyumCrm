"use client";

import { cn } from "./shared";
import { PAY_META, PAYMENT_KIND_ORDER, mergePaymentOptions, paymentEnum, paymentKind, pickPaymentDetails, type PaymentKind } from "@/lib/payment-meta";

export { PAY_META, PAYMENT_KIND_ORDER, paymentEnum, paymentKind, mergePaymentOptions, pickPaymentDetails };
export type { PaymentKind } from "@/lib/payment-meta";

export function PaymentBadge({
  kind,
  size = "md",
  className,
}: {
  kind?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const meta = PAY_META[paymentKind(kind)];
  const box = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-[11px]";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-extrabold leading-none tracking-tight", box, className)}
      style={{ backgroundColor: `${meta.color}1f`, color: meta.color, boxShadow: `inset 0 0 0 1px ${meta.color}33` }}
    >
      {meta.glyph}
    </span>
  );
}

/**
 * Icon-first replacement for the payment-method `<select>`. A native select
 * cannot render an icon, which is why the mobile-banking rows looked identical
 * before.
 */
export function MethodPicker({
  value,
  onChange,
  kinds = PAYMENT_KIND_ORDER,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  kinds?: PaymentKind[];
  className?: string;
}) {
  const current = paymentKind(value);
  return (
    <div role="radiogroup" aria-label="Payment method" className={cn("flex flex-wrap gap-1.5", className)}>
      {kinds.map((kind) => {
        const meta = PAY_META[kind];
        const active = current === kind;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(paymentEnum(kind))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-meta font-semibold transition-all",
              active
                ? "border-primary/50 bg-primary/10 text-foreground shadow-sm"
                : "border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}
          >
            <PaymentBadge kind={kind} size="xs" />
            {meta.short}
          </button>
        );
      })}
    </div>
  );
}
