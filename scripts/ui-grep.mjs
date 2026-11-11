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
const target = process.argv.slice(2);
for (const f of W(R)) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    for (const t of target) {
      if (l.includes(t)) console.log(`${f.replace(/^apps.web.src./, "")}:${i + 1}  ${l.trim().slice(0, 130)}`);
    }
  });
}
