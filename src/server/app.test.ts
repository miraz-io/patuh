import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { createUser, type Role } from "./auth.js";
import { aiConfig } from "./ai.js";
import { unzipSync } from "fflate";

const PW = "correct horse battery";
type App = ReturnType<typeof createApp>;

async function setup() {
  const db = openDb(":memory:");
  const hr = Number(db.prepare("INSERT INTO departments (name) VALUES ('HR')").run().lastInsertRowid);
  const fin = Number(db.prepare("INSERT INTO departments (name) VALUES ('Finance')").run().lastInsertRowid);
  const mk = (email: string, role: Role, departmentId?: number) => createUser(db, { email, name: email, role, departmentId, password: PW });
  await Promise.all([mk("admin@x.id", "admin"), mk("dpo@x.id", "dpo"), mk("hr@x.id", "member", hr), mk("fin@x.id", "member", fin), mk("aud@x.id", "auditor")]);
  return { db, app: createApp(db), hr, fin };
}

const call = (app: App, url: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  app.request(url, { method: o.method ?? (o.body ? "POST" : "GET"), headers: { "content-type": "application/json", "x-requested-with": "patuh", ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });

async function login(app: App, email: string, password = PW) {
  const r = await call(app, "/api/auth/login", { body: { email, password } });
  return { status: r.status, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const COMPLETE = { purpose: "p", description: "d", data_categories: "c", data_subjects: "s", legal_basis: "l", retention: "r", necessity: "n", data_location: "id", screening: [] };
const json = async <T = any>(r: Response) => (await r.json()) as T;

describe("sign-in", () => {
  it("rejects wrong passwords and unknown users the same way", async () => {
    const { app } = await setup();
    expect((await login(app, "admin@x.id", "wrong password!!")).status).toBe(401);
    expect((await login(app, "nobody@x.id")).status).toBe(401);
  });
  it("needs a session for everything except sign-in", async () => {
    const { app } = await setup();
    for (const url of ["/api/dashboard", "/api/activities", "/api/departments", "/api/criteria", "/api/auth/me"]) expect((await call(app, url)).status).toBe(401);
    expect((await call(app, "/api/auth/config")).status).toBe(200);
  });
  it("login -> me -> logout kills the session", async () => {
    const { app } = await setup();
    const { status, cookie } = await login(app, "ADMIN@x.id"); // email is case-insensitive
    expect(status).toBe(200);
    const me = await json(await call(app, "/api/auth/me", { cookie }));
    expect(me.user).toMatchObject({ email: "admin@x.id", role: "admin" });
    await call(app, "/api/auth/logout", { method: "POST", cookie });
    expect((await call(app, "/api/auth/me", { cookie })).status).toBe(401);
  });
  it("session cookie is HttpOnly and SameSite", async () => {
    const { app } = await setup();
    const r = await call(app, "/api/auth/login", { body: { email: "admin@x.id", password: PW } });
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(r.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });
  it("locks an account after repeated failures", async () => {
    const { app } = await setup();
    for (let i = 0; i < 5; i++) await login(app, "lockme@x.id", "nope nope nope");
    expect((await login(app, "lockme@x.id")).status).toBe(429);
  });
  it("a disabled user's session stops working", async () => {
    const { app, db } = await setup();
    const { cookie } = await login(app, "aud@x.id");
    db.prepare("UPDATE users SET disabled=1 WHERE email='aud@x.id'").run();
    expect((await call(app, "/api/dashboard", { cookie })).status).toBe(401);
    expect((await login(app, "aud@x.id")).status).toBe(401);
  });
  it("SSO-only users cannot sign in with a password", async () => {
    const { app, db } = await setup();
    await createUser(db, { email: "sso@x.id", name: "Sso", role: "auditor", password: null });
    expect((await login(app, "sso@x.id", PW)).status).toBe(401);
  });
});

describe("browser protections", () => {
  it("rejects state changes without the CSRF header", async () => {
    const { app } = await setup();
    const { cookie } = await login(app, "admin@x.id");
    const r = await app.request("/api/departments", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "X" }) });
    expect(r.status).toBe(403);
  });
  it("sends security headers", async () => {
    const { app } = await setup();
    const h = (await call(app, "/api/auth/config")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'self'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("permissions", () => {
  it("members only see and change their own department", async () => {
    const { app, hr, fin } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie, hrUser = (await login(app, "hr@x.id")).cookie, finUser = (await login(app, "fin@x.id")).cookie;
    const hrAct = (await json(await call(app, "/api/activities", { cookie: hrUser, body: { department_id: hr, name: "CV screening" } }))).id;
    const finAct = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: fin, name: "Credit scoring" } }))).id;

    expect((await json(await call(app, "/api/activities", { cookie: hrUser }))).map((a: any) => a.name)).toEqual(["CV screening"]);
    expect((await json(await call(app, "/api/departments", { cookie: hrUser }))).length).toBe(1);
    expect((await json(await call(app, "/api/dashboard", { cookie: hrUser }))).length).toBe(1);
    // another department is invisible (404, not 403) for every route that takes an id
    expect((await call(app, `/api/activities/${finAct}`, { method: "PATCH", cookie: hrUser, body: { name: "x" } })).status).toBe(404);
    expect((await call(app, `/api/activities/${finAct}/risks`, { cookie: hrUser })).status).toBe(404);
    expect((await call(app, `/api/activities/${finAct}/risks`, { cookie: hrUser, body: { title: "r", likelihood: 1, severity: 1 } })).status).toBe(404);
    expect((await call(app, `/api/activities/${finAct}/dpia.docx`, { cookie: hrUser })).status).toBe(404);
    expect((await call(app, "/api/activities", { cookie: hrUser, body: { department_id: fin, name: "sneaky" } })).status).toBe(404);
    // and the owner of that department still works
    expect((await call(app, `/api/activities/${finAct}`, { method: "PATCH", cookie: finUser, body: { purpose: "ok" } })).status).toBe(200);
    expect(hrAct).toBeGreaterThan(0);
  });
  it("members cannot reach risks and controls of another department by id", async () => {
    const { app, fin } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie, hrUser = (await login(app, "hr@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: fin, name: "Credit" } }))).id;
    const risk = (await json(await call(app, `/api/activities/${act}/risks`, { cookie: admin, body: { title: "Unfair", likelihood: 3, severity: 4 } }))).id;
    const ctl = (await json(await call(app, `/api/risks/${risk}/controls`, { cookie: admin, body: { title: "Review" } }))).id;
    expect((await call(app, `/api/risks/${risk}`, { method: "PATCH", cookie: hrUser, body: { residual_likelihood: 1 } })).status).toBe(404);
    expect((await call(app, `/api/risks/${risk}/controls`, { cookie: hrUser, body: { title: "x" } })).status).toBe(404);
    expect((await call(app, `/api/controls/${ctl}`, { method: "PATCH", cookie: hrUser, body: { status: "done" } })).status).toBe(404);
  });
  it("auditors read everything and change nothing", async () => {
    const { app, hr } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie, aud = (await login(app, "aud@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: hr, name: "A" } }))).id;
    expect((await call(app, "/api/activities", { cookie: aud })).status).toBe(200);
    expect((await call(app, `/api/activities/${act}/dpia.docx`, { cookie: aud })).status).toBe(200);
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: aud, body: { purpose: "x" } })).status).toBe(403);
    expect((await call(app, "/api/activities", { cookie: aud, body: { department_id: hr, name: "B" } })).status).toBe(403);
    expect((await call(app, "/api/departments", { cookie: aud, body: { name: "New" } })).status).toBe(403);
  });
  it("only admin or DPO can fill in sign-off fields", async () => {
    const { app, hr } = await setup();
    const hrUser = (await login(app, "hr@x.id")).cookie, dpo = (await login(app, "dpo@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: hrUser, body: { department_id: hr, name: "A" } }))).id;
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: { signed_by: "Me" } })).status).toBe(403);
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: { dpo_advice: "fine" } })).status).toBe(403);
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: dpo, body: { signed_by: "DPO" } })).status).toBe(400); // incomplete record: nothing to sign yet
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: COMPLETE });
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: dpo, body: { signed_by: "DPO" } })).status).toBe(200);
    expect((await call(app, "/api/activities", { cookie: hrUser, body: { department_id: hr, name: "B", signed_by: "Me" } })).status).toBe(403);
    const got = async () => (await json(await call(app, "/api/activities", { cookie: dpo }))).find((a: any) => a.id === act);
    expect((await got()).signed_at).toBe(new Date().toISOString().slice(0, 10)); // sign-off records the date
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: { purpose: "changed" } });
    expect((await got()).signed_at).toBe(""); // withdrawn with the signature
  });
  it("Word export: Indonesian wording, dated signature, readable file name", async () => {
    const { app, hr } = await setup();
    const dpo = (await login(app, "dpo@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: dpo, body: { department_id: hr, name: "Penilaian Kinerja AI", ...COMPLETE, screening: ["vulnerable-subjects", "large-scale"] } }))).id;
    const rk = (await json(await call(app, `/api/activities/${act}/risks`, { cookie: dpo, body: { title: "r", likelihood: 2, severity: 2 } }))).id;
    await call(app, `/api/risks/${rk}/controls`, { cookie: dpo, body: { title: "c", status: "done" } });
    await call(app, `/api/risks/${rk}/confirm`, { method: "POST", cookie: dpo });
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: dpo, body: { signed_by: "Dewi" } });
    const r = await call(app, `/api/activities/${act}/dpia.docx?lang=id`, { cookie: dpo });
    expect(r.headers.get("content-disposition")).toContain("penilaian-kinerja-ai-dpia-id.docx");
    const xml = new TextDecoder().decode(unzipSync(new Uint8Array(await r.arrayBuffer()))["word/document.xml"]);
    expect(xml).toContain("Selesai"); expect(xml).toContain("Pasal 35"); expect(xml).toContain("Dewi (pada " + new Date().toISOString().slice(0, 10));
    expect(xml).not.toMatch(/\bdone\b|Art\.|Recital/);
    expect(xml.split("2. Kebutuhan dan proporsionalitas").length).toBe(2); // heading appears once
  });
});

