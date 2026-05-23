#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../dist/mcp-server.js";
import { OAuthManager } from "../dist/oauth.js";

const oauth = await OAuthManager.fromEnv(process.env);
const server = createMcpServer(oauth);
const transport = new StdioServerTransport();
await server.connect(transport);
