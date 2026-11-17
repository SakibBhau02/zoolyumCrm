import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../cache/cache.service";
import * as bcrypt from "bcryptjs";
import { LoginDto } from "./dto/login.dto";

type Attempt = { count: number; lockedUntil: number };

/**
 * Staff authentication.
 *
 * Adds three production behaviours on top of the plain credential check:
 *  1. `tokenVersion` is embedded in the JWT so a password reset / deactivation
 *     invalidates old sessions immediately (see JwtAuthGuard).
 *  2. Failed logins are throttled in-memory with the policy stored in
 *     Settings.adminConfig.security (maxLoginAttempts / lockoutMinutes).
 *  3. The last login IP is recorded for the admin panel.
 *
 * The attempt map is process-local: a restart clears it, which is acceptable —
 * the database-backed token check still protects sessions, and a multi-instance
 * deployment should move this to Redis.
 */
@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, Attempt>();
  private readonly MAX_TRACKED = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cache: CacheService
  ) {}

  private async securityPolicy() {
    try {
      const row = await this.prisma.settings.findUnique({
        where: { id: "default" },
        select: { adminConfig: true },
      });
      const sec = ((row?.adminConfig as any)?.security ?? {}) as any;
      return {
        maxLoginAttempts: Math.min(50, Math.max(1, Number(sec.maxLoginAttempts) || 5)),
        lockoutMinutes: Math.min(1440, Math.max(1, Number(sec.lockoutMinutes) || 15)),
        sessionHours: Math.min(720, Math.max(1, Number(sec.sessionHours) || 12)),
      };
    } catch {
      return { maxLoginAttempts: 5, lockoutMinutes: 15, sessionHours: 12 };
    }
  }

  private trackFailure(key: string, policy: { maxLoginAttempts: number; lockoutMinutes: number }) {
    const rec = this.attempts.get(key) ?? { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= policy.maxLoginAttempts) {
      rec.lockedUntil = Date.now() + policy.lockoutMinutes * 60_000;
      rec.count = 0;
    }
    this.attempts.set(key, rec);
    if (this.attempts.size > this.MAX_TRACKED) {
      const first = this.attempts.keys().next().value as string | undefined;
      if (first) this.attempts.delete(first);
    }
  }

  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.toLowerCase().trim();
    const policy = await this.securityPolicy();
    // Lockout is keyed by (email, IP), not email alone: the audit showed that
    // anyone who knows a staff email could keep the Owner locked out forever by
    // sending 6 wrong passwords every 15 minutes (SEC-04). Per-IP keying still
    // stops password grinding from one place, while the route limiter
    // (30/min/IP) bounds a distributed attempt.
    const key = this.attemptKey(email, ip);
    const rec = this.attempts.get(key);
    if (rec?.lockedUntil && rec.lockedUntil > Date.now()) {
      const mins = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException(`Too many failed attempts. Try again in ${mins} minute(s).`);
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
    if (!user) {
      this.trackFailure(key, policy);
      throw new UnauthorizedException("Invalid credentials");
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      this.trackFailure(key, policy);
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!user.isActive) {
      throw new UnauthorizedException("This account is disabled. Contact your administrator.");
    }

    this.attempts.delete(key);
    return this.issueSession(user.id, ip);
  }

  private attemptKey(email: string, ip?: string) {
    return `${email}|${ip ?? "unknown"}`;
  }

  /** Sign a staff session for an already-authenticated user (password or WebAuthn). */
  async issueSession(userId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("This account is disabled. Contact your administrator.");
    }
    const policy = await this.securityPolicy();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      ver: user.tokenVersion,
      permissions: user.role.modulePermissions,
      // Unique session id so logout can revoke exactly this token.
      jti: randomUUID(),
    };

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: `${policy.sessionHours}h` }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role.name,
        permissions: user.role.modulePermissions,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }

  /**
   * Server-side logout: the token's jti is remembered until its own expiry, so
   * a copied token cannot be replayed after the user signs out. Other sessions
   * of the same user keep working (unlike a tokenVersion bump).
   */
  async signOut(jti?: string, exp?: number) {
    if (!jti) return { ok: true };
    const ttl = Math.max(1, Math.min(86_400, (exp ?? 0) - Math.floor(Date.now() / 1000)));
    await this.cache.set(`revoked:jti:${jti}`, "1", ttl);
    return { ok: true };
  }

  async me(userId: string) {    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException();
    const { passwordHash, ...safe } = user;
    return {
      ...safe,
      role: user.role.name,
      roleName: user.role.name,
      permissions: user.role.modulePermissions,
    };
  }
}
