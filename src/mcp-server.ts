import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMercadoLibreTools } from "./index.js";
import { OAuthManager } from "./oauth.js";
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

const SEARCH_ITEMS_TOOL: Tool = {
  name: "search_items",
  description: "Busca produtos no MercadoLibre por palavra-chave. ATENÇÃO: o ML restringiu /sites/MLB/search desde 2025 — apps não-aprovadas recebem 403 e a tool devolve {error:'search_endpoint_restricted', fallback_tools:[...]}. Caminho recomendado: usar busca externa (web_search/Google) com `site:mercadolivre.com.br` pra descobrir o catalog_id (formato MLB...), depois chamar get_catalog_product, get_catalog_product_items ou get_item. Default site_id=MLB. Filtros: category, price_min/max, condition (new/used), free_shipping, sort (relevance|price_asc|price_desc), seller_id. Retorna lista curada (max 50, default 10) quando o endpoint responde 200.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Texto da busca" },
      site_id: { type: "string", description: "Site ID (default: MLB). MLB=Brasil, MLA=Argentina, MLM=Mexico, MLC=Chile, MCO=Colombia" },
      category: { type: "string", description: "Category ID pra filtrar (ex: MLB1055)" },
      price_min: { type: "number", description: "Preco minimo" },
      price_max: { type: "number", description: "Preco maximo" },
      condition: { type: "string", enum: ["new", "used", "not_specified"], description: "Condicao do item" },
      free_shipping: { type: "boolean", description: "Apenas itens com frete gratis" },
      sort: { type: "string", enum: ["relevance", "price_asc", "price_desc"], description: "Ordenacao (default: relevance)" },
      seller_id: { type: "number", description: "Filtrar por seller especifico" },
      limit: { type: "number", description: "Max resultados (default 10, max 50)" },
      offset: { type: "number", description: "Pagination offset" },
    },
    required: ["query"],
  },
};

const GET_ITEM_TOOL: Tool = {
  name: "get_item",
  description: "Detalhes completos de um item MercadoLibre: title, price, stock, seller, condition, pictures (max 5) e key_attributes curados (BRAND, MODEL, VOLTAGE, POWER_SOURCE, COLOR, CAPACITY, etc).",
  inputSchema: {
    type: "object",
    properties: { item_id: { type: "string", description: "Item ID (ex: MLB1234567890)" } },
    required: ["item_id"],
  },
};

const GET_ITEM_DESCRIPTION_TOOL: Tool = {
  name: "get_item_description",
  description: "Texto completo da descricao de um item MercadoLibre (plain_text).",
  inputSchema: {
    type: "object",
    properties: { item_id: { type: "string", description: "Item ID" } },
    required: ["item_id"],
  },
};

const GET_CATEGORIES_TOOL: Tool = {
  name: "get_categories",
  description: "Lista todas as categorias top-level de um site MercadoLibre. Default site_id=MLB.",
  inputSchema: {
    type: "object",
    properties: { site_id: { type: "string", description: "Site ID (default: MLB)" } },
  },
};

const GET_CATEGORY_TOOL: Tool = {
  name: "get_category",
  description: "Detalhes de uma categoria: nome, path from root, e children.",
  inputSchema: {
    type: "object",
    properties: { category_id: { type: "string", description: "Category ID (ex: MLB1055)" } },
    required: ["category_id"],
  },
};

const GET_SELLER_INFO_TOOL: Tool = {
  name: "get_seller_info",
  description: "Perfil do vendedor: reputation_level, power_seller_status, transactions_completed/canceled/total, ratings (positive/neutral/negative).",
  inputSchema: {
    type: "object",
    properties: { seller_id: { type: "number", description: "Seller user ID" } },
    required: ["seller_id"],
  },
};

const GET_TRENDS_TOOL: Tool = {
  name: "get_trends",
  description: "Buscas em alta no MercadoLibre pra um site/pais. Default site_id=MLB.",
  inputSchema: {
    type: "object",
    properties: { site_id: { type: "string", description: "Site ID (default: MLB)" } },
  },
};

const GET_CURRENCY_CONVERSION_TOOL: Tool = {
  name: "get_currency_conversion",
  description: "Conversao entre moedas usando rates do MercadoLibre (BRL, ARS, MXN, USD, etc).",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Moeda origem (ex: USD)" },
      to: { type: "string", description: "Moeda destino (ex: BRL)" },
      amount: { type: "number", description: "Quantia a converter (default: 1)" },
    },
    required: ["from", "to"],
  },
};

