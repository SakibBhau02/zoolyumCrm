/**
 * Concurrency test: N virtual users looping over the heaviest pages while the
 * cache expires periodically (worst realistic case), on one API process.
 */
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:4200/api";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const DURATION_S = Number(process.env.DURATION ?? 30);
const PATHS = [
  "/dashboard/overview",
  "/accounts/clients",
  "/flow/projects",
  "/tasks",
  "/capital/invoices",
  "/capital/overview",
];

const login = async () => {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
  });
  return (await r.json()).accessToken;
};

const main = async () => {
  const token = await login();
  const lat = [];
  const errors = [];
  let bytes = 0;
  let stop = false;
  const deadline = Date.now() + DURATION_S * 1000;

  // Expire cached aggregates every 5s so users keep hitting cold computes.
  const flush = setInterval(() => {
    try {
      execFileSync("docker", ["exec", "zoolyum-redis", "redis-cli", "-n", "1", "FLUSHDB"], { stdio: "ignore" });
    } catch {}
  }, 5000);

  const worker = async (id) => {
    let i = id;
    while (!stop) {
      const p = PATHS[i % PATHS.length];
      i++;
      const t0 = performance.now();
      try {
        const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
        const b = Buffer.from(await r.arrayBuffer());
        bytes += b.length;
        lat.push({ ms: performance.now() - t0, p, status: r.status });
        if (r.status >= 400) errors.push(`${r.status} ${p}`);
      } catch (e) {
        errors.push(`${e.message} ${p}`);
        lat.push({ ms: performance.now() - t0, p, status: 0 });
      }
      if (Date.now() > deadline) stop = true;
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)));
  clearInterval(flush);

  const s = lat.map((x) => x.ms).sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  console.log(
    JSON.stringify(
      {
        concurrency: CONCURRENCY,
        durationSec: DURATION_S,
        requests: lat.length,
        rps: +(lat.length / DURATION_S).toFixed(1),
        errorRate: +(errors.length / Math.max(1, lat.length)).toFixed(4),
        mbTransferred: +(bytes / 1024 / 1024).toFixed(1),
        p50: +q(50).toFixed(0),
        p95: +q(95).toFixed(0),
        p99: +q(99).toFixed(0),
        max: +s[s.length - 1].toFixed(0),
        byPath: PATHS.map((p) => {
          const a = lat.filter((x) => x.p === p).map((x) => x.ms).sort((x, y) => x - y);
          const qq = (n) => (a.length ? a[Math.min(a.length - 1, Math.ceil((n / 100) * a.length) - 1)] : 0);
          return { path: p, n: a.length, p50: +qq(50).toFixed(0), p95: +qq(95).toFixed(0), max: +a[a.length - 1].toFixed(0) };
        }),
      },
      null,
      2
    )
  );
  if (errors.length) console.log("errors sample:", errors.slice(0, 5));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
