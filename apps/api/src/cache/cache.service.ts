import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

type MemoryEntry = { value: string; expiresAt: number };

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private readonly mem = new Map<string, MemoryEntry>();
  private readonly memory = !process.env.REDIS_URL;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.log("REDIS_URL not set — using in-memory cache fallback");
      return;
    }
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", (e) => this.logger.warn(`Redis error: ${e.message}`));
    client
      .connect()
      .then(() => {
        this.redis = client;
        this.logger.log("Redis connected");
      })
      .catch((e: Error) => {
        this.logger.warn(`Redis unavailable, using in-memory cache fallback: ${e.message}`);
        client.disconnect();
      });
  }

  async onModuleDestroy() {
    if (this.redis && this.redis.status === "ready") await this.redis.quit();
  }

  private ready(): boolean {
    return !!this.redis && this.redis.status === "ready";
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    if (this.ready()) {
      const raw = await this.redis!.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const entry = this.mem.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.ready()) {
      await this.redis!.set(key, raw, "EX", ttlSeconds);
      return;
    }
    this.mem.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    if (this.ready()) {
      await this.redis!.del(key);
      return;
    }
    this.mem.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    // wrapQuery stores the empty-query list under the BARE prefix (no hash
    // suffix), which `prefix:*` never matches — so always drop the bare key
    // too, otherwise unfiltered lists stay stale for the full TTL.
    const bare = pattern.endsWith(":*") ? pattern.slice(0, -2) : null;
    if (this.ready()) {
      if (bare) await this.redis!.del(bare).catch(() => {});
      let cursor = "0";
      do {
        const [next, keys] = await this.redis!.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = next;
        if (keys.length) await this.redis!.del(...keys);
      } while (cursor !== "0");
      return;
    }
    if (bare) this.mem.delete(bare);
    const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    for (const key of this.mem.keys()) if (re.test(key)) this.mem.delete(key);
  }

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async wrapQuery<T>(
    prefix: string,
    query: Record<string, unknown> | undefined,
    ttlSeconds: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const key = query && Object.keys(query).length
      ? `${prefix}:${this.hash(JSON.stringify(query))}`
      : prefix;
    return this.wrap<T>(key, ttlSeconds, fn);
  }

  private hash(str: string): string {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
}