describe("workflow and validation", () => {
  it("register -> risk -> control -> dashboard -> DPIA docx (en + id)", async () => {
    const { app } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie;
    const dep = (await json(await call(app, "/api/departments", { cookie: admin, body: { name: "Ops" } }))).id;
    const act = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: dep, name: "CV screening with LLM", screening: ["new-technology", "scoring-monitoring"], cross_border: 1 } }))).id;
    const risk = (await json(await call(app, `/api/activities/${act}/risks`, { cookie: admin, body: { title: "Biased ranking", likelihood: 3, severity: 4 } }))).id;
    expect((await call(app, `/api/risks/${risk}/controls`, { cookie: admin, body: { title: "Human review", due: "2026-12-15" } })).status).toBe(201);
    expect((await json(await call(app, "/api/dashboard", { cookie: admin })))[0]).toMatchObject({ dpiaRequired: true, basis: "uu-pdp", risks: 1, openControls: 1, consultation: true });
    for (const lang of ["en", "id"]) {
      const res = await call(app, `/api/activities/${act}/dpia.docx?lang=${lang}`, { cookie: admin });
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK"); // a .docx is a zip
    }
  });
  it("rejects bad input", async () => {
    const { app, hr } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: hr, name: "A" } }))).id;
    const risk = (await json(await call(app, `/api/activities/${act}/risks`, { cookie: admin, body: { title: "R", likelihood: 1, severity: 1 } }))).id;
    const bad = async (url: string, method: string, body: unknown) => (await call(app, url, { cookie: admin, method, body })).status;
    expect(await bad("/api/departments", "POST", {})).toBe(400);
    expect(await bad("/api/departments", "POST", { name: "HR" })).toBe(400); // duplicate
    expect(await bad("/api/activities", "POST", { name: "x" })).toBe(400);
    expect(await bad("/api/activities", "POST", { department_id: 999, name: "x" })).toBe(404);
    expect(await bad(`/api/activities/${act}`, "PATCH", { screening: ["made-up"] })).toBe(400);
    expect(await bad(`/api/activities/${act}`, "PATCH", { review_date: "tomorrow" })).toBe(400);
    expect(await bad(`/api/activities/${act}`, "PATCH", { purpose: "x".repeat(5001) })).toBe(400);
    expect(await bad(`/api/activities/${act}`, "PATCH", { cross_border: 7 })).toBe(400);
    expect(await bad(`/api/activities/${act}`, "PATCH", { purpose: 12 })).toBe(400);
    expect(await bad(`/api/activities/${act}/risks`, "POST", { title: "r", likelihood: 9, severity: 1 })).toBe(400);
    expect(await bad(`/api/risks/${risk}`, "PATCH", { residual_likelihood: 0 })).toBe(400);
    expect(await bad(`/api/risks/${risk}/controls`, "POST", { title: "c", status: "bogus" })).toBe(400);
    expect(await bad(`/api/risks/${risk}/controls`, "POST", { title: "c", due: "soon" })).toBe(400);
    expect((await call(app, "/api/activities/999/dpia.docx", { cookie: admin })).status).toBe(404);
    expect((await call(app, "/api/activities/abc/risks", { cookie: admin })).status).toBe(404);
  });
  it("ignores unknown fields instead of putting them in SQL", async () => {
    const { app, hr, db } = await setup();
    const admin = (await login(app, "admin@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: admin, body: { department_id: hr, name: "A" } }))).id;
    expect((await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: admin, body: { "name=1; DROP TABLE users; --": "x", demo: 1 } })).status).toBe(200);
    expect((db.prepare("SELECT demo FROM activities WHERE id=?").get(act) as { demo: number }).demo).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM users").get()).toMatchObject({ n: 5 });
  });
  it("writes an audit trail of sign-ins and changes, without request bodies or anonymous noise", async () => {
    const { app, db } = await setup();
    await login(app, "admin@x.id", "wrong password!!");
    await call(app, "/api/" + "a".repeat(5000), { method: "POST", body: { x: 1 } }); // anonymous junk
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log").get()).toEqual({ n: 0 });
    const { cookie } = await login(app, "admin@x.id");
    await call(app, "/api/departments", { cookie, body: { name: "Secretive department" } });
    const rows = db.prepare("SELECT email,method,path,status FROM audit_log ORDER BY id").all();
    expect(rows).toEqual([{ email: "admin@x.id", method: "POST", path: "/api/auth/login", status: 200 }, { email: "admin@x.id", method: "POST", path: "/api/departments", status: 201 }]);
    expect(JSON.stringify(rows)).not.toMatch(/wrong password|Secretive/);
  });
  it("rejects oversized request bodies", async () => {
    const { app } = await setup();
    const r = await call(app, "/api/auth/login", { body: { email: "a@x.id", password: "x".repeat(300_000) } });
    expect(r.status).toBe(413);
  });
  it("a burst of parallel wrong guesses cannot get past the limit", async () => {
    const { app } = await setup();
    const codes = await Promise.all(Array.from({ length: 20 }, () => login(app, "burst@x.id", "wrong wrong wrong")));
    expect(codes.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5); // the rest are 429 (locked) or busy
    expect((await login(app, "burst@x.id", "wrong wrong wrong")).status).toBe(429);
  });
  it("editing a signed-off process without sign-off rights withdraws the signature", async () => {
    const { app, hr } = await setup();
    const hrUser = (await login(app, "hr@x.id")).cookie, dpo = (await login(app, "dpo@x.id")).cookie;
    const act = (await json(await call(app, "/api/activities", { cookie: hrUser, body: { department_id: hr, name: "A" } }))).id;
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: COMPLETE });
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: dpo, body: { signed_by: "DPO Dewi" } });
    const signed = async () => (await json(await call(app, "/api/activities", { cookie: dpo }))).find((a: any) => a.id === act).signed_by;
    expect(await signed()).toBe("DPO Dewi");
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: dpo, body: { purpose: "DPO tweak keeps it" } });
    expect(await signed()).toBe("DPO Dewi");
    await call(app, `/api/activities/${act}`, { method: "PATCH", cookie: hrUser, body: { necessity: "changed after sign-off" } });
    expect(await signed()).toBe("");
  });
  it("does not reveal the demo tour process to users who cannot read it", async () => {
    const { app, db, hr } = await setup();
    const fin = Number(db.prepare("SELECT id FROM departments WHERE name='Finance'").get()!.id);
    db.prepare("INSERT INTO activities (department_id,name,demo) VALUES (?, 'Demo', 1)").run(fin);
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('demo_loaded','1')").run();
    const me = async (e: string) => (await json(await call(app, "/api/auth/me", { cookie: (await login(app, e)).cookie }))).tourActivityId;
    expect(await me("hr@x.id")).toBeNull();
    expect(await me("fin@x.id")).not.toBeNull();
    expect(hr).toBeGreaterThan(0);
  });
  it("opens the database file for the owner only", async () => {
    const { mkdtempSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const path = join(mkdtempSync(join(tmpdir(), "patuh-perm-")), "sub", "p.db");
    openDb(path);
    expect(statSync(path).mode & 0o077).toBe(0);
  });
});

