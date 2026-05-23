import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MercadoLibreClient } from "../src/client.js";
import { MercadoLibreError } from "../src/errors.js";
import { OAuthManager } from "../src/oauth.js";

function buildOAuth(token = "AT_INIT"): OAuthManager {
  return new OAuthManager({
    clientId: "cid",
    clientSecret: "sec",
    accessToken: token,
    refreshToken: "RT",
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

describe("MercadoLibreClient", () => {
  let origFetch: typeof fetch;
  beforeEach(() => {
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("envia Bearer token no header", async () => {
    let captured: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Request(input as string, init);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const client = new MercadoLibreClient(buildOAuth("HELLO"));
    await client.get("/sites/MLB");
    expect(captured?.headers.get("authorization")).toBe("Bearer HELLO");
  });

  it("encoda query params via URLSearchParams", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    const client = new MercadoLibreClient(buildOAuth());
    await client.get("/sites/MLB/search", { q: "iphone 14 pro max", limit: "10" });
    expect(capturedUrl).toContain("q=iphone+14+pro+max");
    expect(capturedUrl).toContain("limit=10");
  });

  it("retry 1x em 401 com forceRefresh", async () => {
    const oauth = buildOAuth("OLD");
    const refreshSpy = vi.spyOn(oauth, "forceRefresh").mockResolvedValue("NEW");
    let calls = 0;
    const tokens: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      tokens.push(auth);
      if (calls === 1) return new Response("denied", { status: 401 });
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as typeof fetch;
    const client = new MercadoLibreClient(oauth);
    await client.get("/items/MLB1");
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
    expect(tokens[0]).toBe("Bearer OLD");
    expect(tokens[1]).toBe("Bearer NEW");
  });

  it("lanca MercadoLibreError em 4xx nao-401", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const client = new MercadoLibreClient(buildOAuth());
    await expect(client.get("/items/X")).rejects.toBeInstanceOf(MercadoLibreError);
  });
});
