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

const global = {};
const perMod = {};
let iconsFound = 0;
const missing = {};

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);
  perMod[mod] ||= {};

  // collect lucide imports
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
    const re = new RegExp(`<${name}\\b([^>]*)>`, "g");
    for (const m of src.matchAll(re)) {
      iconsFound++;
      const attrs = m[1];
      const sizeAttr = attrs.match(/\bsize=(?:"(\d+)"|\{(\d+)\})/);
      const cls = attrs.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
      let key = null;
      if (sizeAttr) key = `size=${sizeAttr[1] || sizeAttr[2]}`;
      else if (cls) {
        const c = cls[1] ?? cls[2] ?? "";
        const wh = c.match(/\bw-(\d+(?:\.\d+)?)\b[\s\S]*?\bh-(\d+(?:\.\d+)?)\b/) ||
                   c.match(/\bh-(\d+(?:\.\d+)?)\b[\s\S]*?\bw-(\d+(?:\.\d+)?)\b/);
        if (wh) key = `w-h ${wh[1]}/${wh[2]}`;
        else key = "className (no size class)";
      } else key = "DEFAULT (24px)";
      addTo(global, key);
      addTo(perMod[mod], key);
      if (key.startsWith("DEFAULT") || key.includes("no size")) addTo(missing, `${mod} :: ${name}`);
    }
  }
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log("total icon instances:", iconsFound);
console.log("\n=== GLOBAL icon sizing ===");
console.log(sortObj(global));
console.log("\n=== PER MODULE icon sizing ===");
for (const [m, v] of Object.entries(perMod)) if (Object.keys(v).length) console.log(m, sortObj(v));
console.log("\n=== icons with NO explicit size (top 60) ===");
console.log(sortObj(missing));
