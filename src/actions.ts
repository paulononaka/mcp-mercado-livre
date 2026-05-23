import { MercadoLibreClient } from "./client.js";
import type {
  SearchItemsParams,
  GetItemParams,
  GetItemDescriptionParams,
  GetCategoriesParams,
  GetCategoryParams,
  GetSellerInfoParams,
  GetTrendsParams,
  GetCurrencyConversionParams,
} from "./schemas.js";

const DEFAULT_SITE_ID = "MLB";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

const KEY_ATTRIBUTE_IDS = new Set([
  "BRAND",
  "MODEL",
  "VOLTAGE",
  "POWER_SUPPLY",
  "POWER_SOURCE",
  "ENERGY_SOURCE",
  "ITEM_CONDITION",
  "GTIN",
  "MANUFACTURER",
  "WARRANTY",
  "LINE",
  "MODEL_NUMBER",
  "COLOR",
  "MAIN_COLOR",
  "CAPACITY",
  "STORAGE_CAPACITY",
  "RAM_MEMORY",
  "DISPLAY_SIZE",
  "WEIGHT",
  "PACKAGE_LENGTH",
]);

interface RawSearchItem {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  currency_id?: string;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  permalink?: string;
  thumbnail?: string;
  shipping?: { free_shipping?: boolean; mode?: string; logistic_type?: string };
  seller?: { id?: number; nickname?: string };
  installments?: { quantity?: number; amount?: number; rate?: number } | null;
  catalog_listing?: boolean;
  attributes?: Array<{ id?: string; name?: string; value_name?: string }>;
}

interface RawAttribute {
  id?: string;
  name?: string;
  value_name?: string | null;
  value_id?: string | null;
}

interface RawSeller {
  id?: number;
  nickname?: string;
  permalink?: string;
  seller_reputation?: {
    level_id?: string;
    power_seller_status?: string;
    transactions?: {
      completed?: number;
      canceled?: number;
      total?: number;
      ratings?: { positive?: number; neutral?: number; negative?: number };
    };
  };
}

export async function searchItems(
  client: MercadoLibreClient,
  params: SearchItemsParams
): Promise<unknown> {
  const siteId = params.site_id ?? DEFAULT_SITE_ID;
  const qp: Record<string, string> = { q: params.query };
  if (params.category) qp.category = params.category;
  if (params.price_min !== undefined) qp.price_min = String(params.price_min);
  if (params.price_max !== undefined) qp.price_max = String(params.price_max);
  if (params.condition) qp.condition = params.condition;
  if (params.free_shipping) qp.shipping_cost = "free";
  if (params.sort) qp.sort = params.sort;
  if (params.seller_id !== undefined) qp.seller_id = String(params.seller_id);
  const limit = Math.min(params.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  qp.limit = String(limit);
  if (params.offset !== undefined) qp.offset = String(params.offset);
  const raw = await client.get<{ paging?: Record<string, unknown>; results?: RawSearchItem[] }>(
    `/sites/${encodeURIComponent(siteId)}/search`,
    qp
  );
  const results = (raw.results ?? []).map((it) => ({
    id: it.id,
    title: it.title,
    price: it.price,
    original_price: it.original_price ?? null,
    currency_id: it.currency_id,
    condition: it.condition,
    available_quantity: it.available_quantity,
    sold_quantity: it.sold_quantity,
    free_shipping: it.shipping?.free_shipping ?? false,
    logistic_type: it.shipping?.logistic_type,
    seller_id: it.seller?.id,
    seller_nickname: it.seller?.nickname,
    catalog_listing: it.catalog_listing ?? false,
    permalink: it.permalink,
    thumbnail: it.thumbnail,
  }));
  return {
    site_id: siteId,
    query: params.query,
    paging: raw.paging,
    results,
  };
}

export async function getItem(
  client: MercadoLibreClient,
  params: GetItemParams
): Promise<unknown> {
  const raw = await client.get<Record<string, unknown>>(
    `/items/${encodeURIComponent(params.item_id)}`
  );
  const attrs = (raw.attributes as RawAttribute[] | undefined) ?? [];
  const curated = attrs
    .filter((a) => a.id && KEY_ATTRIBUTE_IDS.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, value: a.value_name }));
  const pictures = (raw.pictures as Array<{ secure_url?: string; url?: string }> | undefined) ?? [];
  return {
    id: raw.id,
    title: raw.title,
    price: raw.price,
    original_price: raw.original_price ?? null,
    currency_id: raw.currency_id,
    condition: raw.condition,
    available_quantity: raw.available_quantity,
    sold_quantity: raw.sold_quantity,
    permalink: raw.permalink,
    category_id: raw.category_id,
    seller_id: raw.seller_id,
    warranty: raw.warranty ?? null,
    listing_type_id: raw.listing_type_id,
    free_shipping: (raw.shipping as { free_shipping?: boolean } | undefined)?.free_shipping ?? false,
    pictures: pictures.slice(0, 5).map((p) => p.secure_url ?? p.url).filter(Boolean),
    key_attributes: curated,
  };
}

export async function getItemDescription(
  client: MercadoLibreClient,
  params: GetItemDescriptionParams
): Promise<unknown> {
  const raw = await client.get<{ plain_text?: string; text?: string; last_updated?: string }>(
    `/items/${encodeURIComponent(params.item_id)}/description`
  );
  return {
    item_id: params.item_id,
    plain_text: raw.plain_text ?? raw.text ?? "",
    last_updated: raw.last_updated,
  };
}

export async function getCategories(
  client: MercadoLibreClient,
  params?: GetCategoriesParams
): Promise<unknown> {
  const siteId = params?.site_id ?? DEFAULT_SITE_ID;
  return client.get(`/sites/${encodeURIComponent(siteId)}/categories`);
}

export async function getCategory(
  client: MercadoLibreClient,
  params: GetCategoryParams
): Promise<unknown> {
  return client.get(`/categories/${encodeURIComponent(params.category_id)}`);
}

export async function getSellerInfo(
  client: MercadoLibreClient,
  params: GetSellerInfoParams
): Promise<unknown> {
  const raw = await client.get<RawSeller>(`/users/${encodeURIComponent(String(params.seller_id))}`);
  const rep = raw.seller_reputation;
  return {
    id: raw.id,
    nickname: raw.nickname,
    permalink: raw.permalink,
    reputation_level: rep?.level_id ?? null,
    power_seller_status: rep?.power_seller_status ?? null,
    transactions_completed: rep?.transactions?.completed ?? null,
    transactions_canceled: rep?.transactions?.canceled ?? null,
    transactions_total: rep?.transactions?.total ?? null,
    ratings: rep?.transactions?.ratings ?? null,
  };
}

export async function getTrends(
  client: MercadoLibreClient,
  params?: GetTrendsParams
): Promise<unknown> {
  const siteId = params?.site_id ?? DEFAULT_SITE_ID;
  return client.get(`/trends/${encodeURIComponent(siteId)}`);
}

export async function getCurrencyConversion(
  client: MercadoLibreClient,
  params: GetCurrencyConversionParams
): Promise<unknown> {
  const result = await client.get<{ ratio: number }>(
    `/currency_conversions/search`,
    { from: params.from, to: params.to }
  );
  const amount = params.amount ?? 1;
  return {
    from: params.from,
    to: params.to,
    rate: result.ratio,
    amount,
    converted: Number((amount * result.ratio).toFixed(4)),
  };
}
