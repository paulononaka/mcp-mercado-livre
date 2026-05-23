# AUDIT — mcp-mercado-livre v0.1.0-paulo

Fork de `@dan1d/mercadolibre-mcp@v1.0.2`. Auditoria aplicada em 2026-05-23, padrão idêntico ao [`mcp-google-maps-paulo` v0.1.0](https://github.com/paulononaka/mcp-google-maps).

## Crivo dos 6 fixes

| # | Fix | Status upstream | Ação Paulo |
|---|---|---|---|
| (a) | TLS verify ON | ✅ `fetch` nativo do Node 22 (TLS verify default). Sem agent custom. Sem `NODE_TLS_REJECT_UNAUTHORIZED=0`. | Mantido. |
| (b) | Timeouts em todos handlers | ✅ Já tinha `AbortSignal.timeout(30000)`. | Reduzi pra 10s (alinha `mcp-google-maps-paulo`). |
| (c) | Sem `console.log` em stdio | ✅ Zero `console.*` em `src/`. Bootstrap escreve só em `stderr` (`console.error`) — stdio em `bin/oauth-bootstrap.mjs` não interfere no MCP stdio (script separado). | Mantido. |
| (d) | Path traversal | ✅ N/A — nenhum tool aceita filepath. Bootstrap escreve apenas em path fixo configurável via env. | N/A. |
| (e) | URLs sempre encoded | ✅ `encodeURIComponent` em todos os path params; `URLSearchParams` nos query params (encode automático). | Mantido em todos os novos paths (incluindo OAuth POST body). |
| (f) | SDK pinado exato | ❌ Upstream usava `^1.27.1` (caret). | Pinei `@modelcontextprotocol/sdk@1.29.0` exato + bump pra última estável (advisory ReDoS GHSA-8r9q-7v3j-jr4g em <1.29.0). |

## Mudanças estruturais (além dos 6 fixes)

| Item | Razão |
|---|---|
| OAuth offline (`authorization_code` + `refresh_token`) | ML descontinuou acesso anônimo aos endpoints públicos em 2026. Probe ao vivo 2026-05-23: 7 de 8 endpoints retornam 403 sem token (`/sites/MLB/search`, `/items/{id}`, `/users/{id}`, `/trends/MLB`, `/sites/MLB/categories`, etc). Único endpoint público: `/categories/{id}`. `client_credentials` grant não é suportado pelo ML. |
| Bootstrap OAuth local (`bin/oauth-bootstrap.mjs`) | Necessário pra obter `refresh_token` inicial. Rodado 1 vez; daí em diante refresh é transparente. |
| Token cache em `~/.config/mercadolivre/token_cache.json` chmod 600 | Persistente entre restarts do gateway Hermes. Refresh atualiza in-place. |
| Default `site_id = MLB` (era MLA upstream) | Paulo opera no Brasil; reduz boilerplate. |
| API low-level `Server` + JSON Schema raw (vs `McpServer.tool()` com zod) | SDK 1.29.0 com Zod 3.25+ trigga `TS2589 (Type instantiation is excessively deep)` quando há ≥2 tools com schemas de muitos campos. Workaround upstream usado pelo `mcp-google-maps-paulo`. Bonus: remove dep zod. |
| Filtros extras em `search_items`: `condition`, `free_shipping`, `sort`, `seller_id` | Caso de uso "Misto" do Paulo — Fran decide filtros via prompt. |
| `get_item` extrai apenas `key_attributes` whitelistadas | Resposta do ML pesada (raw item tem ~30k chars com 50+ attributes). Whitelist (`BRAND`, `MODEL`, `VOLTAGE`, `POWER_SOURCE`, `COLOR`, `CAPACITY`, etc) cobre cenário Paulo (ex: confirmar voltagem 127V vs 220V antes de cotar). |
| `search_items` results curados (~14 campos) | Mesma razão: raw `/sites/MLB/search` retorna ~5-8k chars por item. Curado fica 300-500. Permite default `limit=10` sem estourar contexto Opus. |
| Tests refeitos do zero (44 → 32) | API mudou: novo OAuthManager, novos shapes curados, defaults MLB, low-level Server. 32 cobrem comportamento essencial. 12 cortados eram tests de signature antiga que não existem mais. |

## Vulns conhecidas e aceitas

`npm audit` reporta 14 vulns (2 high, 12 moderate) **todas em devDependencies** (vitest stack: `vite`, `esbuild`, `vite-node`, `hono`, `path-to-regexp`, `qs`). Zero vulns em runtime (`@modelcontextprotocol/sdk`, sem outras deps de runtime).

**Mitigação:** não usar `vitest` em produção. Em CI/dev (`npm test`), o runner roda local-only sem rede exposta.

**Plano de upgrade:** se Vitest 3.x não quebrar tests, bumpar (issue só após smoke E2E estável).

## Histórico de mudanças vs upstream `v1.0.2`

```
src/oauth.ts                                                NEW   (~125 LoC)
src/client.ts                                               REW   (39 → 36)  — OAuthManager + retry 401
src/actions.ts                                              REW   (87 → 175) — filtros search + curate output
src/mcp-server.ts                                           REW   (158 → 158) — low-level Server + JSON Schema raw
src/index.ts                                                REW   (61 → 65)  — createMercadoLibreTools recebe OAuthManager
src/schemas.ts                                              EXT   (39 → 55)  — + OAuthConfig + TokenCache + novos search params
src/errors.ts                                               EXT   (27 → 31)  — + isForbidden
bin/mcp-server.mjs                                          REW   (7 → 8)   — instancia OAuthManager
bin/oauth-bootstrap.mjs                                     NEW   (~90 LoC) — bootstrap HTTP local + browser open + code exchange
README.md                                                   REW
AUDIT.md                                                    NEW
tests/*                                                     REW   (44 → 32) — nova API
package.json                                                MOD   — name, version 0.1.0-paulo, SDK pin exato, zod removido, @types/node added
```

Total LoC: ~411 → ~700 (incluindo bootstrap + OAuth + tests novos).
