import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import type { DatabaseSync } from "node:sqlite";
import { CRITERIA, screen } from "../core/screening.js";
import { needsPriorConsultation, riskLevel } from "../core/risk.js";
import { dpiaBuffer, type Activity, type Lang, type RiskRow } from "../core/dpia.js";
import { createActivity, getSetting, updateActivity } from "./db.js";
import { SESSION_COOKIE, SESSION_MS, canRead, canSignOff, canWrite, clearFails, createSession, createUser, endSession, findUserByEmail,
  isLocked, recordFail, userForSession, verifyPassword, type User } from "./auth.js";
import { finishLogin, startLogin, type OidcConfig } from "./oidc.js";
import { demoLoaded } from "./demo.js";
import { SIGNOFF_FIELDS, cleanActivity, date, text } from "./validate.js";

type Env = { Variables: { user: User } };
type Q = Record<string, string | number | null>;
export type AppOptions = { oidc?: OidcConfig | null; secureCookies?: boolean };

const all = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as Q[];
const one = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as Q | undefined;
const err = (c: Context, status: 400 | 401 | 403 | 404 | 429, msg: string) => c.json({ error: msg }, status);
const body = async (c: Context) => ((await c.req.json().catch(() => null)) ?? null) as Record<string, unknown> | null;
const isObj = (b: unknown): b is Record<string, unknown> => !!b && typeof b === "object" && !Array.isArray(b);
const int = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : NaN);

export function createApp(db: DatabaseSync, opts: AppOptions = {}) {
  const app = new Hono<Env>();
  const oidc = opts.oidc ?? null;
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, secure: !!opts.secureCookies, path: "/" };

  app.use("*", secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"] },
    referrerPolicy: "no-referrer", xFrameOptions: "DENY",
  }));

  // CSRF: a browser cannot add this header to a cross-site request without a CORS preflight, which we never allow.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-requested-with") !== "patuh") return err(c, 403, "Missing x-requested-with header");
    await next();
  });
  // Audit trail: who changed what and when (never the request body, which may hold passwords).
  app.use("/api/*", async (c, next) => {
    await next();
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return;
    const user = c.get("user");
    db.prepare("INSERT INTO audit_log (email,method,path,status) VALUES (?,?,?,?)").run(user?.email ?? "", c.req.method, new URL(c.req.url).pathname, c.res.status);
  });

  // ---------- public: sign-in ----------
  app.get("/api/auth/config", (c) => c.json({ sso: !!oidc, org: getSetting(db, "org_name") ?? "" }));

  app.post("/api/auth/login", async (c) => {
    const b = await body(c);
    const email = isObj(b) ? text(b.email, 254) : null, password = isObj(b) ? text(b.password, 256) : null;
    if (!email || !password) return err(c, 400, "email and password required");
    const key = email.trim().toLowerCase();
    if (isLocked(key)) return err(c, 429, "Too many attempts. Try again in 15 minutes.");
    const user = findUserByEmail(db, email);
    const ok = await verifyPassword(password, user?.password_hash ?? null); // same work whether or not the user exists
    if (!user || !ok || user.disabled) { recordFail(key); return err(c, 401, "Wrong email or password"); }
    clearFails(key);
    setCookie(c, SESSION_COOKIE, createSession(db, user.id), { ...cookieOpts, maxAge: SESSION_MS / 1000 });
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
      let user = findUserByEmail(db, id.email);
      if (!user && oidc.autoCreate) { // new SSO users get no access until an admin assigns a department
        await createUser(db, { email: id.email, name: id.name, role: "member", departmentId: null }).catch(() => undefined);
        user = findUserByEmail(db, id.email);
      }
      if (!user || user.disabled) return c.redirect("/?sso_error=denied");
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
    const tour = demo ? one(db, "SELECT id FROM activities WHERE demo=1 ORDER BY id LIMIT 1") : undefined;
    return c.json({ user, org: getSetting(db, "org_name") ?? "", demo, tourActivityId: tour?.id ?? null,
      completedTours: all(db, "SELECT tour_id FROM tutorial_progress WHERE user_id=?", user.id).map((r) => r.tour_id) });
  });

  app.post("/api/tutorials/:id/complete", (c) => {
    const id = c.req.param("id");
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return err(c, 400, "bad tutorial id");
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
    updateActivity(db, id, v.value);
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
      "content-disposition": `attachment; filename="dpia-${id}-${lang}.docx"` } });
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

  return app;
}
