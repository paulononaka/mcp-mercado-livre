export interface SearchItemsParams {
  query: string;
  site_id?: string;
  category?: string;
  price_min?: number;
  price_max?: number;
  limit?: number;
  offset?: number;
  condition?: "new" | "used" | "not_specified";
  free_shipping?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc";
  seller_id?: number;
}

export interface GetItemParams {
  item_id: string;
}

export interface GetItemDescriptionParams {
  item_id: string;
}

export interface GetCategoriesParams {
  site_id?: string;
}

export interface GetCategoryParams {
  category_id: string;
}

export interface GetSellerInfoParams {
  seller_id: number;
}

export interface GetTrendsParams {
  site_id?: string;
}

export interface GetCurrencyConversionParams {
  from: string;
  to: string;
  amount?: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  tokenCachePath?: string;
}

export interface TokenCache {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
