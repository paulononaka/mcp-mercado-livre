import { MercadoLibreClient } from "./client.js";
import { MercadoLibreError } from "./errors.js";
import type {
  SearchItemsParams,
  GetItemParams,
  GetItemDescriptionParams,
  GetCategoriesParams,
  GetCategoryParams,
  GetSellerInfoParams,
  GetTrendsParams,
  GetCurrencyConversionParams,
  GetCatalogProductParams,
  GetCatalogProductItemsParams,
} from "./schemas.js";

const DEFAULT_SITE_ID = "MLB";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

// Dicionário de tags conhecidas observadas em /products/{id}/items.
// Mapeia o slug opaco do ML pro que ele significa em PT-BR — referência
// pro caller saber o que olhar pra recomendação. As 3 tags acionáveis
// (`brand_verified`, `immediate_payment`, `cart_eligible`) são decodificadas
// em `tags_decoded` no output de `get_catalog_product_items`.
const CATALOG_ITEM_TAG_DOC: Record<string, string> = {
  brand_verified: "vendedor é loja oficial verificada da marca",
  cart_eligible: "anúncio aceita compra via carrinho",
  immediate_payment: "pagamento obrigatório no checkout",
  good_quality_thumbnail: "ML validou qualidade da imagem principal",
  standard_price_by_quantity: "vendedor oferece preço escalonado por volume",
  kvs_primary: "anúncio principal do produto na busca (key value seller)",
  dynamic_standard_price: "preço dinâmico (ajusta com base em demanda/concorrência)",
  has_published_clips: "anúncio tem vídeos publicados",
  user_product_unify: "anúncio unificado (várias listings agrupadas)",
  best_seller_candidate: "forte candidato a destaque na categoria",
  incomplete_technical_specs: "atributos técnicos faltando no anúncio",
  supermarket_eligible: "elegível pro Mercado Online (supermercado)",
};

interface DecodedTags {
  is_official_brand_store: boolean;
  requires_immediate_payment: boolean;
  supports_cart: boolean;
}

function decodeTags(tags: string[] | undefined): DecodedTags {
  const t = tags ?? [];
  return {
    is_official_brand_store: t.includes("brand_verified"),
    requires_immediate_payment: t.includes("immediate_payment"),
    supports_cart: t.includes("cart_eligible"),
  };
}

export { CATALOG_ITEM_TAG_DOC };

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
  let raw: { paging?: Record<string, unknown>; results?: RawSearchItem[] };
  try {
    raw = await client.get<{ paging?: Record<string, unknown>; results?: RawSearchItem[] }>(
      `/sites/${encodeURIComponent(siteId)}/search`,
      qp
    );
  } catch (err) {
    if (err instanceof MercadoLibreError && err.isForbidden) {
      return {
        error: "search_endpoint_restricted",
        message:
          "ML restringiu /sites/MLB/search desde 2025 para apps não-aprovadas. Use busca externa (Google, web_search) para descobrir o catalog_id (formato MLB...), depois consulte via get_catalog_product, get_catalog_product_items ou get_item.",
        upstream_status: 403,
        fallback_tools: ["get_catalog_product", "get_catalog_product_items", "get_item"],
        docs: "https://developers.mercadolivre.com.br/",
      };
    }
    throw err;
  }
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
  let raw: Record<string, unknown>;
  try {
    raw = await client.get<Record<string, unknown>>(
      `/items/${encodeURIComponent(params.item_id)}`
    );
  } catch (err) {
    if (err instanceof MercadoLibreError && err.isForbidden) {
      return {
        error: "item_endpoint_restricted",
        message:
          "ML restringiu /items/{id} para apps não-aprovadas. Os dados disponíveis sem este endpoint são preço, vendedor, condition, warranty, listing_type e tags (via get_catalog_product_items). Para descrição completa, use get_item_description que ainda funciona.",
        upstream_status: 403,
        item_id: params.item_id,
        fallback_tools: ["get_catalog_product_items", "get_item_description"],
        docs: "https://developers.mercadolivre.com.br/",
      };
    }
    throw err;
  }
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

// Limitação confirmada via probe live (2026-05-25, 4 sellers diferentes):
// o upstream `GET /users/{id}` devolve `seller_reputation.transactions` com
// no máximo `period` e `total`. Os campos `completed`, `canceled` e
// `ratings` simplesmente NÃO existem na resposta pra apps externas (mesmo
// com OAuth válido + CNPJ + escopo correto). Não é bug do parser — o ML
// não expõe esses dados a consumidores fora da conta dona do anúncio.
// Campos confiáveis pra avaliar vendedor:
//   - reputation_level ("5_green" é o topo)
//   - power_seller_status ("platinum" > "gold" > "silver" > null)
//   - transactions_total (volume histórico)
// Campos quase sempre null (não usar como sinal):
//   - transactions_completed, transactions_canceled, ratings
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

interface RawCatalogProduct {
  id?: string;
  name?: string;
  family_name?: string;
  domain_id?: string;
  permalink?: string;
  short_description?: { content?: string } | string | null;
  main_features?: Array<{ text?: string } | string>;
  attributes?: RawAttribute[];
  pictures?: Array<{ secure_url?: string; url?: string }>;
  pickers?: Array<{ picker_id?: string; picker_name?: string; products?: Array<{ product_id?: string; picker_label?: string }> }>;
  release_info?: unknown;
  date_created?: string;
  last_updated?: string;
}

interface RawCatalogItem {
  item_id?: string;
  seller_id?: number;
  price?: number;
  currency_id?: string;
  condition?: string;
  warranty?: string | null;
  listing_type_id?: string;
  category_id?: string;
  accepts_mercadopago?: boolean;
  tags?: string[];
  international_delivery_mode?: string;
}

