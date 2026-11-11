import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/api/src");
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".controller.ts")) files.push(p);
  }
}
walk(root);

const routes = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const ctrl = /@Controller\(\s*["'`]([^"'`]*)["'`]/.exec(src);
  const base = ctrl ? ctrl[1] : "";
  const re = /@(Get|Post|Patch|Put|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const sub = m[2] ?? "";
    const full = "/" + [base, sub].filter(Boolean).join("/").replace(/\/+/g, "/");
    routes.push({ method, path: full, file: path.relative(root, f) });
  }
  // class-level @Controller with no args
  if (!ctrl) {
    const re2 = /@(Get|Post|Patch|Put|Delete)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g;
    let m2;
    while ((m2 = re2.exec(src))) routes.push({ method: m2[1].toUpperCase(), path: "/" + (m2[2] ?? ""), file: path.relative(root, f) });
  }
}

routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
fs.mkdirSync("qa", { recursive: true });
fs.writeFileSync("qa/routes.json", JSON.stringify(routes, null, 2));
const byMethod = routes.reduce((acc, r) => ((acc[r.method] = (acc[r.method] ?? 0) + 1), acc), {});
console.log("controllers:", files.length, "routes:", routes.length, byMethod);
const publicLike = routes.filter((r) => r.path.startsWith("/public") || r.path.startsWith("/iclock") || r.path.includes("webhook"));
console.log("public-ish:", publicLike.length);
