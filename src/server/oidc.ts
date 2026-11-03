// Generic OpenID Connect login (authorization code + PKCE), no dependencies.
// Works with any provider that publishes /.well-known/openid-configuration and signs ID tokens with RS256
// (Entra ID, Okta, Keycloak, Google, Auth0, Authentik...). ID tokens are verified here, not trusted blindly.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { findUserByEmail, hashToken, type User } from "./auth.js";

export type OidcConfig = {
  issuer: string; clientId: string; clientSecret: string; redirectUri: string;
  allowedDomains: string[];
};

export function oidcFromEnv(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  if (!env.PATUH_OIDC_ISSUER) return null;
  const { PATUH_OIDC_CLIENT_ID: clientId, PATUH_OIDC_CLIENT_SECRET: clientSecret, PATUH_PUBLIC_URL: pub } = env;
  if (!clientId || !clientSecret || !pub) throw new Error("SSO needs PATUH_OIDC_ISSUER, PATUH_OIDC_CLIENT_ID, PATUH_OIDC_CLIENT_SECRET and PATUH_PUBLIC_URL");
  const issuer = env.PATUH_OIDC_ISSUER.replace(/\/$/, "");
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
  for (const u of [issuer, pub]) if (!u.startsWith("https://") && !local.test(u)) throw new Error(`${u} must use https`);
  return {
    issuer, clientId, clientSecret, redirectUri: `${pub.replace(/\/$/, "")}/api/auth/oidc/callback`,
    allowedDomains: (env.PATUH_OIDC_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
  };
}

type Jwk = { kid?: string; kty: string; use?: string; [k: string]: unknown };
type Claims = { sub?: string; iss?: string; aud?: string | string[]; azp?: string; exp?: number; nbf?: number; nonce?: string; email?: string; email_verified?: boolean; name?: string };
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export function verifyIdToken(token: string, jwks: { keys: Jwk[] }, want: { issuer: string; clientId: string; nonce: string; now?: number }): Claims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const header = b64json(parts[0]);
  if (header.alg !== "RS256") throw new Error("Unsupported ID token algorithm"); // rejects "none" and HMAC downgrade tricks
  const rsa = jwks.keys.filter((k) => k.kty === "RSA" && (!k.use || k.use === "sig"));
  const jwk = header.kid ? rsa.find((k) => k.kid === header.kid) : rsa.length === 1 ? rsa[0] : undefined;
  if (!jwk) throw new Error("Signing key not found");
  const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as never, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("Bad ID token signature");
  const c = b64json(parts[1]) as Claims;
  const now = (want.now ?? Date.now()) / 1000;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== want.issuer) throw new Error("Wrong issuer");
  if (!aud.includes(want.clientId) || (aud.length > 1 && c.azp !== want.clientId)) throw new Error("Wrong audience");
  if (typeof c.exp !== "number" || c.exp < now - 60) throw new Error("ID token expired");
  if (typeof c.nbf === "number" && c.nbf > now + 60) throw new Error("ID token not yet valid");
  if (c.nonce !== want.nonce) throw new Error("Wrong nonce");
  return c;
}

const getJson = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json() as Promise<Record<string, any>>;
};

let discovery: { at: number; doc: Record<string, any> } | null = null;
async function meta(cfg: OidcConfig) {
  if (discovery && Date.now() - discovery.at < 3600_000) return discovery.doc;
  const doc = await getJson(`${cfg.issuer}/.well-known/openid-configuration`);
  if (String(doc.issuer).replace(/\/$/, "") !== cfg.issuer) throw new Error("Issuer in discovery document does not match config");
  discovery = { at: Date.now(), doc };
  return doc;
}

export async function startLogin(db: DatabaseSync, cfg: OidcConfig): Promise<{ url: string; state: string }> {
  const doc = await meta(cfg);
  const state = randomBytes(24).toString("base64url"), nonce = randomBytes(24).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  db.prepare("DELETE FROM oidc_flows WHERE expires_at < ?").run(Date.now());
  if ((db.prepare("SELECT COUNT(*) n FROM oidc_flows").get() as { n: number }).n >= 1000) throw new Error("Too many pending sign-ins");
  db.prepare("INSERT INTO oidc_flows (state_hash,nonce,verifier,expires_at) VALUES (?,?,?,?)").run(hashToken(state), nonce, verifier, Date.now() + 10 * 60_000);
  const u = new URL(doc.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: "openid email profile",
    state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { url: u.toString(), state };
}

export async function finishLogin(db: DatabaseSync, cfg: OidcConfig, code: string, state: string): Promise<{ email: string; name: string; sub: string; iss: string }> {
  const flow = db.prepare("SELECT nonce,verifier,expires_at FROM oidc_flows WHERE state_hash=?").get(hashToken(state)) as { nonce: string; verifier: string; expires_at: number } | undefined;
  db.prepare("DELETE FROM oidc_flows WHERE state_hash=?").run(hashToken(state)); // one use only
  if (!flow || flow.expires_at < Date.now()) throw new Error("Login expired, please try again");
  const doc = await meta(cfg);
  const tok = await getJson(doc.token_endpoint, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: flow.verifier }) });
  if (typeof tok.id_token !== "string") throw new Error("Provider returned no ID token");
  const claims = verifyIdToken(tok.id_token, await getJson(doc.jwks_uri) as { keys: Jwk[] }, { issuer: String(doc.issuer), clientId: cfg.clientId, nonce: flow.nonce });
  const email = claims.email?.trim().toLowerCase();
  if (!email) throw new Error("Provider did not share an email address");
  if (claims.email_verified === false) throw new Error("Email address is not verified at the provider");
  if (cfg.allowedDomains.length && !cfg.allowedDomains.includes(email.split("@")[1])) throw new Error("This email domain is not allowed");
  if (!claims.sub) throw new Error("ID token has no subject");
  return { email, name: claims.name?.trim() || email, sub: claims.sub, iss: String(claims.iss) };
}

// Who may sign in with SSO: only a user an admin created for SSO (no password), and always the same provider account.
// An email asserted by the provider never grants access to a password user (that would let anyone who can set an
// email at a lenient provider become the admin), and it never creates users.
export function userForSso(db: DatabaseSync, id: { email: string; sub: string; iss: string }): User | null {
  const u = findUserByEmail(db, id.email);
  if (!u || u.disabled || u.password_hash !== null) return null;
  const bound = `${id.iss}|${id.sub}`;
  if (u.sso_sub && u.sso_sub !== bound) return null;
  if (!u.sso_sub) db.prepare("UPDATE users SET sso_sub=? WHERE id=? AND sso_sub IS NULL").run(bound, u.id);
  return { id: u.id, email: u.email, name: u.name, role: u.role, department_id: u.department_id };
}
