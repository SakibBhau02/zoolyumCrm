/**
 * Counts SQL statements per API request by bracketing each call with marker
 * statements and reading the Postgres container log.
 * Requires: log_statement=all on the target instance.
 */
import { execFileSync, spawnSync } from "node:child_process";

const API = "http://127.0.0.1:4200/api";
const DB = "zoolyum_perf";
const USER = "zoolyum";

const psql = (sql) =>
  execFileSync("docker", ["exec", "zoolyum-postgres", "psql", "-U", USER, "-d", DB, "-t", "-A", "-c", sql], {
    encoding: "utf8",
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const paths = [
  "/dashboard/overview",
  "/dashboard/home",
  "/accounts/clients",
  "/flow/projects",
  "/tasks",
  "/capital/invoices",
  "/capital/expenses",
  "/people/attendance?month=2026-11",
  "/calendar/feed?from=2026-11-01&to=2026-11-30",
  "/pulse/leads",
  "/notifications",
  "/search?q=perf",
  "/capital/overview",
];

const main = async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
  });
  const token = (await login.json()).accessToken;

  const results = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const tag = `bench_${i}_${Date.now()}`;
    // Cold cache: measure what the endpoint actually costs on a miss.
    execFileSync("docker", ["exec", "zoolyum-redis", "redis-cli", "-n", "1", "FLUSHDB"], { encoding: "utf8" });
    const t0 = new Date();
    psql(`select '${tag}_start'`);
    const apiStart = performance.now();
    const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    const ms = performance.now() - apiStart;
    psql(`select '${tag}_end'`);
    await sleep(1500);
    let log = "";
    try {
      const r2 = spawnSync("docker", ["logs", "--since", "600s", "zoolyum-postgres"], { encoding: "utf8", maxBuffer: 200 * 1024 * 1024 });
      log = String(r2.stdout ?? "") + String(r2.stderr ?? "");
    } catch {}
    const lines = log.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => l.includes(`${tag}_start`));
    const endIdx = lines.findIndex((l) => l.includes(`${tag}_end`));
    if (i === 0) console.log("DEBUG logLines", lines.length, "startIdx", startIdx, "endIdx", endIdx, "tag", tag);
    const between = startIdx >= 0 && endIdx > startIdx ? lines.slice(startIdx + 1, endIdx) : [];
    const stmts = between.filter((l) => /statement:|execute <unnamed>|execute [^:]*:/.test(l));
    // Pair each "duration: N ms" line with the statement that preceded it.
    let dbMs = 0;
    const durations = [];
    let lastSql = "";
    for (const l of between) {
      if (/LOG:\s+(statement|execute)\s/.test(l)) lastSql = l.slice(0, 300);
      const d = /duration:\s+([\d.]+)\s+ms/.exec(l);
      if (d) {
        const ms = Number(d[1]);
        dbMs += ms;
        durations.push({ ms, sql: lastSql });
      }
    }
    durations.sort((a, b) => b.ms - a.ms);
    results.push({
      path: p,
      status: r.status,
      ms: +ms.toFixed(1),
      dbMs: +dbMs.toFixed(1),
      kb: +(buf.length / 1024).toFixed(1),
      queries: stmts.length,
      slowest: durations.slice(0, 3).map((x) => `${x.ms.toFixed(1)}ms ${x.sql.replace(/\s+/g, " ").slice(0, 220)}`),
    });
    console.log(
      `${String(r.status)} ${String(stmts.length).padStart(4)}q ${dbMs.toFixed(0).padStart(5)}ms-db ${ms.toFixed(0).padStart(5)}ms ${(buf.length / 1024).toFixed(0).padStart(6)}KB  ${p}`
    );
  }
  console.log(JSON.stringify(results, null, 2));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
