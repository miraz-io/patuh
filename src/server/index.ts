import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { oidcFromEnv } from "./oidc.js";
import { importLibraryDir } from "./library.js";

const port = Number(process.env.PATUH_PORT ?? 8080);
// Compliance data is sensitive: localhost only by default. For a team, set PATUH_HOST and put HTTPS in front.
const hostname = process.env.PATUH_HOST ?? "127.0.0.1";
const db = openDb(process.env.PATUH_DB ?? "data/patuh.db");
const lib = importLibraryDir(db, process.env.PATUH_LIBRARY ?? "library"); // unchanged files are skipped, so this is cheap on every start
const secure = (process.env.PATUH_PUBLIC_URL ?? "").startsWith("https://");
const app = createApp(db, { oidc: oidcFromEnv(), secureCookies: secure });
app.use("*", serveStatic({ root: "./dist/web" })); // built UI (npm run build); single-page, no client routing
serve({ fetch: app.fetch, port, hostname });
console.log(`Patuh running on http://${hostname}:${port}  (library: ${lib.sources} sources, ${lib.units} units)`);
if (!(db.prepare("SELECT 1 FROM users LIMIT 1").get())) console.log("No users yet. Create the first admin with:  npm run admin -- init");
if (hostname !== "127.0.0.1" && !secure) console.warn("Warning: listening beyond localhost without an https PATUH_PUBLIC_URL. Put HTTPS in front before real use.");
