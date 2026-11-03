// Numbers behind the dashboard charts. Pure function, so it is easy to test.
import { riskLevel, type Level } from "./risk.js";
import { screen } from "./screening.js";

export type OvActivity = { id: number; department: string; screening: string[]; signed: boolean };
export type OvRisk = { activity_id: number; likelihood: number; severity: number; residual_likelihood: number | null; residual_severity: number | null; id: number };
export type OvControl = { risk_id: number; status: string };

export type Overview = {
  pipeline: { registered: number; required: number; assessed: number; complete: number; signed: number };
  /** matrix[severity-1][likelihood-1] = number of risks in that cell */
  matrix: { before: number[][]; after: number[][] };
  controls: { planned: number; inProgress: number; done: number };
  departments: { name: string; counts: Record<Level | "none", number>; total: number }[];
};

const grid = () => Array.from({ length: 4 }, () => Array(4).fill(0) as number[]);
const ORDER: Level[] = ["low", "medium", "high", "very-high"];

export function buildOverview(acts: OvActivity[], risks: OvRisk[], controls: OvControl[]): Overview {
  const risksOf = new Map<number, OvRisk[]>();
  for (const r of risks) risksOf.set(r.activity_id, [...(risksOf.get(r.activity_id) ?? []), r]);
  const controlsOf = new Map<number, OvControl[]>();
  for (const k of controls) controlsOf.set(k.risk_id, [...(controlsOf.get(k.risk_id) ?? []), k]);

  const out: Overview = {
    pipeline: { registered: acts.length, required: 0, assessed: 0, complete: 0, signed: 0 },
    matrix: { before: grid(), after: grid() },
    controls: { planned: 0, inProgress: 0, done: 0 },
    departments: [],
  };
  const dept = new Map<string, Overview["departments"][number]>();

  for (const a of acts) {
    const rs = risksOf.get(a.id) ?? [];
    const ks = rs.flatMap((r) => controlsOf.get(r.id) ?? []);
    // each stage is a subset of the one before, so the funnel only narrows
    if (screen(a.screening).dpiaRequired) {
      out.pipeline.required++;
      if (rs.length) {
        out.pipeline.assessed++;
        if (ks.length && ks.every((k) => k.status === "done")) { out.pipeline.complete++; if (a.signed) out.pipeline.signed++; }
      }
    }
    const d = dept.get(a.department) ?? { name: a.department, counts: { low: 0, medium: 0, high: 0, "very-high": 0, none: 0 }, total: 0 };
    d.total++;
    const residual = rs.map((r) => riskLevel(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity).level);
    d.counts[residual.length ? ORDER[Math.max(...residual.map((l) => ORDER.indexOf(l)))] : "none"]++;
    dept.set(a.department, d);
  }
  for (const r of risks) {
    out.matrix.before[r.severity - 1][r.likelihood - 1]++;
    out.matrix.after[(r.residual_severity ?? r.severity) - 1][(r.residual_likelihood ?? r.likelihood) - 1]++;
  }
  for (const k of controls) {
    if (k.status === "done") out.controls.done++; else if (k.status === "in-progress") out.controls.inProgress++; else out.controls.planned++;
  }
  out.departments = [...dept.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return out;
}
