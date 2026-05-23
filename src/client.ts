import { MercadoLibreError } from "./errors.js";
import { OAuthManager } from "./oauth.js";

const BASE_URL = "https://api.mercadolibre.com";
const REQUEST_TIMEOUT_MS = 10000;

export class MercadoLibreClient {
  private oauth: OAuthManager;

  constructor(oauth: OAuthManager) {
    this.oauth = oauth;
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${BASE_URL}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    const doFetch = async (token: string): Promise<Response> =>
      fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    let token = await this.oauth.getAccessToken();
    let res = await doFetch(token);
    if (res.status === 401) {
      token = await this.oauth.forceRefresh();
      res = await doFetch(token);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new MercadoLibreError("GET", path, res.status, body);
    }
    return res.json() as Promise<T>;
  }
}
