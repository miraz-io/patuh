import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { DatabaseSync } from "node:sqlite";
import { CRITERIA, screen } from "../core/screening.js";
import { needsPriorConsultation, riskLevel } from "../core/risk.js";
import { dpiaBuffer, type Activity, type Lang, type RiskRow } from "../core/dpia.js";
import { hasApiKey, setApiKey } from "./secret.js";
import { ipGroup } from "./net.js";
import { createActivity, getSetting, setSetting, updateActivity } from "./db.js";
import { AiError, aiConfig, aiUrlProblem, complete, completeUsage, createFromDraft, draftMessages, extractJson, logInteraction, purgeAiText, setMeta, type AiConfig, type Turn } from "./ai.js";
import { activityState, runAgent } from "./agent.js";
import { decide } from "./proposals.js";
import { getUnit, listSources, searchLibrary } from "./library.js";
import { REQUIRED_FIELDS, questionFor } from "../core/completeness.js";
import { SESSION_COOKIE, SESSION_MS, canRead, canSignOff, canWrite, clearFails, createSession, endSession, findUserByEmail,
  IP_MAX_FAILS, accountFail, accountGate, accountOk, isLocked, recordFail, refundFail, userForSession, verifyPassword, type User } from "./auth.js";
import { finishLogin, startLogin, userForSso, type OidcConfig } from "./oidc.js";
import { demoLoaded } from "./demo.js";
import { buildOverview, type OvActivity, type OvControl, type OvRisk } from "../core/overview.js";
import { SIGNOFF_FIELDS, cleanActivity, date, text } from "./validate.js";

type Env = { Variables: { user: User } };
type Q = Record<string, string | number | null>;
export type AppOptions = { oidc?: OidcConfig | null; secureCookies?: boolean; aiFetch?: typeof fetch };

const all = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as Q[];
const one = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as Q | undefined;
const err = (c: Context, status: 400 | 401 | 403 | 404 | 429 | 502, msg: string) => c.json({ error: msg }, status);
const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? null) as Record<string, unknown> | null;
const isObj = (b: unknown): b is Record<string, unknown> => !!b && typeof b === "object" && !Array.isArray(b);
/** ASCII file name from the process name, so downloads are recognisable and header-safe. */
export const fileSlug = (s: string) => s.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "process";
const int = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : NaN);

// Behind a reverse proxy set PATUH_TRUST_PROXY=1 so the client address comes from X-Forwarded-For (the last hop, which the proxy appended).
const clientIp = (c: Context): string => {
  if (process.env.PATUH_TRUST_PROXY === "1") { const x = c.req.header("x-forwarded-for")?.split(",").pop()?.trim(); if (x) return x.slice(0, 64); }
  return ((c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "unknown").slice(0, 64);
};
const originOf = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };

