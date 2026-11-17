"use client";

import { motion } from "framer-motion";
import { cn } from "./shared";

const EASE = [0.22, 1, 0.36, 1] as const;

export function TableShell({ children, footer, noScroll, hideScrollbar, scrollY }: { children: React.ReactNode; footer?: React.ReactNode; noScroll?: boolean; hideScrollbar?: boolean; scrollY?: boolean }) {
  return (
    <div className="card-lift overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div
        className={
          noScroll
            ? "overflow-hidden"
            : hideScrollbar
              ? "relative overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              : "relative overflow-x-auto overscroll-x-contain"
        }
        // Optional vertically-scrolling body so the sticky header has something
        // to pin against; without it the page scrolls and the header slips away.
        style={scrollY && !noScroll ? { maxHeight: "min(70vh, 640px)", overflowY: "auto" } : undefined}
      >{children}</div>
      {footer && (
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    // Sticky needs a scrolling ancestor: give TableShell `scrollY` and the
    // header pins while the rows move (audit UX-10 — at 700px scroll the header
    // used to sit at -383px and the columns lost their meaning).
    <thead className="sticky top-0 z-10 [&_tr]:bg-card [&_tr]:backdrop-blur">
      <tr className="border-b border-border/60 bg-muted/40">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-3 py-2.5 text-left text-micro font-semibold uppercase tracking-wider text-muted-foreground first:pl-3 sm:px-5 sm:first:pl-5",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  index = 0,
  onClick,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: EASE }}
      onClick={onClick}
      // A clickable <tr> stays keyboard operable, but it must NOT claim
      // role="button": the row contains real buttons, links and selects, and a
      // button wrapping interactive children is invalid (axe nested-interactive,
      // 50 nodes across Accounts/Flow/Tasks/Capital — audit UX-05).
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              // Inner controls own their keys; only the row itself activates.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "border-b border-border/40 transition-colors last:border-0 hover:bg-muted/60",
        onClick && "cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        className
      )}
    >
      {children}
    </motion.tr>
  );
}

export function Td({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <td onClick={onClick} className={cn("whitespace-nowrap px-3 py-3 text-body first:pl-3 sm:px-5 sm:first:pl-5", className)}>
      {children}
    </td>
  );
}

export function Btn({
  children,
  onClick,
  variant = "ghost",
  className,
  type = "button",
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  [key: string]: any;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-body font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        variant === "outline" &&
          "border border-border bg-card text-foreground hover:border-primary/30 hover:bg-muted/50",
        className
      )}
    >
      {children}
    </button>
  );
}
