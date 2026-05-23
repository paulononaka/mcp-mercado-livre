import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { OAuthConfig, TokenCache } from "./schemas.js";

const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_SKEW_SECONDS = 60;

export class OAuthError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`OAuth ${status}: ${body}`);
    this.name = "OAuthError";
    this.status = status;
    this.body = body;
  }
}

export class OAuthManager {
  private clientId: string;
  private clientSecret: string;
  private refreshToken?: string;
  private accessToken?: string;
  private expiresAt: number;
  private cachePath?: string;
  private inflight?: Promise<string>;

  constructor(config: OAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.accessToken = config.accessToken;
    this.expiresAt = config.expiresAt ?? 0;
    this.cachePath = config.tokenCachePath;
  }

  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<OAuthManager> {
    const clientId = env.MERCADOLIBRE_CLIENT_ID;
    const clientSecret = env.MERCADOLIBRE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new OAuthError(0, "MERCADOLIBRE_CLIENT_ID e MERCADOLIBRE_CLIENT_SECRET sao obrigatorios. Rode oauth-bootstrap antes.");
    }
    const cachePath = env.MERCADOLIBRE_TOKEN_CACHE ?? `${env.HOME ?? ""}/.config/mercadolivre/token_cache.json`;
    const mgr = new OAuthManager({
      clientId,
      clientSecret,
      refreshToken: env.MERCADOLIBRE_REFRESH_TOKEN,
      accessToken: env.MERCADOLIBRE_ACCESS_TOKEN,
      tokenCachePath: cachePath,
    });
    await mgr.loadCache();
    return mgr;
  }

  private async loadCache(): Promise<void> {
    if (!this.cachePath) return;
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const cache = JSON.parse(raw) as TokenCache;
      if (cache.access_token) this.accessToken = cache.access_token;
      if (cache.refresh_token) this.refreshToken = cache.refresh_token;
      if (cache.expires_at) this.expiresAt = cache.expires_at;
    } catch {
      // cache miss is fine; we'll refresh on demand
    }
  }

  private async writeCache(): Promise<void> {
    if (!this.cachePath || !this.accessToken || !this.refreshToken) return;
    const cache: TokenCache = {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt,
    };
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
    await chmod(this.cachePath, 0o600);
  }

  isExpired(now: number = Date.now()): boolean {
    return !this.accessToken || this.expiresAt - REFRESH_SKEW_SECONDS * 1000 <= now;
  }

  async getAccessToken(): Promise<string> {
    if (!this.isExpired()) return this.accessToken as string;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  async forceRefresh(): Promise<string> {
    this.expiresAt = 0;
    return this.getAccessToken();
  }

  private async refresh(): Promise<string> {
    if (!this.refreshToken) {
      throw new OAuthError(0, "Sem refresh_token. Rode oauth-bootstrap primeiro.");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new OAuthError(res.status, await res.text());
    }
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    this.accessToken = json.access_token;
    if (json.refresh_token) this.refreshToken = json.refresh_token;
    this.expiresAt = Date.now() + json.expires_in * 1000;
    await this.writeCache();
    return this.accessToken;
  }
}

export async function exchangeAuthorizationCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenCache> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new OAuthError(res.status, await res.text());
  }
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
}
