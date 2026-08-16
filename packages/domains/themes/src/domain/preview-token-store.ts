export interface PreviewTokenStore {
  set(token: string, themeId: string, ttlSeconds: number): Promise<void> | void;
  get(token: string): Promise<string | null> | string | null;
  delete(token: string): Promise<void> | void;
}

export class MemoryPreviewTokenStore implements PreviewTokenStore {
  private tokens = new Map<string, { themeId: string; expiresAt: number }>();

  set(token: string, themeId: string, ttlSeconds: number): void {
    this.tokens.set(token, {
      themeId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  get(token: string): string | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return null;
    }
    return entry.themeId;
  }

  delete(token: string): void {
    this.tokens.delete(token);
  }
}

export interface RedisLikeClient {
  set(key: string, value: string, mode: "EX", duration: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export class RedisPreviewTokenStore implements PreviewTokenStore {
  constructor(
    private getRedis: () => RedisLikeClient,
    private keyPrefix: string = "vibress:theme:preview:",
  ) {}

  async set(token: string, themeId: string, ttlSeconds: number): Promise<void> {
    const client = this.getRedis();
    await client.set(`${this.keyPrefix}${token}`, themeId, "EX", ttlSeconds);
  }

  async get(token: string): Promise<string | null> {
    const client = this.getRedis();
    return await client.get(`${this.keyPrefix}${token}`);
  }

  async delete(token: string): Promise<void> {
    const client = this.getRedis();
    await client.del(`${this.keyPrefix}${token}`);
  }
}
