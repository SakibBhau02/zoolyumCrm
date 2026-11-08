import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import compression from "compression";
import express from "express";
import { AppModule } from "./app.module";

/** Wrap a plain middleware so Nest's DI-created app can use it. */
function securityHeaders() {
  return (req: any, res: any, next: () => void) => {
    // The API only ever returns JSON/files, so a locked-down CSP is safe.
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    res.removeHeader("X-Powered-By");
    next();
  };
}

async function bootstrap() {
  // rawBody gives webhook handlers the exact bytes Meta signed (HMAC check).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix("api");

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable("x-powered-by");
  // Trust the reverse proxy only when explicitly enabled: the IP allowlist and
  // the rate limiter both read x-forwarded-for, and trusting it blindly would
  // let a client spoof its own address.
  if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
    expressApp.set("trust proxy", 1);
  }

  app.use(securityHeaders());
  app.use(compression());
  // The ZKTeco fingerprint device pushes ATTLOG data as raw text (text/plain
  // or urlencoded), so accept text bodies before the default parsers skip them.
  app.use(
    express.text({
      type: (req: any) => {
        const ct = String(req.headers["content-type"] ?? "").toLowerCase();
        return ct.startsWith("text/plain") || ct.startsWith("application/x-www-form-urlencoded");
      },
      limit: "2mb",
    })
  );

  // CORS is configuration, not a code constant: a production deploy must not
  // have to patch main.ts to admit its own domain.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })
  );
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Zoolyum OS API running on http://localhost:${port}/api`);
}
void bootstrap();
