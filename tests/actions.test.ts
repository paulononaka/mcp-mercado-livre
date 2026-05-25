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
  getCatalogProduct,
  getCatalogProductItems,
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

  it("searchItems 403 do upstream vira objeto estruturado (search_endpoint_restricted)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: "forbidden", error: "forbidden", status: 403, cause: [] }),
        { status: 403 }
      )) as typeof fetch;
    const res = await searchItems(client(), { query: "qualquer coisa" }) as {
      error: string;
      upstream_status: number;
      fallback_tools: string[];
      message: string;
    };
    expect(res.error).toBe("search_endpoint_restricted");
    expect(res.upstream_status).toBe(403);
    expect(res.fallback_tools).toEqual([
      "get_catalog_product",
      "get_catalog_product_items",
      "get_item",
    ]);
    expect(res.message).toMatch(/get_catalog_product/);
  });

  it("searchItems 401 NÃO é confundido com 403 — propaga como erro (e não devolve search_endpoint_restricted)", async () => {
    // OAuthManager sem refresh_token → forceRefresh lança antes mesmo de retry.
    // O importante aqui é garantir que 401 NÃO seja silenciosamente convertido em search_endpoint_restricted.
    globalThis.fetch = (async () =>
      new Response("{\"message\":\"unauthorized\"}", { status: 401 })) as typeof fetch;
    await expect(searchItems(client(), { query: "x" })).rejects.toThrow();
  });

  it("searchItems 429 propaga como erro (não cai no fallback de 403)", async () => {
    globalThis.fetch = (async () =>
      new Response("{\"message\":\"too many requests\"}", { status: 429 })) as typeof fetch;
    await expect(searchItems(client(), { query: "x" })).rejects.toThrow(/failed \(429\)/);
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

  it("getItem 403 do upstream vira objeto estruturado (item_endpoint_restricted)", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: "Access to the requested resource is forbidden", error: "access_denied", status: 403, cause: null }),
        { status: 403 }
      )) as typeof fetch;
    const res = await getItem(client(), { item_id: "MLB3392752495" }) as {
      error: string;
      upstream_status: number;
      item_id: string;
      fallback_tools: string[];
      message: string;
    };
    expect(res.error).toBe("item_endpoint_restricted");
    expect(res.upstream_status).toBe(403);
    expect(res.item_id).toBe("MLB3392752495");
    expect(res.fallback_tools).toEqual(["get_catalog_product_items", "get_item_description"]);
    expect(res.message).toMatch(/get_catalog_product_items/);
  });

  it("getItem 404 propaga como erro (não cai no fallback de 403)", async () => {
    globalThis.fetch = (async () =>
      new Response("{\"message\":\"item not found\"}", { status: 404 })) as typeof fetch;
    await expect(getItem(client(), { item_id: "MLB999" })).rejects.toThrow(/failed \(404\)/);
  });

  it("getItem 500 propaga como erro (não cai no fallback de 403)", async () => {
    globalThis.fetch = (async () =>
      new Response("oops", { status: 500 })) as typeof fetch;
    await expect(getItem(client(), { item_id: "MLB999" })).rejects.toThrow(/failed \(500\)/);
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

  it("getSellerInfo lida com upstream real-world: transactions sem completed/canceled/ratings", async () => {
    // Resposta real do ML em 2026-05-25 pra seller 141321244 (MORGAN.STORE_SP):
    // o bloco `transactions` so traz `period` e `total`. completed/canceled/ratings
    // sao omitidos pelo upstream — parser mapeia esses pra null e o caller deve
    // se basear em reputation_level + power_seller_status + transactions_total.
    globalThis.fetch = mockFetchJson({
      id: 141321244,
      nickname: "MORGAN.STORE_SP",
      permalink: "http://perfil.mercadolivre.com.br/MORGAN.STORE_SP",
      seller_reputation: {
        level_id: "5_green",
        power_seller_status: "platinum",
        transactions: { period: "historic", total: 12126 },
      },
    });
    const res = await getSellerInfo(client(), { seller_id: 141321244 }) as {
      reputation_level: string;
      power_seller_status: string;
      transactions_total: number;
      transactions_completed: number | null;
      transactions_canceled: number | null;
      ratings: unknown;
    };
    expect(res.reputation_level).toBe("5_green");
    expect(res.power_seller_status).toBe("platinum");
    expect(res.transactions_total).toBe(12126);
    expect(res.transactions_completed).toBeNull();
    expect(res.transactions_canceled).toBeNull();
    expect(res.ratings).toBeNull();
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

  it("getCatalogProduct curate attributes whitelist + pictures<=3 + features<=10 + permalink fallback", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({
      id: "MLB1027172667",
      name: "Apple iPhone 15 128GB Azul",
      family_name: "Apple iPhone 15",
      domain_id: "MLB-CELLPHONES",
      permalink: "",
      short_description: { content: "Smartphone com cam 48MP." },
      main_features: Array.from({ length: 15 }, (_, i) => ({ text: `feat ${i}` })),
      attributes: [
        { id: "BRAND", name: "Marca", value_name: "Apple" },
        { id: "MODEL", name: "Modelo", value_name: "iPhone 15" },
        { id: "COLOR", name: "Cor", value_name: "Azul" },
        { id: "INTERNAL_TAG_FOO", name: "internal", value_name: "ignored" },
      ],
      pictures: Array.from({ length: 8 }, (_, i) => ({ secure_url: `https://p${i}` })),
      pickers: [{ picker_id: "COLOR", picker_name: "Cor", products: [{ product_id: "x1" }, { product_id: "x2" }] }],
    }, cap);
    const res = await getCatalogProduct(client(), { catalog_id: "MLB1027172667" }) as {
      key_attributes: Array<{ id: string }>;
      pictures: string[];
      main_features: string[];
      permalink: string;
      short_description: string;
      pickers: Array<{ id: string; variations: number }>;
    };
    expect(cap.value).toContain("/products/MLB1027172667");
    expect(res.key_attributes.map((a) => a.id)).toEqual(["BRAND", "MODEL", "COLOR"]);
    expect(res.pictures.length).toBe(3);
    expect(res.main_features.length).toBe(10);
    expect(res.permalink).toBe("https://www.mercadolivre.com.br/p/MLB1027172667");
    expect(res.short_description).toBe("Smartphone com cam 48MP.");
    expect(res.pickers[0]).toMatchObject({ id: "COLOR", variations: 2 });
  });

  it("getCatalogProductItems curate sellers + default limit=20 + full_fulfillment flag", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({
      paging: { total: 2, offset: 0, limit: 20 },
      results: [
        {
          item_id: "MLB3793882819",
          seller_id: 296064033,
          price: 4999,
          currency_id: "BRL",
          condition: "new",
          warranty: "12 meses",
          listing_type_id: "gold_special",
          category_id: "MLB1055",
          accepts_mercadopago: true,
          tags: ["good_quality_thumbnail"],
          international_delivery_mode: "none",
        },
        {
          item_id: "MLB9999",
          seller_id: 111,
          price: 5099,
          currency_id: "BRL",
          condition: "new",
          warranty: null,
          listing_type_id: "gold",
          accepts_mercadopago: true,
          tags: [],
        },
      ],
    }, cap);
    const res = await getCatalogProductItems(client(), { catalog_id: "MLB1027172667" }) as {
      catalog_id: string;
      results: Array<{ full_fulfillment: boolean; seller_id: number; price: number; warranty: string | null }>;
    };
    expect(cap.value).toContain("/products/MLB1027172667/items");
    expect(cap.value).toContain("limit=20");
    expect(res.catalog_id).toBe("MLB1027172667");
    expect(res.results[0]).toMatchObject({ seller_id: 296064033, price: 4999, full_fulfillment: true });
    expect(res.results[1]).toMatchObject({ seller_id: 111, price: 5099, full_fulfillment: false, warranty: null });
  });

  it("getCatalogProductItems tags_decoded reflete brand_verified/immediate_payment/cart_eligible", async () => {
    globalThis.fetch = mockFetchJson({
      paging: { total: 3 },
      results: [
        { item_id: "MLB1", seller_id: 11, price: 10, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: ["brand_verified", "immediate_payment", "cart_eligible"] },
        { item_id: "MLB2", seller_id: 22, price: 20, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: ["cart_eligible"] },
        { item_id: "MLB3", seller_id: 33, price: 30, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
      ],
    });
    const res = await getCatalogProductItems(client(), { catalog_id: "MLB1" }) as {
      results: Array<{ tags_decoded: { is_official_brand_store: boolean; requires_immediate_payment: boolean; supports_cart: boolean } }>;
    };
    expect(res.results[0].tags_decoded).toEqual({
      is_official_brand_store: true,
      requires_immediate_payment: true,
      supports_cart: true,
    });
    expect(res.results[1].tags_decoded).toEqual({
      is_official_brand_store: false,
      requires_immediate_payment: false,
      supports_cart: true,
    });
    expect(res.results[2].tags_decoded).toEqual({
      is_official_brand_store: false,
      requires_immediate_payment: false,
      supports_cart: false,
    });
  });

  it("getCatalogProductItems tags_decoded vazio quando tags undefined", async () => {
    globalThis.fetch = mockFetchJson({
      paging: { total: 1 },
      results: [{ item_id: "MLB1", seller_id: 11, price: 10, currency_id: "BRL", condition: "new", listing_type_id: "gold" }],
    });
    const res = await getCatalogProductItems(client(), { catalog_id: "MLB1" }) as {
      results: Array<{ tags_decoded: { is_official_brand_store: boolean } }>;
    };
    expect(res.results[0].tags_decoded.is_official_brand_store).toBe(false);
  });

  it("getCatalogProductItems respeita limit max 100", async () => {
    const cap: { value?: string } = {};
    globalThis.fetch = mockFetchJson({ paging: {}, results: [] }, cap);
    await getCatalogProductItems(client(), { catalog_id: "MLB1", limit: 9999 });
    expect(cap.value).toContain("limit=100");
  });

  it("getCatalogProductItems enrich_seller=false (default) NÃO chama /users e mantém shape antigo", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 2 },
          results: [
            { item_id: "MLB1", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
            { item_id: "MLB2", seller_id: 22, price: 110, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), { catalog_id: "MLB1027172667" }) as {
      results: Array<Record<string, unknown>>;
    };
    expect(res.results[0]).not.toHaveProperty("seller");
    expect(urls.filter((u) => u.includes("/users/"))).toHaveLength(0);
  });

  it("getCatalogProductItems enrich_seller=true anexa seller inline (paralelo, 1 call por seller único)", async () => {
    const urls: string[] = [];
    let parallelCounter = 0;
    let maxParallel = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 3 },
          results: [
            { item_id: "MLB1", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
            { item_id: "MLB2", seller_id: 22, price: 110, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
            { item_id: "MLB3", seller_id: 11, price: 120, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
          ],
        }), { status: 200 });
      }
      if (url.includes("/users/")) {
        parallelCounter += 1;
        maxParallel = Math.max(maxParallel, parallelCounter);
        await new Promise((r) => setTimeout(r, 10));
        parallelCounter -= 1;
        const sid = url.match(/\/users\/(\d+)/)?.[1];
        return new Response(JSON.stringify({
          id: Number(sid),
          nickname: `STORE_${sid}`,
          permalink: `http://perfil.mercadolivre.com.br/STORE_${sid}`,
          seller_reputation: {
            level_id: "5_green",
            power_seller_status: "platinum",
            transactions: { total: 1000 },
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), {
      catalog_id: "MLB1027172667",
      enrich_seller: true,
    }) as { results: Array<{ seller_id: number; seller: { nickname: string; reputation_level: string; transactions_total: number; permalink: string } | null }> };
    const userCalls = urls.filter((u) => u.includes("/users/"));
    expect(userCalls).toHaveLength(2); // só 2 sellers únicos (11 e 22), apesar de 3 items
    expect(maxParallel).toBe(2); // chamadas concorrentes, não em série
    expect(res.results[0].seller?.nickname).toBe("STORE_11");
    expect(res.results[1].seller?.nickname).toBe("STORE_22");
    expect(res.results[2].seller?.nickname).toBe("STORE_11"); // mesmo seller que [0]
    expect(res.results[0].seller?.reputation_level).toBe("5_green");
    expect(res.results[0].seller?.transactions_total).toBe(1000);
  });

  it("getCatalogProductItems include_permalink=true constrói permalink determinístico SEM chamar /items/{id}", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 2 },
          results: [
            { item_id: "MLB3392752495", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
            { item_id: "MLB1234567890", seller_id: 22, price: 110, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), {
      catalog_id: "MLB1027172667",
      include_permalink: true,
    }) as { results: Array<{ item_id: string; permalink: string | null; permalink_source: string }> };
    expect(urls.filter((u) => u.match(/\/items\/MLB\d+(?!\/)/))).toHaveLength(0);
    expect(res.results[0].permalink).toBe("https://produto.mercadolivre.com.br/MLB-3392752495");
    expect(res.results[0].permalink_source).toBe("constructed");
    expect(res.results[1].permalink).toBe("https://produto.mercadolivre.com.br/MLB-1234567890");
    expect(res.results[1].permalink_source).toBe("constructed");
  });

  it("getCatalogProductItems include_permalink=false (default) NÃO popula permalink", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify({
        paging: { total: 1 },
        results: [{ item_id: "MLB1", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] }],
      }), { status: 200 });
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), { catalog_id: "MLB1027172667" }) as {
      results: Array<Record<string, unknown>>;
    };
    expect(urls.filter((u) => u.match(/\/items\/MLB\d+(?!\/)/))).toHaveLength(0);
    expect(res.results[0]).not.toHaveProperty("permalink");
    expect(res.results[0]).not.toHaveProperty("permalink_source");
  });

  it("getCatalogProductItems include_permalink=true com item_id malformado (sem prefixo MLB) → permalink null", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 1 },
          results: [
            { item_id: "WEIRD42", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), {
      catalog_id: "MLB1",
      include_permalink: true,
    }) as { results: Array<{ permalink: string | null; permalink_source: string }> };
    expect(res.results[0].permalink).toBeNull();
    expect(res.results[0].permalink_source).toBe("constructed");
  });

  it("getCatalogProductItems enrich_seller=true + include_permalink=true: permalink ainda determinístico, só /users é chamado", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 1 },
          results: [{ item_id: "MLB3392752495", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] }],
        }), { status: 200 });
      }
      if (url.includes("/users/11")) {
        return new Response(JSON.stringify({
          id: 11, nickname: "S",
          seller_reputation: { level_id: "5_green", transactions: { total: 100 } },
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), {
      catalog_id: "MLB1",
      enrich_seller: true,
      include_permalink: true,
    }) as { results: Array<{ permalink: string; permalink_source: string; seller: { nickname: string } | null }> };
    expect(urls.filter((u) => u.match(/\/items\/MLB\d+(?!\/)/))).toHaveLength(0);
    expect(urls.filter((u) => u.includes("/users/11"))).toHaveLength(1);
    expect(res.results[0].permalink).toBe("https://produto.mercadolivre.com.br/MLB-3392752495");
    expect(res.results[0].permalink_source).toBe("constructed");
    expect(res.results[0].seller?.nickname).toBe("S");
  });

  it("getCatalogProductItems enrich_seller=true: falha em UM seller não derruba a request", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/products/") && url.includes("/items")) {
        return new Response(JSON.stringify({
          paging: { total: 2 },
          results: [
            { item_id: "MLB1", seller_id: 11, price: 100, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
            { item_id: "MLB2", seller_id: 99, price: 110, currency_id: "BRL", condition: "new", listing_type_id: "gold", tags: [] },
          ],
        }), { status: 200 });
      }
      if (url.includes("/users/99")) {
        return new Response("server error", { status: 500 });
      }
      if (url.includes("/users/11")) {
        return new Response(JSON.stringify({
          id: 11, nickname: "STORE_11", permalink: "http://x",
          seller_reputation: { level_id: "5_green", transactions: { total: 500 } },
        }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;
    const res = await getCatalogProductItems(client(), {
      catalog_id: "MLB1",
      enrich_seller: true,
    }) as { results: Array<{ seller_id: number; seller: unknown; seller_fetch_error?: string }> };
    expect(res.results[0].seller).toMatchObject({ nickname: "STORE_11" });
    expect(res.results[1].seller).toBeNull();
    expect(res.results[1].seller_fetch_error).toMatch(/500/);
  });
});
