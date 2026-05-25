# mcp-mercado-livre (Paulo fork)

Fork de [`@dan1d/mercadolibre-mcp`](https://github.com/dan1d/mercadolibre-mcp) `v1.0.2` com adaptações pra uso no Hermes Agent (Fran Casanha — Paulo Nonaka).

**Mudanças em relação ao upstream** (detalhe completo em [`AUDIT.md`](./AUDIT.md)):

1. **OAuth offline obrigatório** — `authorization_code` + `refresh_token` (ML descontinuou acesso anônimo aos endpoints públicos em 2026; só `/categories/{id}` ficou aberto).
2. **Bootstrap OAuth local** — `bin/oauth-bootstrap.mjs` sobe HTTP server, abre browser pra autorizar, captura code, troca por tokens, salva em `~/.config/mercadolivre/token_cache.json` chmod 600.
3. **Refresh transparente** — `src/oauth.ts` `OAuthManager` faz refresh quando token entra no skew (60s antes de expirar). Retry 1x em 401 com `forceRefresh`.
4. **Default site_id = MLB** (era MLA upstream) — Paulo é Brasil.
5. **Filtros extras em `search_items`** — `condition`, `free_shipping`, `sort`, `seller_id` (além de `category`/`price_min/max`).
6. **Output curado** — `search_items` retorna ~14 campos por resultado (vs raw JSON do ML); `get_item` extrai só `key_attributes` whitelistadas (`VOLTAGE`, `POWER_SOURCE`, `BRAND`, `MODEL`, `COLOR`, `CAPACITY`, etc) e trunca pictures a 5.
7. **SDK pinado exato** — `@modelcontextprotocol/sdk@1.29.0` (sem caret).
8. **API low-level** — `Server` + `setRequestHandler` (mesmo padrão do `mcp-google-maps-paulo`), evita deep inference do `McpServer.tool()`.

## Pré-requisitos

- Node 22+ (`--env-file` nativo).
- Conta Mercado Livre + App criada em `https://developers.mercadolivre.com.br/devcenter/` com `CLIENT_ID` + `CLIENT_SECRET`.

## Setup

1. Criar `/Users/fran/.config/mercadolivre/.env` (chmod 600):
   ```dotenv
   MERCADOLIBRE_CLIENT_ID=...
   MERCADOLIBRE_CLIENT_SECRET=...
   MERCADOLIBRE_REDIRECT_URI=http://localhost:8080/callback
   ```
   (Não preencha `MERCADOLIBRE_REFRESH_TOKEN` — o bootstrap vai gravar em `token_cache.json`.)

2. Bootstrap OAuth (uma vez):
   ```bash
   cd /Users/fran/codes/mcp-mercado-livre
   node --env-file=/Users/fran/.config/mercadolivre/.env bin/oauth-bootstrap.mjs
   ```
   Vai abrir browser pra você autorizar a App acessar sua conta. Tokens salvos em `~/.config/mercadolivre/token_cache.json` (chmod 600). Refresh_token vale ~6 meses.

3. Build:
   ```bash
   npm install && npm run build
   ```

4. Registrar no Hermes (`~/.hermes/config.yaml`):
   ```yaml
   mcp_servers:
     mercado-livre:
       command: node
       args:
         - --env-file=/Users/fran/.config/mercadolivre/.env
         - /Users/fran/codes/mcp-mercado-livre/dist/mcp-server.js
       env:
         DOTENV_CONFIG_QUIET: "true"
   ```
   *Nota: o entrypoint correto é `bin/mcp-server.mjs`, mas dele importa `dist/mcp-server.js`. Pode usar diretamente `bin/mcp-server.mjs` se preferir — ambos funcionam.*

## Tools expostas

| Tool | O que faz |
|---|---|
| `search_items` | Busca por palavra-chave + filtros (condition, free_shipping, sort, seller_id, price range, category). Default site MLB. |
| `get_item` | Detalhes do item + `key_attributes` curados (VOLTAGE/BRAND/MODEL/etc) + max 5 pictures. |
| `get_item_description` | Descrição em texto plano. |
| `get_categories` | Top-level categories de um site. |
| `get_category` | Detalhes de uma categoria (path + children). |
| `get_seller_info` | Reputação + transactions + ratings do vendedor. |
| `get_trends` | Buscas em alta. |
| `get_currency_conversion` | Conversão BRL/USD/ARS/MXN com rate ML. |

## Limitações conhecidas

### `search_items` retorna 403 desde 2025

O ML restringiu `GET /sites/MLB/search` pra apps não-aprovadas (confirmado por múltiplos devs no Reclame Aqui ago/2025–jan/2026). Apps com OAuth válido + CNPJ + escopo correto continuam recebendo 403.

A tool detecta o 403 e retorna objeto estruturado em vez de propagar erro cru:

```json
{
  "error": "search_endpoint_restricted",
  "message": "ML restringiu /sites/MLB/search desde 2025 ...",
  "upstream_status": 403,
  "fallback_tools": ["get_catalog_product", "get_catalog_product_items", "get_item"],
  "docs": "https://developers.mercadolivre.com.br/"
}
```

**Caminho recomendado:** usar busca externa (`web_search` ou Google `site:mercadolivre.com.br`) pra descobrir o `catalog_id` (formato `MLB...`), depois consultar via `get_catalog_product` + `get_catalog_product_items` (com `enrich_seller=true` e `include_permalink=true` se precisar de reputação/URL inline).

### `get_item` retorna 403 desde 2026

Em maio/2026 o ML estendeu a restrição que aplicou em `/sites/MLB/search` (2025) também pro endpoint `/items/{id}`. Probe live 2026-05-25 confirmou 403 com `access_denied` em todos os items testados, mesmo com OAuth + escopo válidos.

A tool detecta o 403 e retorna objeto estruturado em vez de propagar erro cru:

```json
{
  "error": "item_endpoint_restricted",
  "message": "ML restringiu /items/{id} para apps não-aprovadas. Os dados disponíveis sem este endpoint são preço, vendedor, condition, warranty, listing_type e tags (via get_catalog_product_items). Para descrição completa, use get_item_description que ainda funciona.",
  "upstream_status": 403,
  "item_id": "MLB...",
  "fallback_tools": ["get_catalog_product_items", "get_item_description"],
  "docs": "https://developers.mercadolivre.com.br/"
}
```

**Caminho recomendado:** `get_catalog_product_items` cobre preço, vendedor, condition, warranty, listing_type e tags por item (sem `/items/{id}`). `get_item_description` ainda funciona se precisar do texto completo do anúncio.

### `get_catalog_product_items` permalinks: construídos (best-effort)

Como `/items/{id}` retorna 403, `include_permalink=true` constrói a URL deterministicamente a partir do `item_id` em vez de chamar o upstream:

- `MLB3392752495` → `https://produto.mercadolivre.com.br/MLB-3392752495`

O campo `permalink_source: "constructed"` documenta isso. Resolve em >95% dos anúncios; lojas oficiais com slug customizado podem 301 — abrem ainda assim. Item IDs sem prefixo `MLB` (outros sites) retornam `permalink: null`.

### `get_seller_info`: 3 campos quase sempre `null`

Confirmado via probe live em 2026-05-25 pra 4 sellers distintos (`141321244`, `175345466`, `296064033`, `213475298`): o upstream `GET /users/{id}` retorna `seller_reputation.transactions` com no máximo `period` e `total`. Os campos `transactions_completed`, `transactions_canceled` e `ratings` (positive/neutral/negative) simplesmente **não existem** na resposta pra apps externas — o ML não os expõe a consumidores fora da conta dona do anúncio.

**Use como sinal de qualidade do vendedor:**
- `reputation_level` (`"5_green"` é o topo; depois `"4_light_green"`, `"3_yellow"`, `"2_orange"`, `"1_red"`)
- `power_seller_status` (`"platinum"` > `"gold"` > `"silver"` > `null`)
- `transactions_total` (volume histórico)
- `nickname` + `permalink` (loja oficial ≠ revendedor)

**Ignore:** `transactions_completed`, `transactions_canceled`, `ratings` (null na maioria dos casos).

## Test

```bash
npm test
```

## License

MIT (mesmo do upstream).