const GET_CATALOG_PRODUCT_TOOL: Tool = {
  name: "get_catalog_product",
  description: "Metadata canonica de um produto do catalogo ML (URL formato .../p/MLB<id>). Retorna name, family_name, key_attributes curados (BRAND/MODEL/VOLTAGE/COLOR/etc), main_features (max 10), pictures (max 3), permalink, pickers (variacoes color/voltage/etc). USE QUANDO: URL do Google retorna .../p/MLB... ou /products/MLB...",
  inputSchema: {
    type: "object",
    properties: {
      catalog_id: { type: "string", description: "Catalog product ID (ex: MLB1027172667)" },
    },
    required: ["catalog_id"],
  },
};

const GET_CATALOG_PRODUCT_ITEMS_TOOL: Tool = {
  name: "get_catalog_product_items",
  description: "Lista TODOS os sellers que vendem aquele produto do catalogo, com price/condition/warranty/listing_type/full_fulfillment. Default limit=20 (max 100). USE QUANDO: quer comparar precos entre sellers do MESMO produto canonico. Use enrich_seller=true pra incluir reputation/transactions/permalink inline (chamadas paralelas a /users/{seller_id}; evita N+1 get_seller_info quando voce ja precisa avaliar reputacao). Tags conhecidas em cada item: cart_eligible (compra via carrinho), immediate_payment (pagamento obrigatorio no checkout), brand_verified (loja oficial verificada), good_quality_thumbnail (ML validou imagem principal), standard_price_by_quantity (preco escalonado por volume), kvs_primary (anuncio principal do produto na busca), dynamic_standard_price (preco dinamico), has_published_clips (videos), user_product_unify (anuncio unificado), best_seller_candidate (forte candidato a destaque), incomplete_technical_specs (atributos faltando), supermarket_eligible (elegivel mercado online).",
  inputSchema: {
    type: "object",
    properties: {
      catalog_id: { type: "string", description: "Catalog product ID (ex: MLB1027172667)" },
      limit: { type: "number", description: "Max sellers a retornar (default 20, max 100)" },
      offset: { type: "number", description: "Pagination offset" },
      enrich_seller: { type: "boolean", description: "Se true, anexa objeto seller (nickname, reputation_level, power_seller_status, transactions_total, permalink) em cada item via chamadas paralelas. Falha em um seller especifico deixa seller:null + seller_fetch_error. Default false." },
      include_permalink: { type: "boolean", description: "Se true, anexa campo permalink em cada item via chamadas paralelas a /items/{item_id}. Default false." },
    },
    required: ["catalog_id"],
  },
};

export const TOOL_DEFINITIONS: Tool[] = [
  SEARCH_ITEMS_TOOL,
  GET_ITEM_TOOL,
  GET_ITEM_DESCRIPTION_TOOL,
  GET_CATEGORIES_TOOL,
  GET_CATEGORY_TOOL,
  GET_SELLER_INFO_TOOL,
  GET_TRENDS_TOOL,
  GET_CURRENCY_CONVERSION_TOOL,
  GET_CATALOG_PRODUCT_TOOL,
  GET_CATALOG_PRODUCT_ITEMS_TOOL,
];

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

async function wrap<T>(fn: () => Promise<T>): Promise<ToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function createMcpServer(oauth: OAuthManager): Server {
  const { tools } = createMercadoLibreTools(oauth);

  const server = new Server(
    { name: "mcp-mercado-livre", version: "0.1.0-paulo" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    switch (name) {
      case "search_items":
        return wrap(() => tools.search_items(args as unknown as SearchItemsParams));
      case "get_item":
        return wrap(() => tools.get_item(args as unknown as GetItemParams));
      case "get_item_description":
        return wrap(() => tools.get_item_description(args as unknown as GetItemDescriptionParams));
      case "get_categories":
        return wrap(() => tools.get_categories(args as unknown as GetCategoriesParams));
      case "get_category":
        return wrap(() => tools.get_category(args as unknown as GetCategoryParams));
      case "get_seller_info":
        return wrap(() => tools.get_seller_info(args as unknown as GetSellerInfoParams));
      case "get_trends":
        return wrap(() => tools.get_trends(args as unknown as GetTrendsParams));
      case "get_currency_conversion":
        return wrap(() => tools.get_currency_conversion(args as unknown as GetCurrencyConversionParams));
      case "get_catalog_product":
        return wrap(() => tools.get_catalog_product(args as unknown as GetCatalogProductParams));
      case "get_catalog_product_items":
        return wrap(() => tools.get_catalog_product_items(args as unknown as GetCatalogProductItemsParams));
      default:
        return {
          content: [{ type: "text", text: `Tool desconhecido: ${name}` }],
          isError: true,
        };
    }
  });

  return server;
}
