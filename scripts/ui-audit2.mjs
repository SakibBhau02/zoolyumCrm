import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/web/src";
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const moduleOf = (f) => {
  const rel = f.split(path.sep).join("/");
  let m = rel.match(/^apps\/web\/src\/app\/\(app\)\/([^/]+)\//);
  if (m) return m[1];
  m = rel.match(/^apps\/web\/src\/components\/([^/]+)\//);
  if (m) return `components/${m[1]}`;
  if (rel.startsWith("apps/web/src/components/")) return "components/_root";
  if (rel.startsWith("apps/web/src/lib/")) return "_lib";
  if (rel.startsWith("apps/web/src/app/")) return "_app-root";
  return "_other";
};
const addTo = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

const iconWH = {};          // w-4 h-4 combos on lucide icons
const perModuleIcon = {};
const fontHeading = {};
const fontMono = {};
const headingFontClass = {};
const numericFont = {};

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);
  perModuleIcon[mod] ||= {};

  // lucide icon className with w-/h- sizes (approximate: any element w-N h-N where N<=12)
  for (const m of src.matchAll(/\bw-(\d+(?:\.\d+)?)\b\s+h-(\d+(?:\.\d+)?)\b/g)) {
    const key = `${m[1]}/${m[2]}`;
    if (Number(m[1]) <= 12) { addTo(iconWH, key); addTo(perModuleIcon[mod], key); }
  }
  // w-N h-N possibly reversed order
  for (const m of src.matchAll(/\bh-(\d+(?:\.\d+)?)\b\s+w-(\d+(?:\.\d+)?)\b/g)) {
    const key = `${m[2]}/${m[1]}`;
    if (Number(m[1]) <= 12) { addTo(iconWH, key); addTo(perModuleIcon[mod], key); }
  }

  const fh = src.match(/font-heading/g) || [];
  if (fh.length) { addTo(fontHeading, mod, fh.length); }
  const fm = src.match(/font-mono/g) || [];
  if (fm.length) addTo(fontMono, mod, fm.length);
  const tabular = src.match(/tabular-nums/g) || [];
  if (tabular.length) addTo(numericFont, mod, tabular.length);
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log("=== icon w-N h-N (N<=12) ===");
console.log(sortObj(iconWH));
console.log("\n=== font-heading usage by module ===");
console.log(sortObj(fontHeading));
console.log("\n=== font-mono usage by module ===");
console.log(sortObj(fontMono));
console.log("\n=== tabular-nums by module ===");
console.log(sortObj(numericFont));
console.log("\n=== icons per module ===");
for (const [m, v] of Object.entries(perModuleIcon)) if (Object.keys(v).length) console.log(m, sortObj(v));
