#!/usr/bin/env node
// Bootstrap OAuth offline: abre browser pra usuario autorizar a App ML, captura code,
// troca por access_token + refresh_token, salva em ~/.config/mercadolivre/token_cache.json.
//
// Pre-req env (.env via --env-file ou shell):
//   MERCADOLIBRE_CLIENT_ID
//   MERCADOLIBRE_CLIENT_SECRET
//   MERCADOLIBRE_REDIRECT_URI   (default http://localhost:8080/callback)
//   MERCADOLIBRE_AUTH_HOST      (default https://auth.mercadolivre.com.br — MLB)
//   MERCADOLIBRE_BOOTSTRAP_PORT (default 8080)
//   MERCADOLIBRE_TOKEN_CACHE    (default ~/.config/mercadolivre/token_cache.json)
//
// Uso:
//   node --env-file=/Users/fran/.config/mercadolivre/.env bin/oauth-bootstrap.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { URL } from "node:url";
import { exchangeAuthorizationCode } from "../dist/oauth.js";

const CLIENT_ID = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI = process.env.MERCADOLIBRE_REDIRECT_URI ?? "http://localhost:8080/callback";
const AUTH_HOST = process.env.MERCADOLIBRE_AUTH_HOST ?? "https://auth.mercadolivre.com.br";
const PORT = Number(process.env.MERCADOLIBRE_BOOTSTRAP_PORT ?? 8080);
const CACHE_PATH = process.env.MERCADOLIBRE_TOKEN_CACHE ?? `${homedir()}/.config/mercadolivre/token_cache.json`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERRO: MERCADOLIBRE_CLIENT_ID e MERCADOLIBRE_CLIENT_SECRET sao obrigatorios.");
  console.error("Crie .env em /Users/fran/.config/mercadolivre/.env com CLIENT_ID e CLIENT_SECRET.");
  process.exit(2);
}

const redirectUrl = new URL(REDIRECT_URI);
if (redirectUrl.port && Number(redirectUrl.port) !== PORT) {
  console.error(`AVISO: MERCADOLIBRE_BOOTSTRAP_PORT=${PORT} mas REDIRECT_URI=${REDIRECT_URI} aponta pra porta ${redirectUrl.port}. Bootstrap usara porta ${redirectUrl.port}.`);
}
const listenPort = Number(redirectUrl.port) || PORT;

const authUrl = new URL("/authorization", AUTH_HOST);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);

const codePromise = new Promise((resolve, reject) => {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${listenPort}`);
      if (url.pathname !== redirectUrl.pathname) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end("missing code");
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<h1>OK</h1><p>Autorizacao recebida. Pode fechar essa aba.</p>");
      server.close();
      resolve(code);
    } catch (err) {
      reject(err);
    }
  });
  server.on("error", reject);
  server.listen(listenPort, "127.0.0.1");
});

console.error(`[bootstrap] HTTP server escutando em 127.0.0.1:${listenPort}${redirectUrl.pathname}`);
console.error(`[bootstrap] Abrindo browser pra autorizar:`);
console.error(`            ${authUrl.toString()}`);
console.error(`[bootstrap] Se o browser nao abrir, cola a URL acima manualmente.`);

const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
spawn(openCmd, [authUrl.toString()], { stdio: "ignore", detached: true }).on("error", () => {
  // ignore — usuario pode abrir manualmente
});

const code = await codePromise;
console.error(`[bootstrap] code recebido, trocando por access_token + refresh_token...`);

const tokens = await exchangeAuthorizationCode({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  code,
  redirectUri: REDIRECT_URI,
});

await mkdir(dirname(CACHE_PATH), { recursive: true });
await writeFile(CACHE_PATH, JSON.stringify(tokens, null, 2), "utf8");
await chmod(CACHE_PATH, 0o600);

const expiresInSec = Math.max(0, Math.floor((tokens.expires_at - Date.now()) / 1000));
console.error(`[bootstrap] OK. Tokens salvos em ${CACHE_PATH} (chmod 600).`);
console.error(`[bootstrap] access_token expira em ${expiresInSec}s; refresh_token valido por ~6 meses.`);
console.error(`[bootstrap] Daqui em diante o MCP refresha sozinho.`);
