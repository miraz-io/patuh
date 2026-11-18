// Secrets at rest: AES-256-GCM. The key comes from PATUH_SECRET, or from a 0600 key file next to the database
// (created on first use, never in the repo). In-memory databases (tests) get a random key per process.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getSetting, setSetting } from "./db.js";

const PREFIX = "enc1:";
const memKeys = new WeakMap<DatabaseSync, Buffer>();

function keyFor(db: DatabaseSync): Buffer {
  if (process.env.PATUH_SECRET) return createHash("sha256").update(process.env.PATUH_SECRET).digest();
  const loc = db.location();
  if (!loc) { let k = memKeys.get(db); if (!k) memKeys.set(db, (k = randomBytes(32))); return k; }
  const file = join(dirname(loc), "patuh.key");
  if (!existsSync(file)) { writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 }); }
  try { chmodSync(file, 0o600); } catch { /* not supported on this platform */ }
  return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
}

export function encrypt(db: DatabaseSync, plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyFor(db), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(db: DatabaseSync, stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const b = Buffer.from(stored.slice(PREFIX.length), "base64");
    const d = createDecipheriv("aes-256-gcm", keyFor(db), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; } // wrong PATUH_SECRET or lost key file
}

/** The AI key. PATUH_AI_API_KEY counts only together with PATUH_AI_BASE_URL (aiConfig then uses that address too), so an admin cannot point the operator's key at another host.
 *  Otherwise the encrypted setting; plaintext left by older versions is encrypted on first read. */
export function getApiKey(db: DatabaseSync): string {
  if (process.env.PATUH_AI_API_KEY && process.env.PATUH_AI_BASE_URL) return process.env.PATUH_AI_API_KEY;
  const v = getSetting(db, "ai_api_key");
  if (!v) return "";
  if (!v.startsWith(PREFIX)) { setSetting(db, "ai_api_key", encrypt(db, v)); return v; }
  return decrypt(db, v) ?? "";
}
export const setApiKey = (db: DatabaseSync, key: string) => setSetting(db, "ai_api_key", key ? encrypt(db, key) : "");
export const hasApiKey = (db: DatabaseSync) => !!getApiKey(db);