describe("security hardening", () => {
  const from = (app: App, ip: string, email: string, password: string) =>
    app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "patuh" }, body: JSON.stringify({ email, password }) },
      { incoming: { socket: { remoteAddress: ip } } });
  it("an attacker's failures lock email+IP, not the admin on another IP", async () => {
    const { app } = await setup();
    for (let i = 0; i < 5; i++) await from(app, "203.0.113.7", "admin@x.id", "wrong wrong wrong");
    expect((await from(app, "203.0.113.7", "admin@x.id", PW)).status).toBe(429);
    expect((await from(app, "198.51.100.2", "admin@x.id", PW)).status).toBe(200);
  });
  it("one IP guessing many emails is throttled", async () => {
    const { app } = await setup();
    for (let i = 0; i < 30; i++) await from(app, "203.0.113.9", `u${i}@x.id`, "wrong wrong wrong");
    expect((await from(app, "203.0.113.9", "fresh@x.id", "wrong wrong wrong")).status).toBe(429);
  });
  it("logs exports and searches in the audit trail without the search text", async () => {
    const { app, db, hr } = await setup();
    const { cookie } = await login(app, "admin@x.id");
    const id = (await json(await call(app, "/api/activities", { cookie, body: { name: "P", department_id: hr } }))).id;
    await call(app, `/api/activities/${id}/dpia.docx?lang=id`, { cookie });
    await call(app, "/api/search?q=secret-term-xyz", { cookie });
    await call(app, "/api/dashboard", { cookie });
    const rows = db.prepare("SELECT method,path FROM audit_log WHERE method='GET'").all() as { method: string; path: string }[];
    expect(rows.map((r) => r.path)).toEqual([`/api/activities/${id}/dpia.docx`, "/api/search"]);
  });
  it("refuses link-local and metadata addresses as AI endpoint", async () => {
    const { app } = await setup();
    const { cookie } = await login(app, "admin@x.id");
    for (const u of ["http://169.254.169.254/v1", "http://[fe80::1]/v1", "http://metadata.google.internal/v1"])
      expect((await call(app, "/api/settings/ai", { method: "PUT", cookie, body: { base_url: u, model: "m" } })).status).toBe(400);
    expect((await call(app, "/api/settings/ai", { method: "PUT", cookie, body: { base_url: "http://localhost:11434/v1", model: "m" } })).status).toBe(200);
  });
  it("stores the AI key encrypted, never shows it, and encrypts old plaintext on read", async () => {
    const { app, db } = await setup();
    const { cookie } = await login(app, "admin@x.id");
    await call(app, "/api/settings/ai", { method: "PUT", cookie, body: { base_url: "http://localhost:1/v1", model: "m", api_key: "sk-test-123" } });
    const raw = () => (db.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get() as { value: string }).value;
    expect(raw()).toMatch(/^enc1:/); expect(raw()).not.toContain("sk-test");
    expect(aiConfig(db)?.apiKey).toBe("sk-test-123");
    db.prepare("UPDATE settings SET value='sk-old-plain' WHERE key='ai_api_key'").run();
    expect(aiConfig(db)?.apiKey).toBe("sk-old-plain");
    expect(raw()).toMatch(/^enc1:/);
    expect((await json(await call(app, "/api/settings", { cookie }))).ai.hasKey).toBe(true);
  });
});
