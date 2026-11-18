import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DatabaseSync } from "node:sqlite";

export type Role = "admin" | "dpo" | "member" | "auditor";
export type User = { id: number; email: string; name: string; role: Role; department_id: number | null };
export const ROLES: Role[] = ["admin", "dpo", "member", "auditor"];

// ---- passwords (scrypt, per-user salt) ----
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const N = 32768, R = 8, P = 1, LEN = 64, OPTS = { N, r: R, p: P, maxmem: 128 * 1024 * 1024 };
export const MIN_PASSWORD = 12;

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (pw.length > 256) return "Password is too long";
  return null;
}
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${(await scryptAsync(pw, salt, LEN, OPTS)).toString("base64")}`;
}
const DUMMY = hashPassword("dummy-password-for-timing");
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the same work, so unknown users and SSO-only users are not distinguishable by response time.
  const [scheme, n, r, p, salt, hash] = (stored ?? (await DUMMY)).split("$");
  if (scheme !== "scrypt") return false;
  const got = await scryptAsync(pw, Buffer.from(salt, "base64"), LEN, { N: +n, r: +r, p: +p, maxmem: OPTS.maxmem });
  const want = Buffer.from(hash, "base64");
  return stored !== null && got.length === want.length && timingSafeEqual(got, want);
}

// ---- sessions (random token in an HttpOnly cookie; only its hash is stored) ----
export const SESSION_COOKIE = "patuh_session";
export const SESSION_MS = 12 * 3600_000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const hashToken = sha;

export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()); // housekeeping
  db.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
export function userForSession(db: DatabaseSync, token: string | undefined): User | null {
  if (!token) return null;
  return (db.prepare(`SELECT u.id,u.email,u.name,u.role,u.department_id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(sha(token), Date.now()) as User | undefined) ?? null;
}
export const endSession = (db: DatabaseSync, token: string) => void db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(token));

// ---- login throttling ----
// ponytail: in-memory, resets on restart, one server. Behind several servers use a shared store.
// Keys are "email|ip" (MAX_FAILS) and "ip|x" (IP_MAX_FAILS). Failures older than LOCK_MS stop counting.
const fails = new Map<string, { n: number; until: number; since: number }>();
export const MAX_FAILS = 5, IP_MAX_FAILS = 30, LOCK_MS = 15 * 60_000;
export const isLocked = (key: string) => (fails.get(key)?.until ?? 0) > Date.now();
export function recordFail(key: string, max = MAX_FAILS) {
  const now = Date.now();
  if (fails.size > 10_000) for (const [k, v] of fails) if (v.until < now && now - v.since > LOCK_MS) fails.delete(k); // bound memory
  if (fails.size > 100_000) fails.clear();
  const f = fails.get(key) ?? { n: 0, until: 0, since: now };
  if (now - f.since > LOCK_MS && f.until < now) { f.n = 0; f.since = now; }
  f.n += 1; if (f.n >= max) { f.until = now + LOCK_MS; f.n = 0; f.since = now; }
  fails.set(key, f);
}
export const clearFails = (key: string) => void fails.delete(key);
export const refundFail = (key: string) => { const f = fails.get(key); if (f && f.n > 0) f.n -= 1; }; // a successful sign-in does not count against the IP
// Per account (existing accounts only), from any address. Final design, see SECURITY.md for the tradeoff:
// - only FAILED verifications count; after ACCT_FREE failures every further try from an unknown address must wait
//   min(30 s, 1 s per extra failure) after the previous failure (429 + Retry-After). It is a pause, never a lock.
// - an email+IP pair that signed in successfully before is never held back by this counter, so an attacker hammering
//   the account cannot lock the owner out of their usual address (the pair and IP limits above still apply to everyone).
// - unknown emails get no entry here (fake emails cannot fill the map); only expired entries are evicted, and when the map is still
//   full new accounts are simply not tracked (they fall back to the pair and IP limits).
const accts = new Map<string, { n: number; since: number; next: number }>();
const goodPairs = new Map<string, number>(); // "email|ip" -> expires
export const ACCT_FREE = 10, ACCT_STEP_MS = 1000, ACCT_MAX_MS = 30_000, PAIR_TTL_MS = 30 * 86_400_000;
export const limits = { cap: 10_000 }; // adjustable for tests
const fresh = (e: { since: number }, now: number) => now - e.since < LOCK_MS;
/** Milliseconds this caller must wait before trying this account again; 0 = go ahead. */
export function accountGate(key: string, pair: string): number {
  const now = Date.now(), e = accts.get(key);
  if (!e || !fresh(e, now) || now >= e.next) return 0;
  if ((goodPairs.get(pair) ?? 0) > now) return 0;
  return e.next - now;
}
export function accountFail(key: string) {
  const now = Date.now(); let e = accts.get(key);
  if (!e || !fresh(e, now)) {
    if (!e) { // new entry: make room by dropping expired ones only; if still full, do not track
      if (accts.size >= limits.cap) for (const [k, v] of accts) if (!fresh(v, now)) accts.delete(k);
      if (accts.size >= limits.cap) return;
    }
    e = { n: 0, since: now, next: 0 }; accts.set(key, e);
  }
  e.n += 1; e.next = now + Math.min(ACCT_MAX_MS, Math.max(0, e.n - ACCT_FREE) * ACCT_STEP_MS);
}
export const accountFails = (key: string) => accts.get(key)?.n ?? 0;
/** A correct password: forget the failures and remember this email+IP as a known place of the owner. */
export function accountOk(key: string, pair: string) {
  accts.delete(key);
  const now = Date.now();
  if (goodPairs.size >= limits.cap) for (const [k, v] of goodPairs) if (v <= now) goodPairs.delete(k);
  if (goodPairs.size < limits.cap || goodPairs.has(pair)) goodPairs.set(pair, now + PAIR_TTL_MS);
}
export const resetThrottle = () => { fails.clear(); accts.clear(); goodPairs.clear(); }; // for tests

