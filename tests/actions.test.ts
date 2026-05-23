import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchItems,
  getItem,
  getItemDescription,
  getCategories,
  getCategory,
  getSellerInfo,
  getTrends,
  getCurrencyConversion,
} from "../src/actions.js";
import { MercadoLibreClient } from "../src/client.js";
import { OAuthManager } from "../src/oauth.js";

function client(): MercadoLibreClient {
  const oauth = new OAuthManager({
    clientId: "cid",
    clientSecret: "sec",
    accessToken: "AT",
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return new MercadoLibreClient(oauth);
}

function mockFetchJson(payload: unknown, captureUrl?: { value?: string }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (captureUrl) captureUrl.value = String(input);
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

describe("actions", () => {
  let origFetch: typeof fetch;
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

  it("searchItems default site_id=MLB, limit=10, e mapeia condition/free_shipping/sort/seller_id pra query string", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({ paging: { total: 0 }, results: [] }, cap);
    await searchItems(client(), {
      query: "tv 55",
      condition: "new",
      free_shipping: true,
      sort: "price_asc",
      seller_id: 999,
    });
    const url = cap.value ?? "";
    expect(url).toContain("/sites/MLB/search");
    expect(url).toContain("q=tv+55");
    expect(url).toContain("condition=new");
    expect(url).toContain("shipping_cost=free");
    expect(url).toContain("sort=price_asc");
    expect(url).toContain("seller_id=999");
    expect(url).toContain("limit=10");
  });

  it("searchItems retorna shape curado por resultado", async () => {
    globalThis.fetch = mockFetchJson({
      paging: { total: 1, limit: 10, offset: 0 },
      results: [{
        id: "MLB1",
        title: "TV 55",
        price: 2999,
        currency_id: "BRL",
        condition: "new",
        available_quantity: 5,
        sold_quantity: 100,
        shipping: { free_shipping: true, logistic_type: "fulfillment" },
        seller: { id: 42, nickname: "STORE" },
        permalink: "https://x",
        thumbnail: "https://t",
        catalog_listing: true,
      }],
    });
    const res = await searchItems(client(), { query: "tv" }) as { results: Array<Record<string, unknown>> };
    expect(res.results[0]).toMatchObject({
      id: "MLB1",
      title: "TV 55",
      price: 2999,
      free_shipping: true,
      logistic_type: "fulfillment",
      seller_id: 42,
      seller_nickname: "STORE",
      catalog_listing: true,
    });
  });

  it("searchItems respeita limit max 50", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({ paging: {}, results: [] }, cap);
    await searchItems(client(), { query: "x", limit: 9999 });
    expect(cap.value).toContain("limit=50");
  });

  it("getItem extrai apenas key_attributes (VOLTAGE, BRAND, etc) e trunca pictures a 5", async () => {
    globalThis.fetch = mockFetchJson({
      id: "MLB99",
      title: "Liquidificador",
      price: 199,
      currency_id: "BRL",
      condition: "new",
      available_quantity: 3,
      sold_quantity: 50,
      permalink: "https://x",
      category_id: "MLB100",
      seller_id: 7,
      warranty: "12 meses",
      listing_type_id: "gold",
      shipping: { free_shipping: false },
      pictures: Array.from({ length: 10 }, (_, i) => ({ secure_url: `https://p${i}` })),
      attributes: [
        { id: "VOLTAGE", name: "Voltagem", value_name: "127V" },
        { id: "BRAND", name: "Marca", value_name: "Mondial" },
        { id: "MODEL", name: "Modelo", value_name: "L-99" },
        { id: "INTERNAL_TAG_FOO", name: "Ignore", value_name: "should-not-appear" },
      ],
    });
    const res = await getItem(client(), { item_id: "MLB99" }) as {
      key_attributes: Array<{ id: string; value: string | null }>;
      pictures: string[];
    };
    expect(res.key_attributes.map((a) => a.id)).toEqual(["VOLTAGE", "BRAND", "MODEL"]);
    expect(res.pictures.length).toBe(5);
    expect(res.pictures[0]).toBe("https://p0");
  });

  it("getItemDescription retorna plain_text", async () => {
    globalThis.fetch = mockFetchJson({ plain_text: "Descricao longa.", last_updated: "2026-01-01T00:00:00Z" });
    const res = await getItemDescription(client(), { item_id: "MLB1" }) as { plain_text: string };
    expect(res.plain_text).toBe("Descricao longa.");
  });

  it("getCategories default site_id=MLB", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson([], cap);
    await getCategories(client());
    expect(cap.value).toContain("/sites/MLB/categories");
  });

  it("getCategory passa category_id encoded", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({ id: "MLB1055", name: "Eletronicos" }, cap);
    await getCategory(client(), { category_id: "MLB1055" });
    expect(cap.value).toContain("/categories/MLB1055");
  });

  it("getSellerInfo extrai reputation_level e transactions", async () => {
    globalThis.fetch = mockFetchJson({
      id: 42,
      nickname: "STORE",
      permalink: "https://s",
      seller_reputation: {
        level_id: "5_green",
        power_seller_status: "platinum",
        transactions: { completed: 5000, canceled: 50, total: 5050, ratings: { positive: 0.98, neutral: 0.01, negative: 0.01 } },
      },
    });
    const res = await getSellerInfo(client(), { seller_id: 42 }) as {
      reputation_level: string;
      power_seller_status: string;
      transactions_completed: number;
    };
    expect(res.reputation_level).toBe("5_green");
    expect(res.power_seller_status).toBe("platinum");
    expect(res.transactions_completed).toBe(5000);
  });

  it("getTrends default site_id=MLB", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson([], cap);
    await getTrends(client());
    expect(cap.value).toContain("/trends/MLB");
  });

  it("getCurrencyConversion calcula converted com rate", async () => {
    globalThis.fetch = mockFetchJson({ ratio: 5 });
    const res = await getCurrencyConversion(client(), { from: "USD", to: "BRL", amount: 10 }) as { converted: number };
    expect(res.converted).toBe(50);
  });
});
