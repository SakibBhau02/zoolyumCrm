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
const global = {}, perMod = {}, perModuleAvg = {};
let total = 0;

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);
  perMod[mod] ||= {};
  perModuleAvg[mod] ||= { sum: 0, n: 0 };

  const importBlocks = src.match(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g) || [];
  const names = new Set();
  for (const b of importBlocks) {
    b.replace(/import\s*\{|\}\s*from.*/g, "").split(",").forEach((n) => {
      const name = n.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Z]/.test(name)) names.add(name);
    });
  }
  if (!names.size) continue;

  for (const name of names) {
    const re = new RegExp(`<${name}\\b([^>]*?)/?>`, "g");
    for (const m of src.matchAll(re)) {
      total++;
      const attrs = m[1];
      let key;
      const sizeAttr = attrs.match(/\bsize=(?:"(\d+)"|\{(\d+)\})/);
      const sizeCls = attrs.match(/\bsize-(\d+(?:\.\d+)?)\b/);
      const wCls = attrs.match(/\bw-(\d+(?:\.\d+)?)\b/);
      const hCls = attrs.match(/\bh-(\d+(?:\.\d+)?)\b/);
      if (sizeCls) key = `size-${sizeCls[1]}`;
      else if (wCls || hCls) key = `w/h ${wCls?.[1] ?? "?"}/${hCls?.[1] ?? "?"}`;
      else if (sizeAttr) key = `size=${sizeAttr[1] || sizeAttr[2]}`;
      else if (/className=/.test(attrs)) key = "className (no size)";
      else key = "DEFAULT (24px)";
      addTo(global, key);
      addTo(perMod[mod], key);
      const num = Number((key.match(/([\d.]+)$/) || [])[1]);
      if (num) { perModuleAvg[mod].sum += num; perModuleAvg[mod].n++; }
    }
  }
}
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log("total icon instances:", total);
console.log("\n=== GLOBAL icon sizing ===");
console.log(sortObj(global));
console.log("\n=== PER MODULE icon sizing ===");
for (const [m, v] of Object.entries(perMod)) if (Object.keys(v).length) console.log(m, sortObj(v));
console.log("\n=== PER MODULE icon size avg (size-N units) ===");
const avgs = Object.entries(perModuleAvg).filter(([, v]) => v.n).map(([m, v]) => [m, +(v.sum / v.n).toFixed(2), v.n]);
console.log(avgs.sort((a, b) => b[1] - a[1]));
