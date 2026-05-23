import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS, createMcpServer } from "../src/mcp-server.js";
import { OAuthManager } from "../src/oauth.js";

function fakeOAuth(): OAuthManager {
  return new OAuthManager({
    clientId: "cid",
    clientSecret: "sec",
    accessToken: "AT",
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

describe("TOOL_DEFINITIONS", () => {
  it("expoe exatamente 10 tools com nomes esperados", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_catalog_product",
      "get_catalog_product_items",
      "get_categories",
      "get_category",
      "get_currency_conversion",
      "get_item",
      "get_item_description",
      "get_seller_info",
      "get_trends",
      "search_items",
    ]);
  });

  it("search_items tem required=[query] + filtros opcionais documentados", () => {
    const t = TOOL_DEFINITIONS.find((x) => x.name === "search_items");
    const schema = t?.inputSchema as { required?: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["query"]);
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining([
      "query", "site_id", "category", "price_min", "price_max",
      "condition", "free_shipping", "sort", "seller_id", "limit", "offset",
    ]));
  });

  it("get_item, get_item_description, get_category, get_seller_info, get_currency_conversion tem required", () => {
    const expected: Record<string, string[]> = {
      get_item: ["item_id"],
      get_item_description: ["item_id"],
      get_category: ["category_id"],
      get_seller_info: ["seller_id"],
      get_currency_conversion: ["from", "to"],
      get_catalog_product: ["catalog_id"],
      get_catalog_product_items: ["catalog_id"],
    };
    for (const [name, required] of Object.entries(expected)) {
      const t = TOOL_DEFINITIONS.find((x) => x.name === name);
      const schema = t?.inputSchema as { required?: string[] };
      expect(schema.required).toEqual(required);
    }
  });
});

describe("createMcpServer", () => {
  it("retorna Server (low-level) sem lancar", () => {
    const server = createMcpServer(fakeOAuth());
    expect(server).toBeDefined();
  });
});
