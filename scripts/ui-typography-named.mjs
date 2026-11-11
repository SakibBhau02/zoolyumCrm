/**
 * Pass 2 of the typography normalisation: the handful of named Tailwind sizes
 * (text-xs / sm / lg / xl / 2xl / 5xl) that survived pass 1. Each one is mapped
 * by *role* rather than by numeric proximity, because the same class was used
 * for both KPI numbers and page titles.
 *
 *   node scripts/ui-typography-named.mjs [--write]
 */
import fs from "node:fs";

const WRITE = process.argv.includes("--write");
const S = "apps/web/src/";

const EDITS = [
  // ── KPI numbers currently 20px / 24px ────────────────────────────────
  ["app/(app)/accounts/page.tsx", "text-xl font-heading font-bold tabular-nums sm:text-2xl", "text-stat font-heading font-bold tabular-nums"],
  ["app/(app)/accounts/page.tsx", "text-lg font-black tabular-nums", "text-title font-black tabular-nums"],
  ["app/(app)/capital/_components/invoice-detail-modal.tsx", "text-xl font-bold tabular-nums", "text-stat font-bold tabular-nums"],
  ["app/(app)/control/scoring/page.tsx", "text-xl font-heading font-semibold tabular-nums", "text-stat font-heading font-semibold tabular-nums"],
  ["app/(app)/control/scoring/page.tsx", "mt-3 text-5xl font-heading font-semibold tabular-nums", "mt-3 text-display font-heading font-semibold tabular-nums"],
  ["app/(app)/control/scoring/page.tsx", "text-lg font-heading font-semibold tabular-nums", "text-title font-heading font-semibold tabular-nums"],
  ["app/(app)/insight/page.tsx", "text-lg font-heading font-bold tabular-nums", "text-stat font-heading font-bold tabular-nums"],
  ["components/flow/flow-workspace.tsx", "text-lg font-heading font-semibold tabular-nums", "text-stat font-heading font-semibold tabular-nums"],

  // ── Titles ───────────────────────────────────────────────────────────
  ["components/shared.tsx", "text-2xl font-heading font-semibold tracking-tight", "text-page font-heading font-semibold tracking-tight"],
  ["components/shared.tsx", "text-2xl font-heading font-bold tabular-nums tracking-tight", "text-stat font-heading font-bold tabular-nums tracking-tight"],
  ["app/login/page.tsx", "font-heading text-2xl font-bold", "font-heading text-page font-bold"],
  ["components/brand-logo.tsx", '"text-lg"', '"text-title"'],

  // ── Secondary / body ─────────────────────────────────────────────────
  ["components/shared.tsx", "text-sm font-medium text-muted-foreground", "text-body-lg font-medium text-muted-foreground"],
  ["components/shared.tsx", "text-xs text-muted-foreground/70", "text-meta text-muted-foreground/70"],
  ["components/charts.tsx", "text-sm font-heading font-bold tabular-nums", "text-body font-heading font-bold tabular-nums"],
  ["app/(app)/capital/_components/tab-nav.tsx", "text-xs font-semibold", "text-meta font-semibold"],
];

const counts = new Map();
for (const [file, from, to] of EDITS) {
  const p = S + file;
  let src = fs.readFileSync(p, "utf8");
  const before = src.split(from).length - 1;
  if (!before) {
    console.log(`MISS  ${file}: ${from}`);
    continue;
  }
  src = src.split(from).join(to);
  counts.set(file, (counts.get(file) || 0) + before);
  if (WRITE) fs.writeFileSync(p, src);
}
console.log(`${WRITE ? "APPLIED" : "DRY RUN"}`);
for (const [f, n] of counts) console.log(`  ${n}  ${f}`);
