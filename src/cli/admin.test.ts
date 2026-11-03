import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../server/db.js";
import { demoLoaded, loadDemo, removeDemo, DEMO_DEPARTMENTS } from "../server/demo.js";
import { screen } from "../core/screening.js";
import { run } from "./admin.js";

describe("demo data", () => {
  it("loads once, with a realistic mix, and removes cleanly", () => {
    const db = openDb(":memory:");
    expect(loadDemo(db)).toEqual({ departments: DEMO_DEPARTMENTS.length, processes: 11 });
    expect(loadDemo(db).processes).toBe(0); // idempotent
    expect(demoLoaded(db)).toBe(true);
    const acts = db.prepare("SELECT screening FROM activities").all() as { screening: string }[];
    const required = acts.filter((a) => screen(JSON.parse(a.screening)).dpiaRequired).length;
    expect(required).toBeGreaterThan(5);
    expect(required).toBeLessThan(acts.length); // at least one process shows "no DPIA needed"
    expect(db.prepare("SELECT COUNT(*) n FROM controls WHERE status='done'").get()).not.toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM controls WHERE status!='done'").get()).not.toMatchObject({ n: 0 });
    removeDemo(db);
    expect(demoLoaded(db)).toBe(false);
    for (const t of ["activities", "departments", "risks", "controls"]) expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toMatchObject({ n: 0 });
  });
  it("keeps real work: reuses an existing department and survives removal", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO departments (name) VALUES ('Human Resources')").run();
    loadDemo(db);
    const dept = db.prepare("SELECT id FROM departments WHERE name='Marketing'").get() as { id: number };
    db.prepare("INSERT INTO activities (department_id,name) VALUES (?, 'Our real process')").run(dept.id);
    removeDemo(db);
    expect(db.prepare("SELECT name FROM activities").all()).toEqual([{ name: "Our real process" }]);
    expect(db.prepare("SELECT name FROM departments ORDER BY name").all()).toEqual([{ name: "Human Resources" }, { name: "Marketing" }]);
  });
});

