import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Regression guard for the People authorization model.
 *
 * The original bug: People writes were gated on role *names*
 * (`@Roles("Owner","HR/Admin")`) while the UI gated on the permission matrix.
 * A custom role created in Control with `PEOPLE → Edit` saw the Add button and
 * got 403 "Insufficient role". These tests pin the permission-based contract:
 *
 *   PEOPLE.edit    → can add/edit employees
 *   PEOPLE.approve → can read payroll, policy, devices
 *   PEOPLE.view    → can read the directory, cannot write, cannot see pay
 */
const API = "http://127.0.0.1:4000/api/";

const MATRIX = {
  PULSE: { view: true, edit: true, approve: true },
  PEOPLE: { view: true, edit: true, approve: true },
  TASKS: { view: true, edit: true, approve: false },
  FLOW: { view: true, edit: true, approve: false },
  ACCOUNTS: { view: true, edit: true, approve: false },
  CAPITAL: { view: true, edit: true, approve: false },
  INSIGHT: { view: true, edit: true, approve: false },
  CALENDAR: { view: true, edit: true, approve: false },
  CONTROL: { view: true, edit: true, approve: false },
  PORTAL: { view: false, edit: false, approve: false },
};

async function apiAs(token?: string): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function login(email: string, password = "zoolyum123") {
  const ctx = await apiAs();
  const res = await ctx.post("auth/login", { data: { email, password } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const token = (await res.json()).accessToken as string;
  await ctx.dispose();
  return token;
}

test("custom role with PEOPLE edit can add an employee (the reported bug)", async () => {
  const owner = await apiAs(await login("sakib@zoolyum.com"));
  const stamp = Date.now();
  let roleId: string | undefined;
  let userId: string | undefined;
  let employeeId: string | undefined;

  try {
    const role = await (
      await owner.post("control/roles", {
        data: { name: `Admin ${stamp}`, description: "authz regression", modulePermissions: MATRIX },
      })
    ).json();
    roleId = role.id;
    expect(roleId).toBeTruthy();

    const user = await (
      await owner.post("control/users", {
        data: {
          name: "Authz Probe",
          email: `authz.${stamp}@zoolyum.com`,
          password: "probe-password-123",
          roleId,
        },
      })
    ).json();
    userId = user.id;

    const actor = await apiAs(await login(`authz.${stamp}@zoolyum.com`, "probe-password-123"));
    try {
      const created = await actor.post("people/employees", {
        data: { name: `Authz Employee ${stamp}`, roleTitle: "Tester", joinDate: "2026-11-14", salary: 42000 },
      });
      expect(created.status(), await created.text()).toBe(201);
      employeeId = (await created.json()).id;

      // The salary it just set must be readable back (People → Approve).
      expect((await (await actor.get(`people/employees/${employeeId}`)).json()).salary).toBeTruthy();

      // Approve level unlocks payroll and policy reads.
      expect((await actor.get("people/payroll")).status()).toBe(200);
      expect((await actor.get("people/attendance-policy")).status()).toBe(200);
    } finally {
      await actor.dispose();
    }
  } finally {
    if (employeeId) await owner.delete(`people/employees/${employeeId}`);
    if (userId) await owner.delete(`control/users/${userId}`);
    if (roleId) await owner.delete(`control/roles/${roleId}`);
    await owner.dispose();
  }
});

test("view-only role can read the directory but not write or see payroll", async () => {
  const actor = await apiAs(await login("tanvir@zoolyum.com")); // Project Manager: PEOPLE view only
  try {
    expect((await actor.get("people/employees")).status()).toBe(200);
    expect((await actor.get("people/team")).status()).toBe(200);

    const write = await actor.post("people/employees", { data: { name: "Should Not Exist", roleTitle: "X" } });
    expect(write.status()).toBe(403);

    expect((await actor.get("people/payroll")).status()).toBe(403);
    expect((await actor.get("people/attendance-policy")).status()).toBe(403);
  } finally {
    await actor.dispose();
  }
});