// ---- permissions ----
// admin and dpo: everything. member: only their own department. auditor: read everything, change nothing.
export const canRead = (u: User, dept: number) => u.role !== "member" || u.department_id === dept;
export const canWrite = (u: User, dept: number) => u.role === "admin" || u.role === "dpo" || (u.role === "member" && u.department_id === dept);
export const canSignOff = (u: User) => u.role === "admin" || u.role === "dpo";

// ---- users ----
export function findUserByEmail(db: DatabaseSync, email: string) {
  return db.prepare("SELECT id,email,name,role,department_id,password_hash,sso_sub,disabled FROM users WHERE email=?").get(email.trim()) as
    (User & { password_hash: string | null; sso_sub: string | null; disabled: number }) | undefined;
}
export async function createUser(db: DatabaseSync, u: { email: string; name: string; role: Role; departmentId?: number | null; password?: string | null }): Promise<number> {
  const email = u.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Invalid email");
  if (!u.name.trim() || u.name.length > 200) throw new Error("Name is required");
  if (!ROLES.includes(u.role)) throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
  if (u.role === "member" && !u.departmentId) throw new Error("A member must belong to a department");
  if (findUserByEmail(db, email)) throw new Error("A user with this email already exists");
  if (u.password) { const bad = passwordProblem(u.password); if (bad) throw new Error(bad); }
  const hash = u.password ? await hashPassword(u.password) : null;
  return Number(db.prepare("INSERT INTO users (email,name,role,department_id,password_hash) VALUES (?,?,?,?,?)")
    .run(email, u.name.trim(), u.role, u.departmentId ?? null, hash).lastInsertRowid);
}
export async function setPassword(db: DatabaseSync, email: string, password: string) {
  const bad = passwordProblem(password); if (bad) throw new Error(bad);
  const user = findUserByEmail(db, email); if (!user) throw new Error("No such user");
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await hashPassword(password), user.id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id); // a password change signs the user out everywhere
}
