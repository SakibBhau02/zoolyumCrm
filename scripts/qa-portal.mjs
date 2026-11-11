/**
 * Portal regression check — runs against a seeded API.
 *
 *   node scripts/qa-portal.mjs
 *
 * Read-only except for the session it creates (login/logout). Designed to run in
 * CI after `npm run db:seed`, right after the staff smoke suite.
 */
const API = process.env.PORTAL_API_URL ?? "http://localhost:4000/api";

let pass = 0;
let fail = 0;

async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 200);
  }
  return { status: res.status, data };
}

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}  ${detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)}`);
  }
}

async function main() {
  const staffLogin = await call("/auth/login", {
    method: "POST",
    body: { email: "sakib@zoolyum.com", password: "zoolyum123" },
  });
  const staff = staffLogin.data?.accessToken;
  check("staff login", staffLogin.status === 201 && !!staff, staffLogin.status);

  const users = await call("/portal/users", { token: staff });
  const first = users.data?.[0] ?? {};
  check("staff portal users: 200", users.status === 200, users.status);
  check("staff portal users: no password hash", !("passwordHash" in first), Object.keys(first));
  check("staff portal users: no telegram link code", !("telegramLinkCode" in first), Object.keys(first));

  const publicBranding = await call("/control/branding/public");
  check("public branding: 200", publicBranding.status === 200 && !!publicBranding.data?.appName, publicBranding.status);

  const login = await call("/portal-client/login", {
    method: "POST",
    body: { email: "principal@gvs.edu.bd", password: "portal123" },
  });
  const token = login.data?.portalToken;
  check("portal login: 200", login.status === 200 && !!token, login.status);
  if (!token) throw new Error("portal login failed — cannot continue");

  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  check("portal token: jti + ver + aud", !!claims.jti && typeof claims.ver === "number" && claims.aud === "portal", claims);

  const me = await call("/portal-client/me", { token });
  check("portal me: permission envelope", me.status === 200 && !!me.data?.permissions, me.data);

  const overview = await call("/portal-client/overview", { token });
  check("overview: 200 + permissions", overview.status === 200 && !!overview.data?.permissions, overview.status);

  const badStatus = await call("/portal-client/tasks?status=NOT_A_STATUS", { token });
  check("invalid task status: 400", badStatus.status === 400, badStatus.status);

  const files = await call("/portal-client/files", { token });
  check("files endpoint: 200", files.status === 200 && Array.isArray(files.data), files.status);
  const file = files.data?.[0];
  if (file) {
    check("file has display name", !!file.fileName, file);
    const badDecision = await call(`/portal-client/files/${file.id}/approval`, {
      token,
      method: "POST",
      body: { decision: "HACK" },
    });
    check("invalid approval decision: 400", badDecision.status === 400, badDecision.status);
    const noNotes = await call(`/portal-client/files/${file.id}/approval`, {
      token,
      method: "POST",
      body: { decision: "REVISION_REQUESTED" },
    });
    check("revision without notes: 400", noNotes.status === 400, noNotes.status);
  }

  const search = await call("/portal-client/tasks?q=script", { token });
  check("task search: filtered", search.status === 200 && Array.isArray(search.data?.items), search.status);

  const logout = await call("/portal-client/logout", { token, method: "POST" });
  const afterLogout = await call("/portal-client/me", { token });
  check("logout revokes the token", logout.status === 200 && afterLogout.status === 401, {
    logout: logout.status,
    me: afterLogout.status,
  });

  console.log(`\n${pass}/${pass + fail} portal checks passed`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
