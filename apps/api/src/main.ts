import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import compression from "compression";
import express from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
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
  app.enableCors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
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
  console.log(`🚀 Zoolyum OS API running on http://localhost:${port}/api`);
}
void bootstrap();
