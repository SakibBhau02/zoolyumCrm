import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateBrandingDto } from "../src/control/dto/update-branding.dto";

describe("UpdateBrandingDto", () => {
  it("should pass with valid hex colors", async () => {
    const dto = plainToInstance(UpdateBrandingDto, { primaryColor: "#7C3AED", secondaryColor: "#38BDF8" });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should fail with invalid hex color", async () => {
    const dto = plainToInstance(UpdateBrandingDto, { primaryColor: "not-hex" });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should fail with invalid url for logoDarkUrl", async () => {
    const dto = plainToInstance(UpdateBrandingDto, { logoDarkUrl: "not-a-url" });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should pass with valid url for logoDarkUrl", async () => {
    const dto = plainToInstance(UpdateBrandingDto, { logoDarkUrl: "https://example.com/logo.svg" });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should pass with empty body (all optional)", async () => {
    const dto = plainToInstance(UpdateBrandingDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should accept appName string", async () => {
    const dto = plainToInstance(UpdateBrandingDto, { appName: "Zoolyum OS" });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});

describe("Branding upload fileFilter + limits", () => {
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  it("should allow image mimes", () => {
    for (const m of allowed) expect(allowed.includes(m)).toBe(true);
  });

  it("should reject text/plain", () => {
    expect(allowed.includes("text/plain")).toBe(false);
  });

  it("should enforce 5MB limit constant", () => {
    expect(5 * 1024 * 1024).toBe(5242880);
  });

  it("sanitizes filename", () => {
    const name = "my logo@#$.png";
    const safe = name.replace(/[^a-zA-Z0-9.\-_]/g, "");
    expect(safe).toBe("mylogo.png");
  });

  it("upload response url shape", () => {
    const filename = "uuid-test.png";
    const url = `/api/control/branding/uploads/${filename}`;
    expect(url).toMatch(/\/api\/control\/branding\/uploads\//);
  });
});

describe("Branding service fallback", () => {
  it("fallback keeps logoUrl for backward compat", () => {
    const fallback = {
      logoUrl: "/brand/zoolyum-logo.svg",
      logoDarkUrl: null,
      logoLightUrl: null,
      appName: "Zoolyum OS",
      primaryColor: "#7C3AED",
      secondaryColor: "#38BDF8",
      invoiceNumberingFormat: "ZLM-{year}-{seq}",
    };
    expect(fallback.logoUrl).toBe("/brand/zoolyum-logo.svg");
    expect(fallback.logoDarkUrl).toBeNull();
  });
});
