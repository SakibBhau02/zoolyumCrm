/**
 * Icon size normalisation.
 *
 * lucide-react is the only icon library, but sizes drifted: 6 different values
 * (2.5 / 3 / 3.5 / 4 / 5 / 7) and the same icon rendered at a different size in
 * every module — `Trash2` was 3px in Tasks and 4px in Capital. Everything is
 * collapsed onto four steps:
 *
 *   3    badge / status dot / micro indicator
 *   3.5  inline action — row buttons, chips, field affordances (the default)
 *   4    tile, nav, modal close, primary control
 *   5    empty state / hero
 *
 * The tier is decided from the icon's surroundings first (a 40px icon tile gets
 * a 16px glyph, a 24px row button gets 14px) and from the icon's own dominant
 * size second, so one icon never changes size between modules.
 *
 *   node scripts/ui-icons.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/web/src";
const WRITE = process.argv.includes("--write");

const SKIP = [
  "app/portal-client/",
  "app/portal-login/",
  "app/p/",
  "app/(app)/portal/",
  "capital/_components/invoice-print-view.tsx",
  "components/portal-charts.tsx",
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const norm = (p) => p.split(path.sep).join("/");
const ALLOWED = [3, 3.5, 4, 5];
const round = (n) => (n <= 2.75 ? 3 : n <= 3.5 ? 3.5 : n === 4 ? 4 : 5);

const files = walk(ROOT).filter((f) => !SKIP.some((s) => norm(f).includes(s)));

/* ── Parse every lucide usage ─────────────────────────────────────────────── */
const ICON_TAG = /<([A-Z][A-Za-z0-9]*)\b([^<>]*?)\/?>/g;
const instances = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const importBlocks = src.match(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g) || [];
  const names = new Set();
  for (const b of importBlocks) {
    b.replace(/import\s*\{|\}\s*from.*/g, "").split(",").forEach((n) => {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Z]/.test(name)) names.add(name);
    });
  }
  if (!names.size) continue;

  for (const m of src.matchAll(ICON_TAG)) {
    const [, name, attrs] = m;
    if (!names.has(name)) continue;
    const sizeCls = attrs.match(/\bsize-(\d+(?:\.\d+)?)\b/);
    instances.push({
      file,
      icon: name,
      current: sizeCls ? Number(sizeCls[1]) : null,
      start: m.index,
      end: m.index + m[0].length,
      isProp:
        /[A-Za-z]=\{$/.test(src.slice(Math.max(0, m.index - 24), m.index)) ||
        /[A-Za-z]:\s*$/.test(src.slice(Math.max(0, m.index - 24), m.index)),
      wrapper: nearestWrapperSize(src, m.index),
    });
  }
}

/** Size class of the closest enclosing element declared before `at`. */
function nearestWrapperSize(src, at) {
  const slice = src.slice(Math.max(0, at - 400), at);
  const re = /<(div|span|button|a|li|td|p|label|section)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
  let last = null;
  for (const m of slice.matchAll(re)) last = m[2] ?? m[3] ?? "";
  if (!last) return null;
  const s = last.match(/\b(?:size|h|w)-(\d+(?:\.\d+)?)\b/);
  return s ? Number(s[1]) : null;
}

/* ── Dominant size per icon, used when the surroundings say nothing ───────── */
const tally = new Map();
for (const i of instances) {
  const r = i.current == null ? null : round(i.current);
  if (r == null) continue;
  if (!tally.has(i.icon)) tally.set(i.icon, new Map());
  const m = tally.get(i.icon);
  m.set(r, (m.get(r) || 0) + 1);
}
const dominant = new Map();
for (const [icon, m] of tally) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const [size, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  dominant.set(icon, total >= 3 && n / total >= 0.6 ? size : null);
}

function targetFor(i) {
  if (i.wrapper != null && i.wrapper >= 8) return 4;
  if (i.isProp) return 4;
  if (i.wrapper != null && i.wrapper >= 6) return 3.5;
  const d = dominant.get(i.icon);
  if (d) return d;
  return i.current == null ? 4 : round(i.current);
}

/* ── Rewrite ──────────────────────────────────────────────────────────────── */
const perFile = new Map();
let changed = 0;
const byIcon = new Map();

for (const i of instances) {
  const target = targetFor(i);
  if (!ALLOWED.includes(target) || i.current === target) continue;
  if (!perFile.has(i.file)) perFile.set(i.file, []);
  perFile.get(i.file).push({ ...i, target });
  changed++;
  const k = `${i.icon}: ${i.current ?? "no size"} → ${target}${i.wrapper != null ? ` (wrapper ${i.wrapper})` : ""}`;
  byIcon.set(k, (byIcon.get(k) || 0) + 1);
}

const unresolved = instances.filter((i) => i.current == null && targetFor(i) == null).length;

for (const [file, edits] of perFile) {
  let src = fs.readFileSync(file, "utf8");
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    const tag = src.slice(e.start, e.end);
    let next;
    if (e.current == null) {
      next = /className="/.test(tag)
        ? tag.replace(/className="/, `className="size-${e.target} `)
        : tag.replace(/^<([A-Za-z0-9]+)/, `<$1 className="size-${e.target}"`);
    } else {
      next = tag.replace(new RegExp(`\\bsize-${String(e.current).replace(".", "\\.")}\\b`), `size-${e.target}`);
    }
    if (next === tag) continue;
    src = src.slice(0, e.start) + next + src.slice(e.end);
  }
  if (WRITE) fs.writeFileSync(file, src);
}

console.log(`${WRITE ? "APPLIED" : "DRY RUN"} — ${changed} icon instances across ${perFile.size} files`);
console.log(`icons left without an explicit size: ${unresolved}`);
console.log("\nTop rewrites:");
for (const [k, v] of [...byIcon].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(4)}  ${k}`);
