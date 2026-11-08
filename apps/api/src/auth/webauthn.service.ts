import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

type PendingKind = "register" | "login" | "clock";
type Pending = { challenge: string; userId?: string; kind: PendingKind; expiresAt: number };

/**
 * Passwordless staff authentication with the platform authenticator
 * (Windows Hello fingerprint, Touch ID, Android biometrics).
 *
 * Challenges are held in memory with a 5-minute TTL; they are single-use and
 * consumed on verification. In a multi-instance deployment move them to Redis.
 */
@Injectable()
export class WebAuthnService {
  private readonly pending = new Map<string, Pending>();
  private readonly TTL_MS = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService
  ) {}

  private rp(req: any) {
    const origin =
      process.env.WEBAUTHN_ORIGIN ||
      req?.headers?.origin ||
      (req?.headers?.host ? `http://${req.headers.host}` : "http://localhost:3000");
    return {
      origin,
      rpID: process.env.WEBAUTHN_RP_ID || new URL(origin).hostname,
      rpName: process.env.WEBAUTHN_RP_NAME || "Zoolyum OS",
    };
  }

  private put(key: string, value: Omit<Pending, "expiresAt">) {
    this.cleanup();
    this.pending.set(key, { ...value, expiresAt: Date.now() + this.TTL_MS });
  }

  private take(key: string, kind: PendingKind): Pending {
    const entry = this.pending.get(key);
    this.pending.delete(key);
    if (!entry || entry.kind !== kind || entry.expiresAt < Date.now()) {
      throw new BadRequestException("This biometric request expired. Please try again.");
    }
    return entry;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.pending) if (entry.expiresAt < now) this.pending.delete(key);
  }

  private transports(value: string | null | undefined): AuthenticatorTransport[] | undefined {
    if (!value) return undefined;
    return value.split(",").filter(Boolean) as AuthenticatorTransport[];
  }

  // â”€â”€ Registration (signed-in user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async registrationOptions(userId: string, req: any) {
    const { rpID, rpName } = this.rp(req);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const existing = await this.prisma.webAuthnCredential.findMany({ where: { userId } });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Uint8Array.from(Buffer.from(user.id)),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: this.transports(c.transports),
      })),
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    this.put(`reg:${userId}`, { challenge: options.challenge, userId, kind: "register" });
    return options;
  }

  async verifyRegistration(userId: string, body: any, req: any) {
    if (!body?.response) throw new BadRequestException("Missing registration response");
    const { origin, rpID } = this.rp(req);
    const pending = this.take(`reg:${userId}`, "register");

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    const info = verification.registrationInfo;
    if (!verification.verified || !info) throw new BadRequestException("Fingerprint registration could not be verified");

    const credential = info.credential;
    const label =
      typeof body.deviceLabel === "string" && body.deviceLabel.trim()
        ? body.deviceLabel.trim().slice(0, 80)
        : "This device";

    const row = await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: (credential.transports ?? []).join(",") || null,
        deviceLabel: label,
      },
    });
    return { ok: true, id: row.id, deviceLabel: row.deviceLabel };
  }

  async credentials(userId: string) {
    const rows = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, deviceLabel: true, transports: true, createdAt: true, lastUsedAt: true },
    });
    return rows;
  }

  async deleteCredential(userId: string, id: string) {
    const row = await this.prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Fingerprint not found");
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    return { ok: true };
  }

  // â”€â”€ Passwordless login (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async loginOptions(body: { email?: string }, req: any) {
    const { rpID } = this.rp(req);
    const email = body?.email?.toLowerCase().trim();
    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;

    if (email) {
      const user = await this.prisma.user.findUnique({ where: { email }, include: { webauthnCredentials: true } });
      if (user?.isActive && user.webauthnCredentials.length) {
        allowCredentials = user.webauthnCredentials.map((c) => ({
          id: c.credentialId,
          transports: this.transports(c.transports),
        }));
      } else {
        throw new BadRequestException("No fingerprint is registered for this account");
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials,
    });
    const flowId = randomUUID();
    this.put(`login:${flowId}`, { challenge: options.challenge, kind: "login" });
    return { flowId, options };
  }

  async verifyLogin(body: { flowId: string; response: any }, req: any, ip?: string) {
    if (!body?.flowId || !body?.response) throw new BadRequestException("Missing biometric response");
    const { origin, rpID } = this.rp(req);
    const pending = this.take(`login:${body.flowId}`, "login");

    const credentialId = body.response.id;
    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });
    if (!stored || !stored.user.isActive) throw new UnauthorizedException("This fingerprint is not recognised");

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: this.transports(stored.transports),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new UnauthorizedException("Fingerprint verification failed");

    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });

    return this.auth.issueSession(stored.userId, ip);
  }

  // â”€â”€ Biometric clock in / out (signed-in user) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async clockOptions(userId: string, req: any) {
    const { rpID } = this.rp(req);
    const creds = await this.prisma.webAuthnCredential.findMany({ where: { userId } });
    if (!creds.length) throw new BadRequestException("Register a fingerprint first");
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: this.transports(c.transports) })),
    });
    this.put(`clock:${userId}`, { challenge: options.challenge, userId, kind: "clock" });
    return options;
  }

  async verifyClock(userId: string, body: { response: any }, req: any) {
    if (!body?.response) throw new BadRequestException("Missing biometric response");
    const { origin, rpID } = this.rp(req);
    const pending = this.take(`clock:${userId}`, "clock");

    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: body.response.id },
    });
    if (!stored || stored.userId !== userId) throw new UnauthorizedException("This fingerprint is not recognised");

    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: this.transports(stored.transports),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new UnauthorizedException("Fingerprint verification failed");

    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    return { verified: true };
  }
}
