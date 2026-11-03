import { Hono } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { CRITERIA, screen } from "../core/screening.js";
import { needsPriorConsultation, riskLevel } from "../core/risk.js";
import { dpiaBuffer, type Activity, type Lang, type RiskRow } from "../core/dpia.js";
import { createActivity, updateActivity, type Row } from "./db.js";

type Q = Record<string, string | number | null>;
const all = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as Q[];
const bad = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 400, headers: { "content-type": "application/json" } });

function risksOf(db: DatabaseSync, activityId: number): RiskRow[] {
  return all(db, "SELECT * FROM risks WHERE activity_id=?", activityId).map((r) => ({
    ...(r as unknown as RiskRow), controls: all(db, "SELECT * FROM controls WHERE risk_id=?", r.id as number) as RiskRow["controls"] }));
}

export function createApp(db: DatabaseSync) {
  const app = new Hono();
  const json = async (c: { req: { json: () => Promise<unknown> } }) => (await c.req.json().catch(() => null)) as Row | null;

  app.get("/api/criteria", (c) => c.json(CRITERIA));

  app.get("/api/departments", (c) => c.json(all(db, "SELECT * FROM departments ORDER BY name")));
  app.post("/api/departments", async (c) => {
    const b = await json(c); if (!b || typeof b.name !== "string" || !b.name.trim()) return bad("name required");
    const r = db.prepare("INSERT INTO departments (name) VALUES (?)").run(b.name.trim());
    return c.json({ id: Number(r.lastInsertRowid) }, 201);
  });

  app.get("/api/activities", (c) => c.json(all(db,
    "SELECT a.*, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id ORDER BY a.id DESC")
    .map((a) => ({ ...a, screening: JSON.parse(a.screening as string) }))));
  app.post("/api/activities", async (c) => {
    const b = await json(c);
    if (!b || typeof b.name !== "string" || !b.name.trim() || !Number.isInteger(b.department_id)) return bad("name and department_id required");
    if (Array.isArray(b.screening)) b.screening = JSON.stringify(b.screening);
    return c.json({ id: createActivity(db, b.department_id as number, b) }, 201);
  });
  app.patch("/api/activities/:id", async (c) => {
    const b = await json(c); if (!b) return bad("invalid json");
    if (Array.isArray(b.screening)) b.screening = JSON.stringify(b.screening);
    updateActivity(db, Number(c.req.param("id")), b);
    return c.json({ ok: true });
  });

  app.post("/api/activities/:id/risks", async (c) => {
    const b = await json(c);
    if (!b || typeof b.title !== "string" || !b.title.trim()) return bad("title required");
    try { riskLevel(b.likelihood as number, b.severity as number); } catch { return bad("likelihood and severity must be 1-4"); }
    const r = db.prepare(`INSERT INTO risks (activity_id,title,description,likelihood,severity,residual_likelihood,residual_severity)
      VALUES (?,?,?,?,?,?,?)`).run(Number(c.req.param("id")), b.title.trim(), (b.description as string) ?? "",
      b.likelihood as number, b.severity as number, (b.residual_likelihood as number) ?? null, (b.residual_severity as number) ?? null);
    return c.json({ id: Number(r.lastInsertRowid) }, 201);
  });
  app.get("/api/activities/:id/risks", (c) => c.json(
    all(db, "SELECT * FROM risks WHERE activity_id=? ORDER BY id", Number(c.req.param("id"))).map((r) => ({
      ...r, controls: all(db, "SELECT * FROM controls WHERE risk_id=? ORDER BY id", r.id as number) }))));
  app.patch("/api/risks/:id", async (c) => {
    const b = await json(c); if (!b) return bad("invalid json");
    for (const k of ["residual_likelihood", "residual_severity"] as const) {
      if (b[k] === undefined) continue;
      if (!Number.isInteger(b[k]) || (b[k] as number) < 1 || (b[k] as number) > 4) return bad(`${k} must be 1-4`);
      db.prepare(`UPDATE risks SET ${k}=? WHERE id=?`).run(b[k] as number, Number(c.req.param("id"))); // key is from the allow-list above
    }
    return c.json({ ok: true });
  });
  app.patch("/api/controls/:id", async (c) => {
    const b = await json(c);
    if (!b || !["planned", "in-progress", "done"].includes(b.status as string)) return bad("status must be planned, in-progress or done");
    db.prepare("UPDATE controls SET status=? WHERE id=?").run(b.status as string, Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  app.post("/api/risks/:id/controls", async (c) => {
    const b = await json(c); if (!b || typeof b.title !== "string" || !b.title.trim()) return bad("title required");
    const r = db.prepare("INSERT INTO controls (risk_id,title,owner,due,status) VALUES (?,?,?,?,?)")
      .run(Number(c.req.param("id")), b.title.trim(), (b.owner as string) ?? "", (b.due as string) ?? "", (b.status as string) ?? "planned");
    return c.json({ id: Number(r.lastInsertRowid) }, 201);
  });

  app.get("/api/activities/:id/dpia.docx", async (c) => {
    const id = Number(c.req.param("id"));
    const row = all(db, "SELECT a.*, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id WHERE a.id=?", id)[0];
    if (!row) return c.json({ error: "not found" }, 404);
    const lang: Lang = c.req.query("lang") === "id" ? "id" : "en";
    const buf = await dpiaBuffer({ ...(row as unknown as Activity), screening: JSON.parse(row.screening as string) }, risksOf(db, id), lang);
    return new Response(new Uint8Array(buf), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="dpia-${id}-${lang}.docx"` } });
  });

  // One row per activity: is a DPIA needed, is it complete, is residual risk still high.
  app.get("/api/dashboard", (c) => c.json(all(db,
    "SELECT a.id, a.name, a.screening, d.name AS department FROM activities a JOIN departments d ON d.id=a.department_id")
    .map((a) => {
      const s = screen(JSON.parse(a.screening as string));
      const risks = risksOf(db, a.id as number);
      const open = risks.flatMap((r) => r.controls).filter((k) => k.status !== "done").length;
      const residual = risks.map((r) => riskLevel(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity).level);
      return { id: a.id, name: a.name, department: a.department, dpiaRequired: s.dpiaRequired, basis: s.basis,
        risks: risks.length, openControls: open, consultation: needsPriorConsultation(residual) };
    })));

  return app;
}
