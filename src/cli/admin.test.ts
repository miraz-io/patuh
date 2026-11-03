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
    await expect(run(["user", "remove", "--db", db, "--email", "a@o.id"])).rejects.toThrow(/last admin/);
    await run(["user", "disable", "--db", db, "--email", "m@o.id"]);
    expect(openDb(db).prepare("SELECT disabled FROM users WHERE email='m@o.id'").get()).toEqual({ disabled: 1 });
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
