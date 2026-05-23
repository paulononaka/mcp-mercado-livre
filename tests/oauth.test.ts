import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { OAuthManager, OAuthError, exchangeAuthorizationCode } from "../src/oauth.js";

const FAKE_NOW = 1_700_000_000_000;

function fetchMockOk(body: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

function fetchMockBadStatus(status: number, body = ""): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe("OAuthManager", () => {
  let dir: string;
  let cachePath: string;
  let origFetch: typeof fetch;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mlmcp-oauth-"));
    cachePath = join(dir, "token_cache.json");
    origFetch = globalThis.fetch;
    vi.spyOn(Date, "now").mockReturnValue(FAKE_NOW);
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("fromEnv rejeita sem CLIENT_ID/CLIENT_SECRET", async () => {
    await expect(OAuthManager.fromEnv({} as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(OAuthError);
  });

  it("getAccessToken usa token cacheado se ainda valido", async () => {
    const mgr = new OAuthManager({
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "FRESH_TOKEN",
      expiresAt: FAKE_NOW + 10 * 60 * 1000,
    });
    expect(await mgr.getAccessToken()).toBe("FRESH_TOKEN");
  });

  it("refresh troca refresh_token por novo access_token e escreve cache chmod 600", async () => {
    globalThis.fetch = fetchMockOk({ access_token: "NEW_AT", refresh_token: "NEW_RT", expires_in: 21600 });
    const mgr = new OAuthManager({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "OLD_RT",
      tokenCachePath: cachePath,
    });
    const token = await mgr.getAccessToken();
    expect(token).toBe("NEW_AT");
    const onDisk = JSON.parse(await readFile(cachePath, "utf8"));
    expect(onDisk.access_token).toBe("NEW_AT");
    expect(onDisk.refresh_token).toBe("NEW_RT");
    expect(onDisk.expires_at).toBe(FAKE_NOW + 21600 * 1000);
    const st = await stat(cachePath);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("refresh dispara quando token esta dentro do skew (60s)", async () => {
    globalThis.fetch = fetchMockOk({ access_token: "REFRESHED", refresh_token: "RT", expires_in: 21600 });
    const mgr = new OAuthManager({
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "OLD_AT",
      refreshToken: "RT_OLD",
      expiresAt: FAKE_NOW + 30 * 1000,
      tokenCachePath: cachePath,
    });
    expect(await mgr.getAccessToken()).toBe("REFRESHED");
  });

  it("forceRefresh ignora cache mesmo se valido", async () => {
    globalThis.fetch = fetchMockOk({ access_token: "FORCED", refresh_token: "RT", expires_in: 21600 });
    const mgr = new OAuthManager({
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "STILL_GOOD",
      refreshToken: "RT_X",
      expiresAt: FAKE_NOW + 10 * 60 * 1000,
      tokenCachePath: cachePath,
    });
    expect(await mgr.forceRefresh()).toBe("FORCED");
  });

  it("refresh sem refresh_token lanca OAuthError", async () => {
    const mgr = new OAuthManager({ clientId: "cid", clientSecret: "sec" });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });

  it("loadCache puxa tokens de token_cache.json existente", async () => {
    await writeFile(
      cachePath,
      JSON.stringify({ access_token: "FROM_DISK", refresh_token: "RT_DISK", expires_at: FAKE_NOW + 60 * 60 * 1000 }),
      "utf8",
    );
    const mgr = await OAuthManager.fromEnv({
      MERCADOLIBRE_CLIENT_ID: "cid",
      MERCADOLIBRE_CLIENT_SECRET: "sec",
      MERCADOLIBRE_TOKEN_CACHE: cachePath,
    } as NodeJS.ProcessEnv);
    expect(await mgr.getAccessToken()).toBe("FROM_DISK");
  });

  it("refresh erra quando endpoint retorna 4xx", async () => {
    globalThis.fetch = fetchMockBadStatus(400, "invalid_grant");
    const mgr = new OAuthManager({ clientId: "cid", clientSecret: "sec", refreshToken: "BAD_RT" });
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("exchangeAuthorizationCode", () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    vi.spyOn(Date, "now").mockReturnValue(FAKE_NOW);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("troca code por tokens", async () => {
    globalThis.fetch = fetchMockOk({ access_token: "AT", refresh_token: "RT", expires_in: 21600 });
    const tokens = await exchangeAuthorizationCode({
      clientId: "cid",
      clientSecret: "sec",
      code: "AUTH_CODE",
      redirectUri: "http://localhost:8080/callback",
    });
    expect(tokens.access_token).toBe("AT");
    expect(tokens.refresh_token).toBe("RT");
    expect(tokens.expires_at).toBe(FAKE_NOW + 21600 * 1000);
  });

  it("erra quando code invalido", async () => {
    globalThis.fetch = fetchMockBadStatus(400, "invalid_code");
    await expect(
      exchangeAuthorizationCode({ clientId: "x", clientSecret: "y", code: "BAD", redirectUri: "http://localhost/cb" }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});
