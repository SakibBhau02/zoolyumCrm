import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
});