describe("database upgrade and demo removal", () => {
  it("adds the demo columns to a database created before they existed", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const path = join(mkdtempSync(join(tmpdir(), "patuh-old-")), "old.db");
    const old = new DatabaseSync(path);
    // the schema as it was on main: no `demo` columns
    old.exec(`CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE activities (id INTEGER PRIMARY KEY, department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', data_categories TEXT NOT NULL DEFAULT '',
        data_subjects TEXT NOT NULL DEFAULT '', ai_system TEXT NOT NULL DEFAULT '', vendor TEXT NOT NULL DEFAULT '', data_location TEXT NOT NULL DEFAULT '',
        cross_border INTEGER NOT NULL DEFAULT 0, legal_basis TEXT NOT NULL DEFAULT '', retention TEXT NOT NULL DEFAULT '', necessity TEXT NOT NULL DEFAULT '',
        screening TEXT NOT NULL DEFAULT '[]', dpo_advice TEXT NOT NULL DEFAULT '', subjects_views TEXT NOT NULL DEFAULT '', review_date TEXT NOT NULL DEFAULT '',
        signed_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    old.exec("INSERT INTO departments (name) VALUES ('Old'); INSERT INTO activities (department_id,name) VALUES (1,'Old process');");
    old.close();
    const db = openDb(path);
    expect(loadDemo(db).processes).toBe(11);
    removeDemo(db);
    expect(db.prepare("SELECT name FROM activities").all()).toEqual([{ name: "Old process" }]);
  });
  it("never deletes a demo department that real members belong to", async () => {
    const { createUser } = await import("../server/auth.js");
    const db = openDb(":memory:");
    loadDemo(db);
    const marketing = Number((db.prepare("SELECT id FROM departments WHERE name='Marketing'").get() as { id: number }).id);
    await createUser(db, { email: "m@x.id", name: "M", role: "member", departmentId: marketing, password: "a long enough password" });
    removeDemo(db);
    expect(db.prepare("SELECT name FROM departments").all()).toEqual([{ name: "Marketing" }]);
    expect(db.prepare("SELECT department_id FROM users").get()).toEqual({ department_id: marketing });
  });
});

describe("admin script", () => {
  let db: string;
  beforeEach(() => { db = join(mkdtempSync(join(tmpdir(), "patuh-")), "t.db"); vi.spyOn(console, "log").mockImplementation(() => {}); process.env.PATUH_NEW_PASSWORD = "a long enough password"; });

  it("init creates the organisation, an admin and optional demo data", async () => {
    await run(["init", "--db", db, "--org", "PT Contoh", "--admin-email", "boss@contoh.id", "--admin-name", "Boss", "--demo"]);
    const d = openDb(db);
    expect(d.prepare("SELECT value FROM settings WHERE key='org_name'").get()).toEqual({ value: "PT Contoh" });
    expect(d.prepare("SELECT email,role FROM users").all()).toEqual([{ email: "boss@contoh.id", role: "admin" }]);
    expect(demoLoaded(d)).toBe(true);
    await expect(run(["init", "--db", db, "--org", "X", "--admin-email", "b@c.id", "--no-demo"])).rejects.toThrow(/Already set up/);
  });
  it("init without demo leaves the workspace empty", async () => {
    await run(["init", "--db", db, "--org", "PT Kosong", "--admin-email", "a@kosong.id", "--admin-name", "A", "--no-demo"]);
    expect(demoLoaded(openDb(db))).toBe(false);
    expect(openDb(db).prepare("SELECT COUNT(*) n FROM activities").get()).toEqual({ n: 0 });
  });
  it("adds users by role, SSO-only users, and protects the last admin", async () => {
    await run(["init", "--db", db, "--org", "O", "--admin-email", "a@o.id", "--admin-name", "A", "--no-demo"]);
    await run(["department", "add", "--db", db, "--name", "HR"]);
    await run(["user", "add", "--db", db, "--email", "m@o.id", "--name", "M", "--role", "member", "--department", "hr"]);
    await run(["user", "add", "--db", db, "--email", "s@o.id", "--name", "S", "--role", "auditor", "--sso"]);
    const rows = openDb(db).prepare("SELECT email,role,password_hash IS NULL AS sso FROM users ORDER BY id").all();
    expect(rows).toEqual([{ email: "a@o.id", role: "admin", sso: 0 }, { email: "m@o.id", role: "member", sso: 0 }, { email: "s@o.id", role: "auditor", sso: 1 }]);
    await expect(run(["user", "add", "--db", db, "--email", "x@o.id", "--name", "X", "--role", "member"])).rejects.toThrow(/department/);
    await expect(run(["user", "add", "--db", db, "--email", "x@o.id", "--name", "X", "--role", "boss", "--sso"])).rejects.toThrow(/Role/);
    await expect(run(["user", "disable", "--db", db, "--email", "a@o.id"])).rejects.toThrow(/last active admin/);
    await expect(run(["user", "remove", "--db", db, "--email", "a@o.id"])).rejects.toThrow(/last active admin/);
    await run(["user", "disable", "--db", db, "--email", "m@o.id"]);
    expect(openDb(db).prepare("SELECT disabled FROM users WHERE email='m@o.id'").get()).toEqual({ disabled: 1 });
  });
  it("last-admin guards count only other ACTIVE admins", async () => {
    await run(["init", "--db", db, "--org", "O", "--admin-email", "a@o.id", "--admin-name", "A", "--no-demo"]);
    await run(["user", "add", "--db", db, "--email", "b@o.id", "--name", "B", "--role", "admin", "--sso"]);
    await run(["user", "disable", "--db", db, "--email", "b@o.id"]);
    await expect(run(["user", "remove", "--db", db, "--email", "a@o.id"])).rejects.toThrow(/last active admin/); // B exists but is disabled
    await run(["user", "disable", "--db", db, "--email", "b@o.id"]); // already disabled: allowed, nothing is lost
    await run(["user", "remove", "--db", db, "--email", "b@o.id"]);
    await expect(run(["user", "disable", "--db", db, "--email", "a@o.id"])).rejects.toThrow(/last active admin/);
  });
  it("rejects weak passwords", async () => {
    process.env.PATUH_NEW_PASSWORD = "short";
    await expect(run(["init", "--db", db, "--org", "O", "--admin-email", "a@o.id", "--admin-name", "A", "--no-demo"])).rejects.toThrow(/at least 12/);
  });
  it("demo load and remove work on an existing workspace", async () => {
    await run(["init", "--db", db, "--org", "O", "--admin-email", "a@o.id", "--admin-name", "A", "--no-demo"]);
    await run(["demo", "load", "--db", db]);
    expect(demoLoaded(openDb(db))).toBe(true);
    await run(["demo", "remove", "--db", db]);
    expect(demoLoaded(openDb(db))).toBe(false);
  });
});
