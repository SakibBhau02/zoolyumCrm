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
  /** In-flight cache fills, keyed the same as the cache — see `wrap`. */
  private readonly inflight = new Map<string, Promise<unknown>>();

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

  /**
   * Atomic counter with a rolling expiry, used by the rate limiter.
   * Redis INCR keeps the count shared across API instances; the in-memory
   * fallback keeps a single-instance deployment working without Redis.
   */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (this.ready()) {
      const count = await this.redis!.incr(key);
      if (count === 1) await this.redis!.expire(key, ttlSeconds);
      return count;
    }
    const now = Date.now();
    const entry = this.mem.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.mem.set(key, { value: "1", expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number(entry.value) + 1;
    this.mem.set(key, { value: String(next), expiresAt: entry.expiresAt });
    return next;
  }

  async del(key: string): Promise<void> {
    this.inflight.delete(key);
    if (this.ready()) {
      await this.redis!.del(key);
      return;
    }
    this.mem.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {    // wrapQuery stores the empty-query list under the BARE prefix (no hash
    // suffix), which `prefix:*` never matches — so always drop the bare key
    // too, otherwise unfiltered lists stay stale for the full TTL.
    const bare = pattern.endsWith(":*") ? pattern.slice(0, -2) : null;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      for (const k of this.inflight.keys()) if (k.startsWith(prefix)) this.inflight.delete(k);
    } else {
      this.inflight.delete(pattern);
    }
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

  /** Health probe: "redis" when the shared cache is live, "memory" for fallback. */
  async ping(): Promise<"redis" | "memory" | "down"> {
    if (!this.redis) return "memory";
    try {
      const pong = await this.redis.ping();
      return pong === "PONG" ? "redis" : "down";
    } catch {
      return "down";
    }
  }

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    return this.singleFlight(key, () => this.computeAndStore(key, ttlSeconds, fn));
  }

  /**
   * Coalesces concurrent misses on the same key.
   *
   * A dashboard fires ~20 cached queries at once and they all expire together,
   * so every TTL boundary used to send 20 identical queries to Postgres at the
   * same millisecond — the exact moment the database is already busy. Callers
   * that arrive while a computation is in flight await that one promise.
   * Rejections are shared too: a failing query is asked once, not twenty times.
   */
  private async singleFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const promise = start().finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async computeAndStore<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const value = await fn();
    // `null` means "no such key" to `get`, so caching it would re-query forever.
    if (value !== null && value !== undefined) await this.set(key, value, ttlSeconds);
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