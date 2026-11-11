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
const RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
for (const f of W(R)) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    const m = l.match(RE);
    if (m) console.log(`${f.replace(/^apps.web.src./, "")}:${i + 1}  [${m[0]} U+${m[0].codePointAt(0).toString(16)}]  ${l.trim().slice(0, 120)}`);
  });
}
