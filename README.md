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

## Test

```bash
npm test
```

## License

MIT (mesmo do upstream).
