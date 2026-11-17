#!/usr/bin/env node
/**
 * setup.mjs — first-run setup for a fresh clone.
 *
 * Does everything a new machine needs before `npm run dev`:
 *   1. apps/api/.env   — created from .env.example with generated secrets
 *   2. .env (root)     — the variables docker compose interpolates
 *   3. Postgres/Redis  — docker compose up -d postgres redis
 *   4. wait            — TCP probe until the database accepts connections
 *   5. prisma generate + migrate deploy (never `migrate dev` on a clean box)
 *   6. demo seed       — only when the database has no users yet (the seed
 *                        truncates demo tables, so it must never run over real data)
 *
 * Usage:
 *   npm run setup                # full first-run setup
 *   npm run setup -- --no-docker # DB already running somewhere else
 *   npm run setup -- --no-seed   # skip demo data
 *   npm run setup -- --seed      # force the demo seed even if users exist
 *
 * Safe to re-run: existing env files are never overwritten and data is never
 * dropped.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "apps", "api");
const apiEnvPath = path.join(apiDir, ".env");
const apiEnvExamplePath = path.join(apiDir, ".env.example");
const rootEnvPath = path.join(root, ".env");
const rootEnvExamplePath = path.join(root, ".env.example");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const NO_DOCKER = flag("no-docker");
const NO_SEED = flag("no-seed");
const FORCE_SEED = flag("seed");

const DB_WAIT_TIMEOUT_MS = 120_000;

// ── helpers ────────────────────────────────────────────────────────────────
const log = (msg) => console.log(`[setup] ${msg}`);
const warn = (msg) => console.warn(`[setup] ${msg}`);

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

const secret = (bytes = 36) => randomBytes(bytes).toString("base64url");
const isPlaceholder = (value) => !value || /replace-with|change-me|example/i.test(value);

function run(label, cmd, cmdArgs, cwd = root, extraEnv = {}) {
  log(`${label} …`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`\n[setup] ${label} failed (exit ${result.status ?? "null"}).`);
    process.exit(result.status ?? 1);
  }
}

function runCapture(cmd, cmdArgs, cwd = root, extraEnv = {}) {
  return spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
}

function probe({ host, port }) {  return new Promise((resolve) => {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dockerIsUp() {
  return runCapture("docker", ["info", "--format", "{{.ServerVersion}}"]).status === 0;
}

/**
 * Docker Desktop on Windows does not auto-start the engine on demand, so a
 * fresh machine (or a reboot) fails here with a pipe error that says nothing
 * useful. Launch the app and wait for the engine instead of telling the user
 * to do it.
 */
async function ensureDocker() {
  if (dockerIsUp()) return;

  const desktop =
    process.env.DOCKER_DESKTOP_PATH ||
    (process.platform === "win32"
      ? "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"
      : "/Applications/Docker.app");

  const canLaunch = process.platform === "darwin" ? existsSync(desktop) : existsSync(desktop);
  if (!canLaunch) {
    console.error("[setup] Docker is installed but not running, and Docker Desktop could not be found.");
    console.error("        Start Docker Desktop manually and re-run `npm run setup`.");
    console.error("        (No Docker at all? Install PostgreSQL 16 and point DATABASE_URL at it.)");
    process.exit(1);
  }

  log("Docker is not running — starting Docker Desktop (can take up to a minute)…");
  const child =
    process.platform === "darwin"
      ? spawn("open", ["-a", "Docker"], { detached: true, stdio: "ignore" })
      : spawn(desktop, [], { detached: true, stdio: "ignore" });
  child.unref();

  const started = Date.now();
  const limitMs = 180_000;
  while (Date.now() - started < limitMs) {
    await sleep(5000);
    if (dockerIsUp()) {
      log(`Docker engine ready (${((Date.now() - started) / 1000).toFixed(0)}s).`);
      return;
    }
  }

  console.error(`\n[setup] Docker engine did not start within ${limitMs / 1000}s.`);
  console.error("        Open Docker Desktop, wait for “Engine running”, then re-run `npm run setup`.");
  process.exit(1);
}

