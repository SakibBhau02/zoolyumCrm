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

const textScale = {};
const rawPx = {};
const iconSizes = {};
const fontClass = {};
const perModule = {};

const addTo = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };

for (const f of files) {
  if (f.endsWith("globals.css")) continue;
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);
  perModule[mod] ||= { files: 0, text: {}, raw: {}, icons: {} };
  perModule[mod].files++;

  const tokens = src.match(/text-(?:\[[^\]]+\]|xs|sm|base|lg|xl|[2-9]xl)/g) || [];
  for (const t of tokens) {
    addTo(textScale, t);
    addTo(perModule[mod].text, t);
    if (t.startsWith("text-[")) {
      addTo(rawPx, t);
      addTo(perModule[mod].raw, t);
    }
  }

  // lucide icon size props
  const icons = src.match(/size=\{?["']?\d+["']?\}?/g) || [];
  for (const i of icons) {
    const n = i.match(/\d+/)[0];
    addTo(iconSizes, n);
    addTo(perModule[mod].icons, n);
  }
  const wh = src.match(/\b(?:className=["'{`]|")([^"'`]*\b[wh]-(\d+(?:\.\d+)?)\b[^"'`]*)/g) || [];

  const fcl = src.match(/font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/g) || [];
  for (const x of fcl) addTo(fontClass, x);
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

console.log("=== GLOBAL text-* scale usage ===");
console.log(sortObj(textScale));
console.log("\n=== raw px text sizes ===");
console.log(sortObj(rawPx));
console.log("\n=== lucide size={} ===");
console.log(sortObj(iconSizes));
console.log("\n=== font weights ===");
console.log(sortObj(fontClass));

console.log("\n=== PER MODULE (text scale) ===");
for (const [m, v] of Object.entries(perModule).sort((a, b) => b[1].files - a[1].files)) {
  if (v.files < 1) continue;
  const total = Object.values(v.text).reduce((a, b) => a + b, 0);
  console.log(`\n-- ${m} (files=${v.files}, textTokens=${total})`);
  console.log("   scale:", sortObj(v.text));
  if (Object.keys(v.raw).length) console.log("   raw  :", sortObj(v.raw));
  if (Object.keys(v.icons).length) console.log("   icons:", sortObj(v.icons));
}
