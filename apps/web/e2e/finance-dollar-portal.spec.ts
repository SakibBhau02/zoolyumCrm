import { test, expect } from "@playwright/test";

/**
 * Regression guard for Dollar Desk → client visibility.
 *
 * A client's USD purchase (a `DollarSale`) must appear in two places that used
 * to ignore it entirely:
 *   • the internal client file (Accounts → client detail)
 *   • the client-facing portal (Invoices tab)
 * and the portal must never leak the agency's cost rate / profit / margin.
 *
 * Creates one sale and removes it in `finally`, so it is safe to run repeatedly.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api";

test("a client's USD purchase shows on their file and in the portal (no margin leakage)", async ({ request }) => {
  const staff = (
    await (await request.post(`${API}/auth/login`, { data: { email: "sakib@zoolyum.com", password: "zoolyum123" } })).json()
  ).accessToken as string;
  const staffAuth = { authorization: `Bearer ${staff}` };

  const clients = await (await request.get(`${API}/accounts/client-lookup`, { headers: staffAuth })).json();
  const client = clients.find((c: any) => c.companyName === "Green Valley School");
  expect(client, "seeded client 'Green Valley School' exists").toBeTruthy();

  const saleRes = await request.post(`${API}/capital/dollar/sales`, {
    headers: staffAuth,
    data: { clientId: client.id, usdAmount: 10, bdtAmount: 1350, date: "2026-11-10", paymentMethod: "CASH" },
  });
  expect(saleRes.ok()).toBeTruthy();
  const sale = await saleRes.json();

  try {
    // 1. Internal client file.
    const detail = await (await request.get(`${API}/accounts/clients/${client.id}`, { headers: staffAuth })).json();
    expect(detail.dollar?.summary?.count ?? 0).toBeGreaterThan(0);
    const inFile = detail.dollar.purchases.find((p: any) => p.id === sale.id);
    expect(inFile, "purchase appears on the client file").toBeTruthy();
    expect(inFile.usdAmount).toBe(10);
    expect(inFile.bdtAmount).toBe(1350);

    // 2. Client portal (login as the seeded portal user for that client).
    const portal = await (
      await request.post(`${API}/portal-client/login`, { data: { email: "principal@gvs.edu.bd", password: "portal123" } })
    ).json();
    expect(portal.portalToken).toBeTruthy();

    const pInvoices = await (
      await request.get(`${API}/portal-client/invoices`, { headers: { authorization: `Bearer ${portal.portalToken}` } })
    ).json();
    const row = (pInvoices.dollarPurchases?.purchases ?? []).find((p: any) => p.id === sale.id);
    expect(row, "purchase appears in the portal").toBeTruthy();
    expect(row.usdAmount).toBe(10);
    expect(row.rate).toBe(135);

    // 3. The agency's economics must not leak to the client.
    expect(row.costRate).toBeUndefined();
    expect(row.costBdt).toBeUndefined();
    expect(row.profit).toBeUndefined();
    expect(row.marginPct).toBeUndefined();
    expect(row.notes).toBeUndefined();

    // 4. The portal dashboard summary also carries it.
    const pOverview = await (
      await request.get(`${API}/portal-client/overview`, { headers: { authorization: `Bearer ${portal.portalToken}` } })
    ).json();
    expect(pOverview.dollarPurchases?.count ?? 0).toBeGreaterThan(0);
    expect(pOverview.dollarPurchases.totalUsd).toBeGreaterThanOrEqual(10);
  } finally {
    await request.delete(`${API}/capital/dollar/sales/${sale.id}`, { headers: staffAuth });
  }
});