export function createApp(db: DatabaseSync, opts: AppOptions = {}) {
  const app = new Hono<Env>();
  const oidc = opts.oidc ?? null;
  let hashing = 0, aiBusy = 0;
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, secure: !!opts.secureCookies, path: "/" };

  app.use("*", secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"] },
    referrerPolicy: "no-referrer", xFrameOptions: "DENY",
  }));

  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));

  // CSRF: a browser cannot add this header to a cross-site request without a CORS preflight, which we never allow.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-requested-with") !== "patuh") return err(c, 403, "Missing x-requested-with header");
    await next();
  });
  // Audit trail: who changed what and when (never the request body, which may hold passwords).
  app.use("/api/*", async (c, next) => {
    await next();
    const path = new URL(c.req.url).pathname;
    // Reads are not logged, except the ones that move data out or query the law and the records: exports and searches (path only, never the query text).
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !/\.docx$|^\/api\/search$|^\/api\/library\/unit$/.test(path)) return;
    const user = c.get("user");
    if (!user) return; // anonymous noise (401s, scans) is not worth a row; successful sign-ins are logged explicitly below
    db.prepare("INSERT INTO audit_log (email,method,path,status) VALUES (?,?,?,?)").run(user.email, c.req.method, path.slice(0, 200), c.res.status);
  });

  // ---------- public: sign-in ----------
  app.get("/api/auth/config", (c) => c.json({ sso: !!oidc, org: getSetting(db, "org_name") ?? "" }));

  app.post("/api/auth/login", async (c) => {
    const b = await body(c);
    const email = isObj(b) ? text(b.email, 254) : null, password = isObj(b) ? text(b.password, 256) : null;
    if (!email || !password) return err(c, 400, "email and password required");
    const key = email.trim().toLowerCase();
    // Lock the email+IP pair (5 fails) and, more loosely, the IP (30 fails): an outsider cannot lock the admin out from their own address.
    const ip = ipGroup(clientIp(c)), pair = `${key}|${ip}`, ipKey = `ip|${ip}`;
    if (isLocked(pair) || isLocked(ipKey)) return err(c, 429, "Too many attempts. Try again in 15 minutes.");
    // ponytail: global cap on concurrent password checks (each costs ~32 MB). Add a per-IP limit at your reverse proxy.
    if (hashing >= 8) return err(c, 429, "Server busy, try again shortly");
    const user = findUserByEmail(db, email); // account state exists only for real accounts
    if (user) { // after the busy check, before any budget is spent
      const wait = accountGate(key, pair);
      if (wait) { c.header("Retry-After", String(Math.ceil(wait / 1000))); return err(c, 429, "Too many attempts for this account. Wait a moment and try again."); }
    }
    recordFail(pair); recordFail(ipKey, IP_MAX_FAILS); // count the attempt BEFORE the slow check, so a burst of parallel guesses cannot all slip past the limit
    hashing++;
    let ok: boolean;
    try { ok = await verifyPassword(password, user?.password_hash ?? null); } finally { hashing--; } // same work whether or not the user exists
    if (!user || !ok || user.disabled) { if (user) accountFail(key); return err(c, 401, "Wrong email or password"); } // only real accounts get account state
    clearFails(pair); refundFail(ipKey); accountOk(key, pair);
    setCookie(c, SESSION_COOKIE, createSession(db, user.id), { ...cookieOpts, maxAge: SESSION_MS / 1000 });
    db.prepare("INSERT INTO audit_log (email,method,path,status) VALUES (?,?,?,?)").run(user.email, "POST", "/api/auth/login", 200);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    const t = getCookie(c, SESSION_COOKIE); if (t) endSession(db, t);
    deleteCookie(c, SESSION_COOKIE, cookieOpts);
    return c.json({ ok: true });
  });

  app.get("/api/auth/oidc/login", async (c) => {
    if (!oidc) return err(c, 404, "SSO is not configured");
    try {
      const { url, state } = await startLogin(db, oidc);
      setCookie(c, "patuh_oidc", state, { ...cookieOpts, maxAge: 600 }); // binds the login to this browser
      return c.redirect(url);
    } catch { return c.redirect("/?sso_error=1"); }
  });

  app.get("/api/auth/oidc/callback", async (c) => {
    if (!oidc) return err(c, 404, "SSO is not configured");
    const state = c.req.query("state") ?? "", code = c.req.query("code") ?? "";
    const bound = getCookie(c, "patuh_oidc");
    deleteCookie(c, "patuh_oidc", cookieOpts);
    if (!state || !code || bound !== state) return c.redirect("/?sso_error=1");
    try {
      const id = await finishLogin(db, oidc, code, state);
      const user = userForSso(db, id); // only users created with `user add --sso`, bound to this provider account
      if (!user) return c.redirect("/?sso_error=denied");
      setCookie(c, SESSION_COOKIE, createSession(db, user.id), { ...cookieOpts, maxAge: SESSION_MS / 1000 });
      db.prepare("INSERT INTO audit_log (email,method,path,status) VALUES (?,?,?,?)").run(user.email, "GET", "/api/auth/oidc/callback", 302);
      return c.redirect("/");
    } catch { return c.redirect("/?sso_error=1"); }
  });

  // ---------- everything below needs a session ----------
  app.use("/api/*", async (c, next) => {
    const user = userForSession(db, getCookie(c, SESSION_COOKIE));
    if (!user) return err(c, 401, "Sign in required");
    c.set("user", user);
    await next();
  });

  app.get("/api/auth/me", (c) => {
    const user = c.get("user");
    const demo = demoLoaded(db);
    const tour = demo ? one(db, "SELECT id,department_id FROM activities WHERE demo=1 ORDER BY id LIMIT 1") : undefined;
    const tourId = tour && canRead(user, tour.department_id as number) ? tour.id : null;
    return c.json({ user, org: getSetting(db, "org_name") ?? "", demo, ai: !!aiConfig(db), tourActivityId: tourId,
      completedTours: all(db, "SELECT tour_id FROM tutorial_progress WHERE user_id=?", user.id).map((r) => r.tour_id) });
  });

  app.post("/api/tutorials/:id/complete", (c) => {
    const id = c.req.param("id");
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return err(c, 400, "bad tutorial id");
    if ((one(db, "SELECT COUNT(*) n FROM tutorial_progress WHERE user_id=?", c.get("user").id)!.n as number) >= 50) return err(c, 400, "too many tutorials");
    db.prepare("INSERT OR IGNORE INTO tutorial_progress (user_id,tour_id) VALUES (?,?)").run(c.get("user").id, id);
    return c.json({ ok: true });
  });

  app.get("/api/criteria", (c) => c.json(CRITERIA));

  // Access helpers. A department you cannot read looks like it does not exist (404, not 403).
  const deptOfActivity = (id: number) => one(db, "SELECT department_id d FROM activities WHERE id=?", id)?.d as number | undefined;
  const activityOfRisk = (id: number) => one(db, "SELECT activity_id a FROM risks WHERE id=?", id)?.a as number | undefined;
  const readable = (u: User, d: number | undefined): d is number => d !== undefined && canRead(u, d);

  app.get("/api/departments", (c) => {
    const u = c.get("user");
    return c.json(u.role === "member" ? all(db, "SELECT id,name FROM departments WHERE id=?", u.department_id ?? -1) : all(db, "SELECT id,name FROM departments ORDER BY name"));
  });
  app.post("/api/departments", async (c) => {
    if (!canSignOff(c.get("user"))) return err(c, 403, "Only an admin or DPO can add departments");
    const b = await body(c); const name = isObj(b) ? text(b.name, 200)?.trim() : null;
    if (!name) return err(c, 400, "name required");
    if (one(db, "SELECT id FROM departments WHERE name=?", name)) return err(c, 400, "department already exists");
    return c.json({ id: Number(db.prepare("INSERT INTO departments (name) VALUES (?)").run(name).lastInsertRowid) }, 201);
  });

  // ---------- AI assistant ----------
  // ponytail: global cap on concurrent AI calls (each can run for a minute and costs money). Add per-user quotas if needed.
  const withAi = async (c: Context, run: (cfg: AiConfig) => Promise<Response>) => {
    const cfg = aiConfig(db);
    if (!cfg) return err(c, 400, "AI is not set up yet. An admin can do that under Settings.");
    if (aiBusy >= 4) return err(c, 429, "The AI is busy. Try again in a moment.");
    aiBusy++;
    try { return await run(cfg); }
    catch (e) { return err(c, 502, e instanceof AiError ? e.message : "The AI request failed"); }
    finally { aiBusy--; }
  };
  const langOf = (v: unknown): "en" | "id" => (v === "id" ? "id" : "en");

  app.get("/api/settings", (c) => {
    if (c.get("user").role !== "admin") return err(c, 403, "Only an admin can open settings");
    return c.json({ ai: { base_url: process.env.PATUH_AI_BASE_URL || (getSetting(db, "ai_base_url") ?? ""), model: getSetting(db, "ai_model") ?? "", hasKey: hasApiKey(db) } }); // the key is never sent back
  });
  app.put("/api/settings/ai", async (c) => {
    if (c.get("user").role !== "admin") return err(c, 403, "Only an admin can change settings");
    const b = await body(c); if (!isObj(b)) return err(c, 400, "invalid json");
    const url = text(b.base_url, 300)?.trim(), model = text(b.model, 100)?.trim(), key = b.api_key === undefined ? undefined : text(b.api_key, 500)?.trim();
    if (url === undefined || model === undefined || key === null) return err(c, 400, "base_url, model and api_key must be text");
    if (url || model) { // both empty = switch AI off
      const bad = aiUrlProblem(url!);
      if (bad || !model) return err(c, 400, bad ?? "Enter a full address starting with http:// or https://, and a model name");
    }
    // A key belongs to the service it was entered for: another origin means the key must be typed again.
    if (originOf(url ?? "") !== originOf(getSetting(db, "ai_base_url") ?? "")) setApiKey(db, "");
    setSetting(db, "ai_base_url", url); setSetting(db, "ai_model", model);
    if (key !== undefined) setApiKey(db, key); // "" removes it; stored encrypted
    return c.json({ ok: true });
  });
  app.post("/api/settings/ai/test", async (c) => {
    if (c.get("user").role !== "admin") return err(c, 403, "Only an admin can change settings");
    return await withAi(c, async (cfg) => c.json({ ok: true, reply: (await complete(cfg, [{ role: "user", content: "Reply with the single word OK." }], opts.aiFetch)).slice(0, 100) }));
  });

  // Describe a process in your own words; the AI drafts the whole record (details, screening, risks, controls). Everything it writes is a draft until a person confirms it.
  app.post("/api/activities/ai", async (c) => {
    const u = c.get("user"), b = await body(c);
    if (!isObj(b) || typeof b.department_id !== "number" || !Number.isInteger(b.department_id)) return err(c, 400, "name, description and department_id required");
    if (!one(db, "SELECT id FROM departments WHERE id=?", b.department_id) || !canRead(u, b.department_id)) return err(c, 404, "department not found");
    if (!canWrite(u, b.department_id)) return err(c, 403, "You cannot add processes to this department");
    const name = text(b.name, 200)?.trim(), description = text(b.description, 4000)?.trim();
    if (!name || !description) return err(c, 400, "name and description required");
    const dept = b.department_id, lang = langOf(b.lang), t0 = Date.now();
    return withAi(c, async (cfg) => {
      let r;
      try { r = await completeUsage(cfg, draftMessages(name, description, lang), opts.aiFetch); }
      catch (e) { logInteraction(db, { user_id: u.id, activity_id: null, kind: "draft", lang, model: cfg.model, question: description, outcome: "error", latency_ms: Date.now() - t0 }); throw e; }
      let id: number;
      try { id = createFromDraft(db, dept, name, description, extractJson(r.content)); }
      catch (e) { logInteraction(db, { user_id: u.id, activity_id: null, kind: "draft", lang, model: cfg.model, question: description, outcome: "error", usage: r.usage, latency_ms: Date.now() - t0 }); throw e; }
      logInteraction(db, { user_id: u.id, activity_id: id, kind: "draft", lang, model: cfg.model, question: description, outcome: "answered", usage: r.usage, latency_ms: Date.now() - t0 });
      return c.json({ id }, 201);
    });
  });

  // Chat about one process: an agent that looks things up in the record and the library and PROPOSES changes. Nothing changes until a person accepts.
  app.post("/api/activities/:id/chat", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), dept = deptOfActivity(id);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c), message = isObj(b) ? text(b.message, 4000)?.trim() : null;
    if (!isObj(b) || !message) return err(c, 400, "message required");
    const history: Turn[] = (Array.isArray(b.history) ? b.history : []).slice(-6).flatMap((h): Turn[] =>
      isObj(h) && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" ? [{ role: h.role, content: h.content.slice(0, 3000) }] : []);
    return withAi(c, async (cfg) => { purgeAiText(db); return c.json(await runAgent(db, cfg, { actId: id, userId: u.id, lang: langOf(b.lang), message, history, fetch: opts.aiFetch })); });
  });

  const parseProposal = (r: Q) => ({ id: r.id, kind: r.kind, target: r.target, before: JSON.parse(r.before_json as string), after: JSON.parse(r.after_json as string), reason: r.reason, cites: JSON.parse(r.cites as string), status: r.status });
  app.get("/api/activities/:id/proposals", (c) => {
    const id = int(c.req.param("id"));
    if (!readable(c.get("user"), deptOfActivity(id))) return err(c, 404, "not found");
    return c.json(all(db, "SELECT * FROM ai_proposal WHERE activity_id=? AND status='pending' ORDER BY id", id).map(parseProposal));
  });
  for (const action of ["accept", "reject"] as const) app.post(`/api/proposals/:id/${action}`, async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), act = one(db, "SELECT activity_id a FROM ai_proposal WHERE id=?", id)?.a as number | undefined;
    const dept = act === undefined ? undefined : deptOfActivity(act);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c);
    const r = decide(db, u.id, canSignOff(u), id, action, isObj(b) ? b.value : undefined);
    return r.ok ? c.json({ ok: true, status: r.status }) : c.json({ error: r.error }, r.code);
  });
  app.post("/api/interactions/:id/rating", async (c) => {
    const id = int(c.req.param("id")), b = await body(c);
    if (!isObj(b) || ![1, -1].includes(b.rating as number)) return err(c, 400, "rating must be 1 or -1");
    const r = db.prepare("UPDATE ai_interaction SET rating=?, rating_note=? WHERE id=? AND user_id=?").run(b.rating as number, text(b.note, 500) ?? "", id, c.get("user").id);
    return r.changes ? c.json({ ok: true }) : err(c, 404, "not found");
  });

  // What is still missing before sign-off, with the question to ask for each gap.
  app.get("/api/activities/:id/completeness", (c) => {
    const id = int(c.req.param("id")), lang = langOf(c.req.query("lang"));
    if (!readable(c.get("user"), deptOfActivity(id))) return err(c, 404, "not found");
    const { comp, meta } = activityState(db, id);
    return c.json({ ...comp, gaps: comp.gaps.map((g) => ({ ...g, question: questionFor(g, lang) })), meta: Object.fromEntries(meta.map((m) => [m.field, { source: m.source, confirmed: !!m.confirmed }])) });
  });
  app.post("/api/activities/:id/confirm", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), dept = deptOfActivity(id);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c);
    if (!isObj(b) || !Array.isArray(b.fields) || !b.fields.every((f) => typeof f === "string")) return err(c, 400, "fields required");
    const known = ["screening", ...REQUIRED_FIELDS, "ai_system", "vendor", "subjects_views", "cross_border"];
    for (const f of (b.fields as string[]).filter((x) => known.includes(x))) db.prepare(`INSERT INTO field_meta (activity_id,field,source,confirmed) VALUES (?,?,'user',1)
      ON CONFLICT(activity_id,field) DO UPDATE SET confirmed=1`).run(id, f); // also how a person says "none of the DPIA criteria apply"
    return c.json({ ok: true });
  });
  app.post("/api/risks/:id/confirm", (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), act = activityOfRisk(id), dept = act === undefined ? undefined : deptOfActivity(act);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    db.prepare("UPDATE risks SET confirmed=1 WHERE id=?").run(id);
    return c.json({ ok: true });
  });

  // ---------- library and search ----------
  app.get("/api/library/sources", (c) => c.json(listSources(db)));
  app.get("/api/library/unit", (c) => { const u = getUnit(db, c.req.query("uid") ?? ""); return u ? c.json(u) : err(c, 404, "not found"); });
  app.get("/api/search", (c) => {
    const u = c.get("user"), q = (c.req.query("q") ?? "").trim().slice(0, 300), scope = c.req.query("scope") ?? "all";
    if (!q) return c.json({ library: [], processes: [] });
    const library = scope === "processes" ? [] : searchLibrary(db, q, { source: c.req.query("source") || undefined, lang: c.req.query("lang") || undefined, limit: 20, advanced: c.req.query("advanced") === "1" ? true : undefined });
    const processes = scope === "library" ? [] : searchProcesses(u, q);
    return c.json({ library, processes });
  });
  // ponytail: LIKE scan over a few thousand rows is plenty for one organisation; move to an FTS5 table with triggers if it ever isn't.
  const searchProcesses = (u: User, q: string) => {
    const ws = (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 6), everything = u.role === "member" ? 0 : 1, dept = u.department_id ?? -1;
    if (!ws.length) return [];
    const like = (expr: string) => ws.map(() => `${expr} LIKE ? ESCAPE '\\'`).join(" AND "), args = ws.map((w) => `%${w.replace(/[%_\\]/g, "\\$&")}%`);
    const ACT = "lower(a.name||' '||a.purpose||' '||a.description||' '||a.data_categories||' '||a.data_subjects||' '||a.ai_system||' '||a.vendor||' '||a.data_location||' '||a.legal_basis||' '||a.retention||' '||a.necessity)";
    return [
      ...all(db, `SELECT 'process' kind, a.id activity_id, a.name title, d.name department, substr(a.purpose,1,140) snippet FROM activities a JOIN departments d ON d.id=a.department_id WHERE (?=1 OR a.department_id=?) AND ${like(ACT)} LIMIT 20`, everything, dept, ...args),
      ...all(db, `SELECT 'risk' kind, a.id activity_id, r.title title, a.name department, substr(r.description,1,140) snippet FROM risks r JOIN activities a ON a.id=r.activity_id WHERE (?=1 OR a.department_id=?) AND ${like("lower(r.title||' '||r.description)")} LIMIT 20`, everything, dept, ...args),
      ...all(db, `SELECT 'control' kind, a.id activity_id, k.title title, a.name department, '' snippet FROM controls k JOIN risks r ON r.id=k.risk_id JOIN activities a ON a.id=r.activity_id WHERE (?=1 OR a.department_id=?) AND ${like("lower(k.title||' '||k.owner)")} LIMIT 20`, everything, dept, ...args),
    ];
  };

  // Quality numbers for the AI assistant (admin and DPO).
  app.get("/api/ai/metrics", (c) => {
    if (!canSignOff(c.get("user"))) return err(c, 403, "Only an admin or DPO can see this");
    const days = Math.min(365, Math.max(1, Number(c.req.query("days")) || 30)), since = `-${days} days`;
    const n = (sql: string, ...a: (string | number)[]) => (one(db, sql, ...a)?.n as number) ?? 0;
    const chats = n("SELECT COUNT(*) n FROM ai_interaction WHERE kind='chat' AND at>=datetime('now',?)", since);
    const by = (o: string) => n("SELECT COUNT(*) n FROM ai_interaction WHERE kind='chat' AND outcome=? AND at>=datetime('now',?)", o, since);
    const blocks = n("SELECT COALESCE(SUM(blocks_total),0) n FROM ai_interaction WHERE kind='chat' AND at>=datetime('now',?)", since);
    const dropped = n("SELECT COALESCE(SUM(blocks_dropped),0) n FROM ai_interaction WHERE kind='chat' AND at>=datetime('now',?)", since);
    const lat = all(db, "SELECT latency_ms l FROM ai_interaction WHERE at>=datetime('now',?) ORDER BY latency_ms", since).map((r) => r.l as number);
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0);
    const ps = (st: string) => n("SELECT COUNT(*) n FROM ai_proposal p JOIN ai_interaction i ON i.id=p.interaction_id WHERE p.status=? AND i.at>=datetime('now',?)", st, since);
    const acc = ps("accepted"), edt = ps("edited"), rej = ps("rejected"), decided = acc + edt + rej;
    const drafts = n("SELECT COUNT(*) n FROM field_meta WHERE source<>'user'"), draftsOk = n("SELECT COUNT(*) n FROM field_meta WHERE source<>'user' AND confirmed=1");
    const rate = (a: number, b: number) => (b ? a / b : null);
    return c.json({ days, interactions: n("SELECT COUNT(*) n FROM ai_interaction WHERE at>=datetime('now',?)", since), chats,
      groundingRate: rate(blocks - dropped, blocks), unsupportedRate: rate(dropped, blocks), declineRate: rate(by("declined"), chats), clarificationRate: rate(by("clarified"), chats), errorRate: rate(by("error"), chats),
      proposals: { accepted: acc, edited: edt, rejected: rej, pending: ps("pending"), stale: ps("stale") }, acceptanceRate: rate(acc + edt, decided), overrideRate: rate(edt + rej, decided),
      assumptionConfirmed: rate(draftsOk, drafts), latencyP50: pct(0.5), latencyP95: pct(0.95),
      tokens: n("SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) n FROM ai_interaction WHERE at>=datetime('now',?)", since),
      thumbsUp: n("SELECT COUNT(*) n FROM ai_interaction WHERE rating=1 AND at>=datetime('now',?)", since), thumbsDown: n("SELECT COUNT(*) n FROM ai_interaction WHERE rating=-1 AND at>=datetime('now',?)", since),
      library: { sources: n("SELECT COUNT(*) n FROM lib_source"), units: n("SELECT COUNT(*) n FROM lib_unit") },
      declinedQuestions: all(db, "SELECT question q, COUNT(*) n FROM ai_interaction WHERE outcome='declined' AND question<>'' AND at>=datetime('now',?) GROUP BY question ORDER BY n DESC LIMIT 10", since) });
  });

  const parseActivity = (r: Q) => ({ ...r, screening: JSON.parse(r.screening as string) });
  app.get("/api/activities", (c) => {
    const u = c.get("user");
    return c.json(all(db, `SELECT a.*, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id
      WHERE ?=1 OR a.department_id=? ORDER BY a.id DESC`, u.role === "member" ? 0 : 1, u.department_id ?? -1).map(parseActivity));
  });
  app.post("/api/activities", async (c) => {
    const u = c.get("user"), b = await body(c);
    if (!isObj(b) || typeof b.department_id !== "number" || !Number.isInteger(b.department_id)) return err(c, 400, "name and department_id required");
    if (!one(db, "SELECT id FROM departments WHERE id=?", b.department_id) || !canRead(u, b.department_id)) return err(c, 404, "department not found");
    if (!canWrite(u, b.department_id)) return err(c, 403, "You cannot add processes to this department");
    const v = cleanActivity(b); if ("error" in v) return err(c, 400, v.error);
    if (!v.value.name) return err(c, 400, "name required");
    if (SIGNOFF_FIELDS.some((f) => f in v.value) && !canSignOff(u)) return err(c, 403, "Only an admin or DPO can fill in the sign-off fields");
    return c.json({ id: createActivity(db, b.department_id, v.value) }, 201);
  });
  app.patch("/api/activities/:id", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), dept = deptOfActivity(id);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c); if (!isObj(b)) return err(c, 400, "invalid json");
    const v = cleanActivity(b); if ("error" in v) return err(c, 400, v.error);
    if (SIGNOFF_FIELDS.some((f) => f in v.value) && !canSignOff(u)) return err(c, 403, "Only an admin or DPO can fill in the sign-off fields");
    // A change by someone who cannot sign off withdraws an earlier sign-off: the DPO signed the old content.
    if (!canSignOff(u) && Object.keys(v.value).length) v.value.signed_by = "";
    const sign = typeof v.value.signed_by === "string" && v.value.signed_by.trim() !== "" && canSignOff(u);
    const { signed_by, ...rest } = v.value;
    updateActivity(db, id, sign ? rest : v.value.signed_by === "" ? { ...v.value, signed_at: "" } : v.value); // a withdrawn signature loses its date
    for (const k of Object.keys(rest)) if (!["name", "dpo_advice", "review_date"].includes(k)) setMeta(db, id, k, "user", true); // typed by a person
    if (sign) { // no signature while anything an AI wrote is unconfirmed
      const left = activityState(db, id).comp.gaps.length;
      if (left) return err(c, 400, `Not ready to sign off: ${left} item(s) are still empty or unconfirmed AI drafts. See the checklist on this page.`);
      updateActivity(db, id, { signed_by, signed_at: new Date().toISOString().slice(0, 10) });
    }
    return c.json({ ok: true });
  });

  const withControls = (r: Q) => ({ ...r, controls: all(db, "SELECT * FROM controls WHERE risk_id=? ORDER BY id", r.id as number) });
  app.get("/api/activities/:id/risks", (c) => {
    const id = int(c.req.param("id"));
    if (!readable(c.get("user"), deptOfActivity(id))) return err(c, 404, "not found");
    return c.json(all(db, "SELECT * FROM risks WHERE activity_id=? ORDER BY id", id).map(withControls));
  });
  app.post("/api/activities/:id/risks", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), dept = deptOfActivity(id);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c);
    const title = isObj(b) ? text(b.title, 200)?.trim() : null, desc = isObj(b) ? (b.description === undefined ? "" : text(b.description)) : null;
    if (!isObj(b) || !title || desc === null) return err(c, 400, "title required");
    try { riskLevel(b.likelihood as number, b.severity as number); } catch { return err(c, 400, "likelihood and severity must be 1-4"); }
    const r = db.prepare("INSERT INTO risks (activity_id,title,description,likelihood,severity) VALUES (?,?,?,?,?)").run(id, title, desc, b.likelihood as number, b.severity as number);
    return c.json({ id: Number(r.lastInsertRowid) }, 201);
  });
  app.patch("/api/risks/:id", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), act = activityOfRisk(id), dept = act === undefined ? undefined : deptOfActivity(act);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c); if (!isObj(b)) return err(c, 400, "invalid json");
    for (const k of ["residual_likelihood", "residual_severity"] as const) {
      if (b[k] === undefined) continue;
      if (!Number.isInteger(b[k]) || (b[k] as number) < 1 || (b[k] as number) > 4) return err(c, 400, `${k} must be 1-4`);
      db.prepare(`UPDATE risks SET ${k}=? WHERE id=?`).run(b[k] as number, id); // column name comes from the fixed list above
    }
    return c.json({ ok: true });
  });
  app.post("/api/risks/:id/controls", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id")), act = activityOfRisk(id), dept = act === undefined ? undefined : deptOfActivity(act);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c); if (!isObj(b)) return err(c, 400, "invalid json");
    const title = text(b.title, 200)?.trim(), owner = b.owner === undefined ? "" : text(b.owner, 200), due = b.due === undefined ? "" : date(b.due);
    const status = b.status === undefined ? "planned" : b.status;
    if (!title) return err(c, 400, "title required");
    if (owner === null || due === null || !["planned", "in-progress", "done"].includes(status as string)) return err(c, 400, "invalid owner, due (YYYY-MM-DD) or status");
    return c.json({ id: Number(db.prepare("INSERT INTO controls (risk_id,title,owner,due,status) VALUES (?,?,?,?,?)").run(id, title, owner, due, status as string).lastInsertRowid) }, 201);
  });
  app.patch("/api/controls/:id", async (c) => {
    const u = c.get("user"), id = int(c.req.param("id"));
    const risk = one(db, "SELECT risk_id r FROM controls WHERE id=?", id)?.r as number | undefined;
    const act = risk === undefined ? undefined : activityOfRisk(risk), dept = act === undefined ? undefined : deptOfActivity(act);
    if (!readable(u, dept)) return err(c, 404, "not found");
    if (!canWrite(u, dept)) return err(c, 403, "read-only");
    const b = await body(c);
    if (!isObj(b) || !["planned", "in-progress", "done"].includes(b.status as string)) return err(c, 400, "status must be planned, in-progress or done");
    db.prepare("UPDATE controls SET status=? WHERE id=?").run(b.status as string, id);
    return c.json({ ok: true });
  });

  app.get("/api/activities/:id/dpia.docx", async (c) => {
    const id = int(c.req.param("id"));
    if (!readable(c.get("user"), deptOfActivity(id))) return err(c, 404, "not found");
    const row = one(db, "SELECT a.*, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id WHERE a.id=?", id)!;
    const lang: Lang = c.req.query("lang") === "id" ? "id" : "en";
    const risks: RiskRow[] = all(db, "SELECT * FROM risks WHERE activity_id=? ORDER BY id", id).map(withControls) as never;
    const buf = await dpiaBuffer({ ...(row as unknown as Activity), screening: JSON.parse(row.screening as string) }, risks, lang);
    return new Response(new Uint8Array(buf), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${fileSlug(String(row.name))}-dpia-${lang}.docx"` } });
  });

  // One row per process: is a DPIA needed, how many risks, open controls, is residual risk still high.
  app.get("/api/dashboard", (c) => {
    const u = c.get("user");
    return c.json(all(db, `SELECT a.id, a.name, a.screening, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id
      WHERE ?=1 OR a.department_id=? ORDER BY a.id`, u.role === "member" ? 0 : 1, u.department_id ?? -1).map((a) => {
      const s = screen(JSON.parse(a.screening as string));
      const risks = all(db, "SELECT * FROM risks WHERE activity_id=?", a.id as number).map(withControls) as unknown as RiskRow[];
      const open = risks.flatMap((r) => r.controls).filter((k) => k.status !== "done").length;
      const residual = risks.map((r) => riskLevel(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity).level);
      return { id: a.id, name: a.name, department: a.department, dpiaRequired: s.dpiaRequired, basis: s.basis, risks: risks.length, openControls: open, consultation: needsPriorConsultation(residual) };
    }));
  });

  // Numbers for the dashboard charts, limited to what this person may see.
  app.get("/api/overview", (c) => {
    const u = c.get("user"), everything = u.role === "member" ? 0 : 1, dept = u.department_id ?? -1;
    const acts = all(db, "SELECT a.id,a.screening,a.signed_by,d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id WHERE ?=1 OR a.department_id=?", everything, dept)
      .map((a): OvActivity => ({ id: a.id as number, department: a.department as string, screening: JSON.parse(a.screening as string), signed: (a.signed_by as string).trim() !== "" }));
    const risks = all(db, "SELECT r.id,r.activity_id,r.likelihood,r.severity,r.residual_likelihood,r.residual_severity FROM risks r JOIN activities a ON a.id=r.activity_id WHERE ?=1 OR a.department_id=?", everything, dept) as unknown as OvRisk[];
    const controls = all(db, "SELECT k.risk_id,k.status FROM controls k JOIN risks r ON r.id=k.risk_id JOIN activities a ON a.id=r.activity_id WHERE ?=1 OR a.department_id=?", everything, dept) as unknown as OvControl[];
    return c.json(buildOverview(acts, risks, controls));
  });

  return app;
}
