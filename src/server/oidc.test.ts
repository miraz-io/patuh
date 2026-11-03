import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createUser } from "./auth.js";
import { openDb } from "./db.js";
import { oidcFromEnv, userForSso, verifyIdToken } from "./oidc.js";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" }] } as never;
const want = { issuer: "https://idp.example", clientId: "patuh", nonce: "n1", now: 1_800_000_000_000 };
const claims = { iss: "https://idp.example", aud: "patuh", exp: 1_800_000_600, nonce: "n1", email: "a@x.id" };

function sign(c: object, o: { key?: typeof privateKey; kid?: string; alg?: string } = {}) {
  const head = b64({ alg: o.alg ?? "RS256", kid: o.kid ?? "k1" }), data = `${head}.${b64(c)}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(o.key ?? privateKey).toString("base64url")}`;
}

describe("ID token verification", () => {
  it("accepts a valid token", () => expect(verifyIdToken(sign(claims), jwks, want).email).toBe("a@x.id"));
  it("rejects wrong nonce, issuer, audience", () => {
    expect(() => verifyIdToken(sign({ ...claims, nonce: "other" }), jwks, want)).toThrow(/nonce/);
    expect(() => verifyIdToken(sign({ ...claims, iss: "https://evil.example" }), jwks, want)).toThrow(/issuer/);
    expect(() => verifyIdToken(sign({ ...claims, aud: "someone-else" }), jwks, want)).toThrow(/audience/);
    expect(() => verifyIdToken(sign({ ...claims, aud: ["patuh", "x"] }), jwks, want)).toThrow(/audience/); // multiple audiences need azp
    expect(verifyIdToken(sign({ ...claims, aud: ["patuh", "x"], azp: "patuh" }), jwks, want).email).toBe("a@x.id");
  });
  it("rejects expired and not-yet-valid tokens", () => {
    expect(() => verifyIdToken(sign({ ...claims, exp: 1_700_000_000 }), jwks, want)).toThrow(/expired/);
    expect(() => verifyIdToken(sign({ ...claims, exp: undefined }), jwks, want)).toThrow(/expired/);
    expect(() => verifyIdToken(sign({ ...claims, nbf: 1_900_000_000 }), jwks, want)).toThrow(/not yet/);
  });
  it("rejects a token signed with another key, or a tampered payload", () => {
    expect(() => verifyIdToken(sign(claims, { key: other.privateKey }), jwks, want)).toThrow(/signature/);
    const [h, , s] = sign(claims).split(".");
    expect(() => verifyIdToken(`${h}.${b64({ ...claims, email: "admin@x.id" })}.${s}`, jwks, want)).toThrow(/signature/);
  });
  it("rejects alg none, HMAC downgrade, unknown kid and garbage", () => {
    expect(() => verifyIdToken(`${b64({ alg: "none" })}.${b64(claims)}.`, jwks, want)).toThrow(/algorithm/);
    const data = `${b64({ alg: "HS256", kid: "k1" })}.${b64(claims)}`;
    expect(() => verifyIdToken(`${data}.${createHmac("sha256", "secret").update(data).digest("base64url")}`, jwks, want)).toThrow(/algorithm/);
    expect(() => verifyIdToken(sign(claims, { kid: "nope" }), jwks, want)).toThrow(/key not found/);
    expect(() => verifyIdToken("not.a.jwt.at.all", jwks, want)).toThrow(/Malformed/);
  });
});

describe("SSO configuration", () => {
  const base = { PATUH_OIDC_ISSUER: "https://idp.example/", PATUH_OIDC_CLIENT_ID: "c", PATUH_OIDC_CLIENT_SECRET: "s", PATUH_PUBLIC_URL: "https://patuh.example" };
  it("is off when no issuer is set", () => expect(oidcFromEnv({})).toBeNull());
  it("builds the redirect URI and normalises the issuer", () => {
    expect(oidcFromEnv({ ...base, PATUH_OIDC_ALLOWED_DOMAINS: "X.id, y.id" })).toMatchObject({ issuer: "https://idp.example", redirectUri: "https://patuh.example/api/auth/oidc/callback", allowedDomains: ["x.id", "y.id"] });
  });
  it("refuses plain http except on localhost, and missing secrets", () => {
    expect(() => oidcFromEnv({ ...base, PATUH_OIDC_ISSUER: "http://idp.example" })).toThrow(/https/);
    expect(() => oidcFromEnv({ ...base, PATUH_PUBLIC_URL: "http://patuh.example" })).toThrow(/https/);
    expect(oidcFromEnv({ ...base, PATUH_PUBLIC_URL: "http://localhost:8080" })).not.toBeNull();
    expect(() => oidcFromEnv({ PATUH_OIDC_ISSUER: "https://idp.example" })).toThrow(/needs/);
  });
});

describe("which users SSO may sign in", () => {
  const id = { email: "sso@x.id", sub: "abc", iss: "https://idp.example" };
  it("signs in an SSO-only user and binds them to that provider account", async () => {
    const db = openDb(":memory:");
    await createUser(db, { email: "sso@x.id", name: "S", role: "auditor", password: null });
    expect(userForSso(db, id)?.email).toBe("sso@x.id");
    expect(userForSso(db, id)?.email).toBe("sso@x.id"); // same account again
    expect(userForSso(db, { ...id, sub: "someone-else" })).toBeNull(); // same email, different provider account
    expect(userForSso(db, { ...id, iss: "https://other.example" })).toBeNull();
  });
  it("never lets a provider-asserted email take over a password user", async () => {
    const db = openDb(":memory:");
    await createUser(db, { email: "admin@x.id", name: "A", role: "admin", password: "a long enough password" });
    expect(userForSso(db, { ...id, email: "admin@x.id" })).toBeNull();
  });
  it("does not create users and skips disabled ones", async () => {
    const db = openDb(":memory:");
    expect(userForSso(db, id)).toBeNull();
    await createUser(db, { email: "sso@x.id", name: "S", role: "auditor", password: null });
    db.prepare("UPDATE users SET disabled=1").run();
    expect(userForSso(db, id)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) n FROM users").get()).toEqual({ n: 1 });
  });
});
