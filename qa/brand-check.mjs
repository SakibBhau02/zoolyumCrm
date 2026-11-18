/**
 * Brand verification: screenshots + computed-style contrast checks.
 *   node qa/brand-check.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = path.join("qa-evidence", "brand");
fs.mkdirSync(OUT, { recursive: true });

const COMBOS = [
  { key: "light", theme: "light" },
  { key: "dark", theme: "dark" },
];
const PAGES = [
  ["login", "/login", false],
  ["dashboard", "/dashboard", true],
  ["pulse", "/pulse", true],
  ["accounts", "/accounts", true],
  ["capital", "/capital", true],
  ["people", "/people", true],
  ["calendar", "/calendar", true],
  ["control", "/control", true],
  ["portal-client", "/portal-client", false],
];

const browser = await chromium.launch();
const report = {};

for (const combo of COMBOS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript((theme) => {
    localStorage.setItem("zoolyum-theme", theme);
  }, combo.theme);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (combo.key === "light") {
    await page.screenshot({ path: path.join(OUT, "login-light.png") });
  } else {
    await page.screenshot({ path: path.join(OUT, "login-dark.png") });
  }
  // sign in once (dark run reuses the same flow in a new context)
  if (combo.key === "light") {
    for (let i = 0; i < 3; i += 1) {
      await page.fill('input[type="email"]', "sakib@zoolyum.com");
      await page.fill('input[type="password"]', "zoolyum123");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForTimeout(4000);
      if (await page.evaluate(() => !!localStorage.getItem("zoolyum-token"))) break;
    }
  } else {
    // reuse the token from a quick API login so we go straight to the app
    const token = await fetch(`${BASE.replace(":3000", ":4000")}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
    })
      .then((r) => r.json())
      .then((j) => j.accessToken);
    await page.evaluate((t) => localStorage.setItem("zoolyum-token", t), token);
  }

  const shots = {};
  for (const [name, route, needsAuth] of PAGES) {
    if (name === "login") continue;
    if (needsAuth && combo.key === "dark" && name !== "login") {
      // token already set above
    }
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, `${name}-${combo.key}.png`), fullPage: false });
    const probe = await page.evaluate(() => {
      const css = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : null);
      const luminance = (rgb) => {
        const m = rgb.match(/\d+(\.\d+)?/g);
        if (!m) return null;
        const [r, g, b] = m.slice(0, 3).map((v) => {
          const c = Number(v) / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (fg, bg) => {
        const a = luminance(fg);
        const b = luminance(bg);
        if (a == null || b == null) return null;
        const hi = Math.max(a, b);
        const lo = Math.min(a, b);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      const primaryBtn = [...document.querySelectorAll("button, a")].find((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const p = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
        return bg && bg !== "rgba(0, 0, 0, 0)" && el.textContent?.trim() && getComputedStyle(el).fontWeight >= 600;
      });
      const root = getComputedStyle(document.documentElement);
      const sidebar = document.querySelector("aside");
      const activeNav = document.querySelector("aside a[class*='bg-sidebar-primary']");
      return {
        primary: root.getPropertyValue("--primary").trim(),
        primaryStrong: root.getPropertyValue("--primary-strong").trim(),
        background: root.getPropertyValue("--background").trim(),
        logo: document.querySelector("aside img, header img")?.getAttribute("src") ?? null,
        logoLoaded: (() => {
          const img = document.querySelector("aside img, header img");
          return img ? img.complete && img.naturalWidth > 0 : null;
        })(),
        activeNav: activeNav
          ? {
              bg: css(activeNav, "background-color"),
              fg: css(activeNav, "color"),
              ratio: ratio(css(activeNav, "color"), css(activeNav, "background-color")),
            }
          : null,
        bodyText: (() => {
          const el = document.querySelector("main p, main span, main td");
          return el ? { fg: css(el, "color"), bg: css(document.body, "background-color"), ratio: ratio(css(el, "color"), css(document.body, "background-color")) } : null;
        })(),
        sampleButton: primaryBtn
          ? {
              text: primaryBtn.textContent.trim().slice(0, 30),
              bg: getComputedStyle(primaryBtn).backgroundColor,
              fg: getComputedStyle(primaryBtn).color,
              ratio: ratio(getComputedStyle(primaryBtn).color, getComputedStyle(primaryBtn).backgroundColor),
            }
          : null,
        sidebarBg: sidebar ? css(sidebar, "background-color") : null,
        // detect near-invisible brand text: elements using text-primary
        faintPrimaryText: [...document.querySelectorAll(".text-primary")].filter((el) => {
          const r = ratio(getComputedStyle(el).color, getComputedStyle(document.body).backgroundColor);
          return r != null && r < 3;
        }).length,
      };
    });
    shots[name] = probe;
  }
  report[combo.key] = shots;
  await context.close();
}

// mobile light
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage();
await mp.addInitScript(() => localStorage.setItem("zoolyum-theme", "light"));
const token = await fetch("http://localhost:4000/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "sakib@zoolyum.com", password: "zoolyum123" }),
})
  .then((r) => r.json())
  .then((j) => j.accessToken);
await mp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await mp.evaluate((t) => localStorage.setItem("zoolyum-token", t), token);
for (const [name, route] of [["dashboard", "/dashboard"], ["control", "/control"], ["pulse", "/pulse"]]) {
  await mp.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(2000);
  await mp.screenshot({ path: path.join(OUT, `mobile-${name}.png`), fullPage: false });
}
await mctx.close();

await browser.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
