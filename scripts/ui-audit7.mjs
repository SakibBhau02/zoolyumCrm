import fs from "node:fs";
import path from "node:path";
const R = "apps/web/src";
const W = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) W(p, o);
    else if (/\.tsx$/.test(e.name)) o.push(p);
  }
  return o;
};
const mod = (f) => {
  const r = f.split(path.sep).join("/");
  let m = r.match(/^apps\/web\/src\/app\/\(app\)\/([^/]+)\//);
  if (m) return m[1];
  m = r.match(/^apps\/web\/src\/components\/([^/]+)\//);
  if (m) return "comp/" + m[1];
  return "root";
};
const ICONS = ["Plus", "Trash2", "Pencil", "X", "Search", "Check", "ChevronRight", "Download", "Eye", "RefreshCw", "Filter", "ArrowRight"];
const res = {};
for (const f of W(R)) {
  const s = fs.readFileSync(f, "utf8");
  const m = mod(f);
  for (const icon of ICONS) {
    const re = new RegExp(`<${icon}\\s+className="([^"]*)"`, "g");
    for (const x of s.matchAll(re)) {
      const sz = (x[1].match(/size-[\d.]+/) || ["(no size)"])[0];
      res[icon] ||= {};
      res[icon][m] ||= {};
      res[icon][m][sz] = (res[icon][m][sz] || 0) + 1;
    }
  }
}
for (const [icon, mods] of Object.entries(res)) {
  console.log(`\n${icon}:`);
  for (const [m, sizes] of Object.entries(mods)) console.log(`  ${m.padEnd(18)}`, sizes);
}