async function applyMigrations() {
  const attempts = 12;
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    last = runCapture("npx", ["prisma", "migrate", "deploy"], apiDir);
    if (last.status === 0) {
      process.stdout.write(last.stdout ?? "");
      log("database migrations are up to date.");
      return;
    }
    if (i < attempts) {
      log(`database not ready yet (attempt ${i}/${attempts}) — retrying in 5s …`);
      await sleep(5000);
    }
  }
  process.stdout.write(last?.stdout ?? "");
  process.stderr.write(last?.stderr ?? "");
  console.error("\n[setup] prisma migrate deploy failed — see the error above.");
  process.exit(1);
}

async function waitForDb(target) {
  const started = Date.now();
  process.stdout.write(`[setup] waiting for ${target.label} at ${target.host}:${target.port}`);
  while (Date.now() - started < DB_WAIT_TIMEOUT_MS) {
    if (await probe(target)) {
      process.stdout.write(` ready (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
      return true;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("\n");
  return false;
}

// ── 1. apps/api/.env ───────────────────────────────────────────────────────
if (existsSync(apiEnvPath)) {
  log("apps/api/.env already exists — leaving it untouched.");
} else {
  if (!existsSync(apiEnvExamplePath)) {
    console.error("[setup] apps/api/.env.example is missing — cannot create apps/api/.env.");
    process.exit(1);
  }
  let contents = readFileSync(apiEnvExamplePath, "utf8");
  contents = contents
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret()}"`)
    .replace(/^FILE_URL_SECRET=.*$/m, `FILE_URL_SECRET="${secret()}"`);
  writeFileSync(apiEnvPath, contents, "utf8");
  log("created apps/api/.env with freshly generated JWT_SECRET / FILE_URL_SECRET.");
}

const apiEnv = parseEnvFile(apiEnvPath);

// ── 2. root .env (docker compose interpolation) ────────────────────────────
const rootEnv = parseEnvFile(rootEnvPath);
if (existsSync(rootEnvPath)) {
  log(".env (root) already exists — leaving it untouched.");
} else {
  let contents = existsSync(rootEnvExamplePath)
    ? readFileSync(rootEnvExamplePath, "utf8")
    : "JWT_SECRET=\nNEXT_PUBLIC_API_URL=http://localhost:4000/api\n";
  const jwt = isPlaceholder(apiEnv.JWT_SECRET) ? secret() : apiEnv.JWT_SECRET;
  contents = contents.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwt}`);
  writeFileSync(rootEnvPath, contents, "utf8");
  log("created .env (root) for docker compose.");
}

// ── 3. database + cache containers ─────────────────────────────────────────
if (NO_DOCKER) {
  log("--no-docker given — skipping container start.");
} else {
  await ensureDocker();
  // --wait blocks until the healthchecks report healthy; the TCP port is open
  // seconds before Postgres actually accepts queries.
  run("starting Postgres + Redis (docker compose)", "docker", [
    "compose",
    "up",
    "-d",
    "--wait",
    "postgres",
    "redis",
  ]);
}

// ── 4. wait for the database ───────────────────────────────────────────────
const dbUrl = apiEnv.DATABASE_URL;
if (!dbUrl) {
  console.error("[setup] DATABASE_URL is missing from apps/api/.env.");
  process.exit(1);
}
let dbTarget;
try {
  const parsed = new URL(dbUrl);
  dbTarget = {
    label: "postgres",
    host: parsed.hostname || "localhost",
    port: Number(parsed.port || 5432),
  };
} catch {
  console.error("[setup] DATABASE_URL in apps/api/.env is not a valid URL.");
  process.exit(1);
}

if (!(await waitForDb(dbTarget))) {
  console.error(
    `\n[setup] Postgres is still unreachable at ${dbTarget.host}:${dbTarget.port} ` +
      `after ${DB_WAIT_TIMEOUT_MS / 1000}s.`
  );
  console.error("        Check `docker compose ps` and the container logs, then re-run.");
  process.exit(1);
}

// ── 5. prisma client + migrations ──────────────────────────────────────────
// `prisma generate` rewrites the query-engine DLL, which Windows refuses while
// a dev server still has it loaded (EPERM). On a fresh clone that cannot
// happen; if it does, keep going with the client that is already on disk.
const generated = runCapture("npm", ["run", "prisma:generate"], apiDir);
if (generated.status !== 0) {
  const clientOnDisk = existsSync(path.join(root, "node_modules", ".prisma", "client", "index.js"));
  if (!clientOnDisk) {
    console.error("[setup] prisma generate failed and no Prisma client exists yet — cannot continue.");
    process.exit(1);
  }
  warn("prisma generate failed (a running dev server usually locks the engine DLL).");
  warn("continuing with the existing client — stop `npm run dev` and re-run if the schema changed.");
} else {
  log("Prisma client generated.");
}
await applyMigrations();
// ── 6. demo data (first run only) ──────────────────────────────────────────
let userCount = -1;
// Written to a temp file instead of `node -e "<script>"`: on Windows the
// spawned shell strips the quotes inside the script and it fails to parse.
const probePath = path.join(tmpdir(), `zoolyum-user-probe-${process.pid}.cjs`);
// Require the client by absolute path: the probe lives in %TEMP%, so a bare
// require("@prisma/client") would resolve from there and fail.
const clientPath = path.join(root, "node_modules", "@prisma", "client");
writeFileSync(
  probePath,
  `const { PrismaClient } = require(${JSON.stringify(clientPath)});
const prisma = new PrismaClient();
prisma.user
  .count()
  .then((n) => console.log("USER_COUNT=" + n))
  .catch((e) => console.log("USER_COUNT=-1 " + e.message))
  .finally(() => prisma.$disconnect());
`,
  "utf8"
);
// PrismaClient resolves DATABASE_URL at construction time, so the probe needs
// the same env the API runs with (the setup process itself never loaded .env).
// `shell: false` matters: process.execPath is "C:\Program Files\nodejs\node.exe"
// and a shell would split that path at the space.
const probeResult = spawnSync(process.execPath, [probePath], {
  cwd: apiDir,
  encoding: "utf8",
  shell: false,
  env: { ...process.env, DATABASE_URL: apiEnv.DATABASE_URL },
});
try {
  unlinkSync(probePath);
} catch {
  /* ignore */
}
const match = /USER_COUNT=(-?\d+)/.exec(probeResult.stdout ?? "");
if (match) userCount = Number(match[1]);
const probeError = (probeResult.stdout ?? "")
  .split(/\r?\n/)
  .find((line) => line.startsWith("USER_COUNT=-1"));

if (NO_SEED) {
  log("--no-seed given — skipping demo data.");
} else if (FORCE_SEED || userCount === 0) {
  run("seeding demo data", "npm", ["run", "prisma:seed"], apiDir);
} else if (userCount > 0) {
  log(`database already has ${userCount} user(s) — skipping demo seed (use --seed to force).`);
} else {
  const reason =
    probeError ??
    (probeResult.stderr ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");
  warn(`could not read the user count — skipping demo seed.${reason ? ` (${reason})` : ""}`);
  warn("run `npm run db:seed` manually if you want the demo data.");
}

// ── done ───────────────────────────────────────────────────────────────────
console.log(`
[setup] Done.

  Start everything:   npm run dev
  Web:                http://localhost:3000
  API:                http://localhost:4000/api
  API health:         http://localhost:4000/api/health

  Demo logins (only if the seed ran): sakib@zoolyum.com / zoolyum123

  Useful next steps:
    npm run db:seed     re-seed demo data (wipes demo tables)
    npm run db:bootstrap  production install: roles + owner only, no demo data
    npm run db:reset    drop the database, migrate, re-seed from scratch
`);