export async function getCatalogProduct(
  client: MercadoLibreClient,
  params: GetCatalogProductParams
): Promise<unknown> {
  const raw = await client.get<RawCatalogProduct>(
    `/products/${encodeURIComponent(params.catalog_id)}`
  );
  const attrs = raw.attributes ?? [];
  const curated = attrs
    .filter((a) => a.id && KEY_ATTRIBUTE_IDS.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, value: a.value_name }));
  const pictures = (raw.pictures ?? [])
    .slice(0, 3)
    .map((p) => p.secure_url ?? p.url)
    .filter((v): v is string => Boolean(v));
  const features = (raw.main_features ?? [])
    .map((f) => (typeof f === "string" ? f : f.text ?? ""))
    .filter((s) => s.length > 0)
    .slice(0, 10);
  const shortDesc =
    typeof raw.short_description === "string"
      ? raw.short_description
      : raw.short_description?.content ?? null;
  const pickers = (raw.pickers ?? []).map((p) => ({
    id: p.picker_id,
    name: p.picker_name,
    variations: (p.products ?? []).length,
  }));
  return {
    id: raw.id,
    name: raw.name,
    family_name: raw.family_name,
    domain_id: raw.domain_id,
    permalink: raw.permalink || `https://www.mercadolivre.com.br/p/${raw.id}`,
    short_description: shortDesc,
    main_features: features,
    key_attributes: curated,
    pictures,
    pickers,
  };
}

interface CuratedSeller {
  id: number | undefined;
  nickname: string | null;
  reputation_level: string | null;
  power_seller_status: string | null;
  transactions_total: number | null;
  permalink: string | null;
}

interface SellerEnrichment {
  seller: CuratedSeller | null;
  error?: string;
}

interface PermalinkEnrichment {
  permalink: string | null;
  error?: string;
}

async function fetchItemPermalink(
  client: MercadoLibreClient,
  itemId: string
): Promise<PermalinkEnrichment> {
  try {
    const raw = await client.get<{ permalink?: string }>(`/items/${encodeURIComponent(itemId)}`);
    return { permalink: raw.permalink ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { permalink: null, error: message };
  }
}

async function fetchSellerEnrichment(
  client: MercadoLibreClient,
  sellerId: number
): Promise<SellerEnrichment> {
  try {
    const raw = await client.get<RawSeller>(`/users/${encodeURIComponent(String(sellerId))}`);
    const rep = raw.seller_reputation;
    return {
      seller: {
        id: raw.id,
        nickname: raw.nickname ?? null,
        reputation_level: rep?.level_id ?? null,
        power_seller_status: rep?.power_seller_status ?? null,
        transactions_total: rep?.transactions?.total ?? null,
        permalink: raw.permalink ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { seller: null, error: message };
  }
}

export async function getCatalogProductItems(
  client: MercadoLibreClient,
  params: GetCatalogProductItemsParams
): Promise<unknown> {
  const qp: Record<string, string> = {};
  const limit = Math.min(params.limit ?? 20, 100);
  qp.limit = String(limit);
  if (params.offset !== undefined) qp.offset = String(params.offset);
  const raw = await client.get<{ paging?: Record<string, unknown>; results?: RawCatalogItem[] }>(
    `/products/${encodeURIComponent(params.catalog_id)}/items`,
    qp
  );
  const results: Array<Record<string, unknown>> = (raw.results ?? []).map((it) => ({
    item_id: it.item_id,
    seller_id: it.seller_id,
    price: it.price,
    currency_id: it.currency_id,
    condition: it.condition,
    warranty: it.warranty ?? null,
    listing_type: it.listing_type_id,
    full_fulfillment: it.listing_type_id === "gold_special" || (it.tags ?? []).includes("brand_verified"),
    international: it.international_delivery_mode && it.international_delivery_mode !== "none",
    accepts_mercadopago: it.accepts_mercadopago,
    tags: it.tags,
    tags_decoded: decodeTags(it.tags),
  }));

  const enrichmentTasks: Array<Promise<unknown>> = [];

  if (params.enrich_seller) {
    const uniqueSellerIds = Array.from(
      new Set(
        results
          .map((r) => r.seller_id)
          .filter((v): v is number => typeof v === "number")
      )
    );
    enrichmentTasks.push(
      (async () => {
        const entries = await Promise.all(
          uniqueSellerIds.map(async (sid) => [sid, await fetchSellerEnrichment(client, sid)] as const)
        );
        const enrichmentBySeller = new Map<number, SellerEnrichment>(entries);
        for (const r of results) {
          const sid = r.seller_id;
          if (typeof sid !== "number") continue;
          const entry = enrichmentBySeller.get(sid);
          if (!entry) continue;
          r.seller = entry.seller;
          if (entry.error) r.seller_fetch_error = entry.error;
        }
      })()
    );
  }

  if (params.include_permalink) {
    enrichmentTasks.push(
      (async () => {
        const itemIds = results
          .map((r) => r.item_id)
          .filter((v): v is string => typeof v === "string");
        const entries = await Promise.all(
          itemIds.map(async (iid) => [iid, await fetchItemPermalink(client, iid)] as const)
        );
        const permalinkByItem = new Map<string, PermalinkEnrichment>(entries);
        for (const r of results) {
          const iid = r.item_id;
          if (typeof iid !== "string") continue;
          const entry = permalinkByItem.get(iid);
          if (!entry) continue;
          r.permalink = entry.permalink;
          if (entry.error) r.permalink_fetch_error = entry.error;
        }
      })()
    );
  }

  if (enrichmentTasks.length) {
    await Promise.all(enrichmentTasks);
  }

  return {
    catalog_id: params.catalog_id,
    paging: raw.paging,
    results,
  };
}
