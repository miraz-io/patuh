// Risk to people's rights and freedoms (GDPR Art. 35(7)(c)): likelihood x severity, 1..4 each.
export type Level = "low" | "medium" | "high" | "very-high";

export function riskLevel(likelihood: number, severity: number): { score: number; level: Level } {
  for (const n of [likelihood, severity]) {
    if (!Number.isInteger(n) || n < 1 || n > 4) throw new RangeError("likelihood and severity must be integers 1-4");
  }
  const score = likelihood * severity;
  const level: Level = score >= 12 ? "very-high" : score >= 8 ? "high" : score >= 4 ? "medium" : "low";
  return { score, level };
}

// Residual risk after controls: the DPIA is only acceptable if nothing stays very-high.
// ponytail: GDPR Art. 36 prior consultation maps to UU PDP's consultation with the Lembaga; any residual high
// risk triggers the flag, and the PP 33/2026 wording should be checked before relying on it as legal advice.
export function needsPriorConsultation(residual: Level[]): boolean {
  return residual.some((l) => l === "very-high" || l === "high");
}
