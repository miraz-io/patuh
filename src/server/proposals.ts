// A person decides what happens to an AI proposal. Nothing the AI suggests touches the record before this.
import type { DatabaseSync } from "node:sqlite";
import { addRisks, clip, inTx, isObj, level, setMeta } from "./ai.js";
import { updateActivity } from "./db.js";
import { cleanActivity } from "./validate.js";

type Q = Record<string, string | number | null>;
export type Decision = { ok: true; status: "accepted" | "edited" | "rejected" } | { ok: false; code: 404 | 409 | 400; error: string };

export function decide(db: DatabaseSync, userId: number, canSign: boolean, id: number, action: "accept" | "reject", edited?: unknown): Decision {
  const p = db.prepare("SELECT * FROM ai_proposal WHERE id=?").get(id) as Q | undefined;
  if (!p) return { ok: false, code: 404, error: "not found" };
  if (p.status !== "pending") return { ok: false, code: 409, error: `already ${p.status}` };
  const mark = (status: string) => db.prepare("UPDATE ai_proposal SET status=?, decided_by=?, decided_at=CURRENT_TIMESTAMP WHERE id=?").run(status, userId, id);
  if (action === "reject") { mark("rejected"); return { ok: true, status: "rejected" }; }

  const act = p.activity_id as number, after = JSON.parse(p.after_json as string), before = JSON.parse(p.before_json as string), cites = JSON.parse(p.cites as string) as string[];
  const row = db.prepare("SELECT * FROM activities WHERE id=?").get(act) as Q;
  const stale = () => ({ ok: false, code: 409, error: "This changed since the AI looked at it. Ask again.", stale: true } as const);
  let status: "accepted" | "edited" = "accepted";
  try {
    inTx(db, () => {
      switch (p.kind) {
        case "field": {
          const f = p.target as string;
          if (String(row[f]) !== String(before)) throw stale(); // optimistic concurrency: only apply on top of what the AI saw
          let value = after;
          if (edited !== undefined && f !== "cross_border") { if (typeof edited !== "string") throw { ok: false, code: 400, error: "edited value must be text" }; value = edited; status = value === after ? "accepted" : "edited"; }
          const v = cleanActivity({ [f]: value }); if ("error" in v) throw { ok: false, code: 400, error: v.error };
          updateActivity(db, act, v.value);
          setMeta(db, act, f, status === "edited" ? "user" : "ai_draft", true, cites); // accepting is the human review
          break;
        }
        case "screening": {
          const cur = JSON.parse(row.screening as string) as string[];
          if (JSON.stringify([...cur].sort()) !== JSON.stringify([...before].sort())) throw stale();
          const v = cleanActivity({ screening: after }); if ("error" in v) throw { ok: false, code: 400, error: v.error };
          updateActivity(db, act, v.value); setMeta(db, act, "screening", "ai_draft", true, cites);
          break;
        }
        case "risk": {
          const r = after as { title: string; description: string; likelihood: number; severity: number; residual_likelihood: number | null; residual_severity: number | null; controls: string[] };
          addRisks(db, act, [{ title: r.title, description: r.description, likelihood: r.likelihood, severity: r.severity, rl: r.residual_likelihood, rs: r.residual_severity, controls: r.controls }], true, true);
          break;
        }
        case "control": {
          const a = after as { risk_id: number; title: string };
          if (!db.prepare("SELECT id FROM risks WHERE id=? AND activity_id=?").get(a.risk_id, act)) throw stale();
          db.prepare("INSERT INTO controls (risk_id,title) VALUES (?,?)").run(a.risk_id, clip(a.title, 200));
          break;
        }
        case "residual": {
          const a = after as { risk_id: number; residual_likelihood: number | null; residual_severity: number | null };
          if (!db.prepare("SELECT id FROM risks WHERE id=? AND activity_id=?").get(a.risk_id, act)) throw stale();
          if (level(a.residual_likelihood)) db.prepare("UPDATE risks SET residual_likelihood=? WHERE id=?").run(a.residual_likelihood, a.risk_id);
          if (level(a.residual_severity)) db.prepare("UPDATE risks SET residual_severity=? WHERE id=?").run(a.residual_severity, a.risk_id);
          break;
        }
        default: throw { ok: false, code: 400, error: "unknown proposal" };
      }
      if (!canSign) db.prepare("UPDATE activities SET signed_by='' WHERE id=?").run(act); // changed content needs a fresh sign-off
      mark(status);
    });
  } catch (e) {
    if (isObj(e) && e.ok === false) { if (e.stale) mark("stale"); return { ok: false, code: e.code, error: e.error } as Decision; } // after the rollback, so the status sticks
    throw e;
  }
  return { ok: true, status };
}
