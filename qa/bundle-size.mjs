import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const routes = ["pulse", "dashboard", "capital", "flow", "login", "tasks", "accounts"];
for (const r of routes) {
  const file = `apps/web/.next/server/app/${r}.html`;
  if (!fs.existsSync(file)) {
    console.log(r, "no html");
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  const urls = [...new Set([...html.matchAll(/\/_next\/static\/(?:chunks|css)\/[^"']+?\.(?:js|css)/g)].map((m) => m[0]))];
  let raw = 0;
  let gz = 0;
  let missing = 0;
  for (const u of urls) {
    const p = path.join("apps/web/.next/static", u.replace("/_next/static/", ""));
    try {
      const b = fs.readFileSync(p);
      raw += b.length;
      gz += zlib.gzipSync(b, { level: 9 }).length;
    } catch {
      missing++;
    }
  }
  console.log(`${r.padEnd(12)} chunks=${String(urls.length).padStart(2)} raw=${String(Math.round(raw / 1024)).padStart(5)}KB gzip=${String(Math.round(gz / 1024)).padStart(4)}KB missing=${missing}`);
}
