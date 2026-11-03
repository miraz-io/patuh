import { describe, expect, it } from "vitest";
import { riskLevel, needsPriorConsultation } from "./risk.js";
import { screen } from "./screening.js";

describe("screening", () => {
  it("no criteria -> no DPIA", () => expect(screen([]).dpiaRequired).toBe(false));
  it("one UU PDP category is enough (stricter than GDPR)", () => {
    const r = screen(["new-technology"]);
    expect(r).toMatchObject({ dpiaRequired: true, basis: "uu-pdp" });
  });
  it("vulnerable subjects alone is not enough", () => expect(screen(["vulnerable-subjects"]).dpiaRequired).toBe(false));
  it("vulnerable subjects + a UU PDP category counts both", () => {
    const r = screen(["vulnerable-subjects", "large-scale"]);
    expect(r).toMatchObject({ uuCount: 1, wpCount: 2, basis: "uu-pdp" });
  });
});

describe("risk", () => {
  it("scores and levels", () => {
    expect(riskLevel(1, 1)).toEqual({ score: 1, level: "low" });
    expect(riskLevel(2, 2).level).toBe("medium");
    expect(riskLevel(2, 4).level).toBe("high");
    expect(riskLevel(4, 4).level).toBe("very-high");
  });
  it("rejects bad input", () => expect(() => riskLevel(0, 5)).toThrow(RangeError));
  it("prior consultation on residual high risk", () => {
    expect(needsPriorConsultation(["low", "medium"])).toBe(false);
    expect(needsPriorConsultation(["low", "high"])).toBe(true);
  });
});

import { buildOverview } from "./overview.js";
describe("dashboard overview", () => {
  const acts = [
    { id: 1, department: "HR", screening: ["new-technology"], signed: true },   // required, assessed, controls done, signed
    { id: 2, department: "HR", screening: ["new-technology"], signed: false },  // required, assessed, controls open
    { id: 3, department: "Fin", screening: ["new-technology"], signed: false }, // required, nothing assessed yet
    { id: 4, department: "Fin", screening: [], signed: true },                  // no DPIA needed
  ];
  const risks = [
    { id: 10, activity_id: 1, likelihood: 3, severity: 4, residual_likelihood: 1, residual_severity: 4 },
    { id: 11, activity_id: 2, likelihood: 4, severity: 4, residual_likelihood: null, residual_severity: null },
  ];
  const controls = [{ risk_id: 10, status: "done" }, { risk_id: 11, status: "planned" }, { risk_id: 11, status: "in-progress" }];
  const o = buildOverview(acts, risks, controls);
  it("funnel only narrows", () => expect(o.pipeline).toEqual({ registered: 4, required: 3, assessed: 2, complete: 1, signed: 1 }));
  it("risk grids: severity row, likelihood column; residual defaults to inherent", () => {
    expect(o.matrix.before[3][2]).toBe(1); expect(o.matrix.before[3][3]).toBe(1);
    expect(o.matrix.after[3][0]).toBe(1); expect(o.matrix.after[3][3]).toBe(1);
  });
  it("controls by status", () => expect(o.controls).toEqual({ planned: 1, inProgress: 1, done: 1 }));
  it("departments by worst residual level", () => {
    const hr = o.departments.find((d) => d.name === "HR")!, fin = o.departments.find((d) => d.name === "Fin")!;
    expect(hr.counts).toMatchObject({ medium: 1, "very-high": 1 }); // residual 1x4 = 4 (medium), and 4x4 = 16 (very high)
    expect(fin.counts).toMatchObject({ none: 2 });                   // no risks recorded yet
    expect(o.departments.map((d) => d.name)).toEqual(["Fin", "HR"]); // same size, sorted by name
  });
});
