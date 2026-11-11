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

const svgInline = {}, strokeW = {}, emoji = {}, iconLib = {};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);

  const svgs = (src.match(/<svg\b/g) || []).length;
  if (svgs) addTo(svgInline, mod, svgs);

  for (const m of src.matchAll(/strokeWidth=\{?["']?([\d.]+)/g)) addTo(strokeW, `${m[1]}`);

  const em = src.match(EMOJI_RE) || [];
  if (em.length) addTo(emoji, mod, em.length);

  if (/lucide-react/.test(src)) addTo(iconLib, "lucide-react", 1);
  if (/react-icons/.test(src)) addTo(iconLib, "react-icons", 1);
  if (/@heroicons/.test(src)) addTo(iconLib, "@heroicons", 1);
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log("inline <svg> per module (raw, incl. defaults):", sortObj(svgInline));
console.log("strokeWidth values:", sortObj(strokeW));
console.log("emoji per module:", sortObj(emoji));
console.log("icon libs:", iconLib);
