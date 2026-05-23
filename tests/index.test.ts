import { describe, it, expect } from "vitest";
import {
  createMercadoLibreTools,
  MercadoLibreClient,
  MercadoLibreError,
  OAuthManager,
  OAuthError,
  exchangeAuthorizationCode,
  searchItems,
  getItem,
} from "../src/index.js";

describe("public exports", () => {
  it("expoe funcoes e classes esperadas", () => {
    expect(typeof createMercadoLibreTools).toBe("function");
    expect(typeof MercadoLibreClient).toBe("function");
    expect(typeof MercadoLibreError).toBe("function");
    expect(typeof OAuthManager).toBe("function");
    expect(typeof OAuthError).toBe("function");
    expect(typeof exchangeAuthorizationCode).toBe("function");
    expect(typeof searchItems).toBe("function");
    expect(typeof getItem).toBe("function");
  });

  it("createMercadoLibreTools retorna 8 tools wired", () => {
    const oauth = new OAuthManager({ clientId: "c", clientSecret: "s", accessToken: "t", expiresAt: Date.now() + 60000 });
    const { tools } = createMercadoLibreTools(oauth);
    expect(Object.keys(tools).sort()).toEqual([
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
});
