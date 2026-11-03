import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const port = Number(process.env.PATUH_PORT ?? 8080);
// Compliance data is sensitive: localhost only by default. Put it behind your own SSO/reverse proxy to share.
const hostname = process.env.PATUH_HOST ?? "127.0.0.1";
serve({ fetch: createApp(openDb(process.env.PATUH_DB ?? "data/patuh.db")).fetch, port, hostname });
console.log(`Patuh running on http://${hostname}:${port}`);
