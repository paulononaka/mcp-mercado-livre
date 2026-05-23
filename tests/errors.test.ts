import { describe, it, expect } from "vitest";
import { MercadoLibreError } from "../src/errors.js";

describe("MercadoLibreError", () => {
  it("inclui method/path/status na mensagem", () => {
    const err = new MercadoLibreError("GET", "/x", 500, "boom");
    expect(err.message).toContain("GET /x failed (500)");
    expect(err.body).toBe("boom");
  });

  it("status flags isUnauthorized/isForbidden/isNotFound/isRateLimited", () => {
    expect(new MercadoLibreError("GET", "/x", 401, "").isUnauthorized).toBe(true);
    expect(new MercadoLibreError("GET", "/x", 403, "").isForbidden).toBe(true);
    expect(new MercadoLibreError("GET", "/x", 404, "").isNotFound).toBe(true);
    expect(new MercadoLibreError("GET", "/x", 429, "").isRateLimited).toBe(true);
  });
});
