import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const port = Number(process.env.PATUH_PORT ?? 8080);
// Compliance data is sensitive: localhost only by default. Put it behind your own SSO/reverse proxy to share.
const hostname = process.env.PATUH_HOST ?? "127.0.0.1";
const app = createApp(openDb(process.env.PATUH_DB ?? "data/patuh.db"));
app.use("*", serveStatic({ root: "./dist/web" })); // built UI (npm run build); single-page, no client routing
serve({ fetch: app.fetch, port, hostname });
console.log(`Patuh running on http://${hostname}:${port}`);
