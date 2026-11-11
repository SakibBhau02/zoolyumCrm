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

const bucket = (px) => (px <= 10.5 ? "tiny(<=10.5)" : px <= 11.75 ? "small(11-11.5)" : px <= 12.5 ? "body(12-12.5)" : px <= 14 ? "md(13-14)" : "lg(15+)");
const perMod = {};
const inlineFont = {};
const tailwindNamed = {};
let total = 0;

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const mod = moduleOf(f);
  perMod[mod] ||= { buckets: {}, tokens: 0, vals: {} };

  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    const px = Number(m[1]);
    total++;
    perMod[mod].tokens++;
    addTo(perMod[mod].buckets, bucket(px));
    addTo(perMod[mod].vals, m[0]);
  }
  for (const m of src.matchAll(/\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/g)) addTo(tailwindNamed, m[0]);
  for (const m of src.matchAll(/fontSize:\s*["']?(\d+(?:\.\d+)?)/g)) addTo(inlineFont, `${m[1]}px`);
}

const rows = Object.entries(perMod)
  .filter(([, v]) => v.tokens > 0)
  .map(([m, v]) => {
    const pct = (b) => Math.round(((v.buckets[b] || 0) / v.tokens) * 100);
    const sorted = Object.entries(v.vals).sort((a, b) => b[1] - a[1]);
    return {
      module: m,
      tokens: v.tokens,
      tiny: pct("tiny(<=10.5)"),
      small: pct("small(11-11.5)"),
      body: pct("body(12-12.5)"),
      md: pct("md(13-14)"),
      lg: pct("lg(15+)"),
      top: sorted.slice(0, 3).map(([k, n]) => `${k}=${n}`).join(" "),
    };
  })
  .sort((a, b) => b.tokens - a.tokens);

console.log("total raw px text tokens:", total);
console.log("\nmodule | tokens | tiny% | small% | body% | md% | lg% | top3");
console.table(rows);
console.log("\ninline style fontSize:", inlineFont);
console.log("named tailwind text classes:", tailwindNamed);
