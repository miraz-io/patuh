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
