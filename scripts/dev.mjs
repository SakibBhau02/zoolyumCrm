#!/usr/bin/env node
/**
 * dev.mjs — start API + web together, but only after the database is reachable.
 *
 * Why: Prisma runs `$connect()` in `onModuleInit`, so if Postgres is not up when
 * the API boots, Nest throws `PrismaClientInitializationError: P1001` and the
 * process dies. Every request from the web app then fails with "Failed to fetch".
 * Waiting for the TCP port first makes `npm run dev` safe to run cold.
 *
 * Usage:
 *   node scripts/dev.mjs             # wait for DB, then run api + web
 *   node scripts/dev.mjs --check     # only wait for DB, then exit (CI/preflight)
 *   node scripts/dev.mjs --check --timeout 10
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "apps", "api");
const webDir = path.join(root, "apps", "web");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const timeoutArg = args.indexOf("--timeout");
const TIMEOUT_MS = (timeoutArg >= 0 ? Number(args[timeoutArg + 1]) : 120) * 1000;

// ── env loading (root .env, then apps/api/.env, then process.env) ───────────
function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...parseEnvFile(path.join(root, ".env")),
  ...parseEnvFile(path.join(apiDir, ".env")),
  ...process.env,
};

const targets = [];
const dbUrl = env.DATABASE_URL;
if (dbUrl) {
  try {
    const u = new URL(dbUrl);
    targets.push({
      label: "postgres",
      host: u.hostname || "localhost",
      port: Number(u.port || 5432),
      hint: "docker compose up -d postgres",
    });
  } catch {
    console.warn(`[dev] Could not parse DATABASE_URL — skipping DB wait.`);
  }
} else {
  console.warn("[dev] DATABASE_URL not set — skipping DB wait.");
}

const redisUrl = env.REDIS_URL;
if (redisUrl) {
  try {
    const u = new URL(redisUrl);
    targets.push({
      label: "redis",
      host: u.hostname || "localhost",
      port: Number(u.port || 6379),
      optional: true, // API falls back to in-memory cache
      hint: "docker compose up -d redis",
    });
  } catch {
    /* ignore */
  }
}

// ── TCP probe ──────────────────────────────────────────────────────────────
function probe({ host, port }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function waitFor({ label, host, port, optional, hint }) {
  const started = Date.now();
  let dots = 0;
  process.stdout.write(`[dev] waiting for ${label} at ${host}:${port}`);

  while (Date.now() - started < TIMEOUT_MS) {
    if (await probe({ host, port })) {
      process.stdout.write(` ready (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
      return true;
    }
    process.stdout.write(".");
    if (++dots % 20 === 0) process.stdout.write("\n[dev] still waiting ");
    await new Promise((r) => setTimeout(r, 1000));
  }

  process.stdout.write("\n");
  const msg = `[dev] ${label} is not reachable at ${host}:${port} after ${TIMEOUT_MS / 1000}s.`;
  if (optional) {
    console.warn(`${msg} Continuing anyway (fallback in use). Start it with: ${hint}`);
    return true;
  }
  console.error(`\n${msg}\n       Start it with: ${hint}\n       Then run: npm run dev`);
  return false;
}

// ── main ───────────────────────────────────────────────────────────────────
const results = [];
for (const t of targets) results.push(await waitFor(t));

if (checkOnly) {
  const failed = results.includes(false);
  process.exit(failed ? 1 : 0);
}

if (results.includes(false)) process.exit(1);

// Warn early instead of letting Nest/Next fail with EADDRINUSE later.
const appPorts = [
  { label: "API", port: Number(env.PORT ?? 4000) },
  { label: "web", port: Number(env.WEB_PORT ?? 3000) },
];
for (const { label, port } of appPorts) {
  if (await probe({ host: "127.0.0.1", port })) {
    console.warn(
      `[dev] port ${port} (${label}) is already in use — a previous dev server may still be running.`
    );
  }
}

/**
 * Spawn a long-running child with a labelled prefix, and tidy up on exit.
 *
 * `extraEnv` is passed only to the process that needs it: apps/api/.env holds
 * `PORT=4000`, and leaking that into Next.js makes `next dev` try to bind 4000
 * too (it inherited PORT and refused to start alongside the API).
 */
function run(label, cwd, npmArgs, extraEnv = {}) {
  const child = spawn("npm", npmArgs, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv, FORCE_COLOR: "1" },
  });

  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") out.write(`${label} ${line}\n`);
    });
    stream.on("end", () => {
      if (buffer.trim() !== "") out.write(`${label} ${buffer}\n`);
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    process.stdout.write(`${label} exited with code ${code ?? 0}\n`);
    exited += 1;
    // Don't take the other server down with this one. A single crash (port
    // already in use, a transient compile error) used to kill the sibling too,
    // which made both look broken. Only stop when *everything* has exited.
    if (exited >= 2) shutdown(code ?? 0);
  });

  return child;
}

let exited = 0;

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-c.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

children.push(run("[api]", apiDir, ["run", "start:dev"], env));
children.push(
  run("[web]", webDir, ["run", "dev"], {
    // Next reads PORT too — pin it explicitly so the API's PORT never leaks in.
    PORT: String(env.WEB_PORT ?? 3000),
  })
);
