import { CRITERIA } from "../core/screening.js";
import type { Row } from "./db.js";

const TEXT_MAX = 5000;
const TEXT_FIELDS = ["purpose", "description", "data_categories", "data_subjects", "ai_system", "vendor", "data_location",
  "legal_basis", "retention", "necessity", "dpo_advice", "subjects_views", "signed_by"] as const;
// Only a DPO or admin may write these (separation of duties: the department proposes, the DPO signs).
export const SIGNOFF_FIELDS = ["dpo_advice", "signed_by"];
const DATE = /^(\d{4}-\d{2}-\d{2})?$/;

export const text = (v: unknown, max = TEXT_MAX): string | null => (typeof v === "string" && v.length <= max ? v : null);
export const date = (v: unknown): string | null => (typeof v === "string" && DATE.test(v) ? v : null);

export function cleanActivity(b: Record<string, unknown>): { value: Row } | { error: string } {
  const out: Row = {};
  if (b.name !== undefined) {
    const n = text(b.name, 200)?.trim(); if (!n) return { error: "name must be 1-200 characters" };
    out.name = n;
  }
  for (const f of TEXT_FIELDS) if (b[f] !== undefined) {
    const v = text(b[f]); if (v === null) return { error: `${f} must be text up to ${TEXT_MAX} characters` };
    out[f] = v;
  }
  if (b.review_date !== undefined) { const d = date(b.review_date); if (d === null) return { error: "review_date must be YYYY-MM-DD" }; out.review_date = d; }
  if (b.cross_border !== undefined) {
    if (![0, 1, true, false].includes(b.cross_border as never)) return { error: "cross_border must be 0 or 1" };
    out.cross_border = b.cross_border ? 1 : 0;
  }
  if (b.screening !== undefined) {
    const ids = CRITERIA.map((c) => c.id);
    if (!Array.isArray(b.screening) || b.screening.length > ids.length || !b.screening.every((s) => ids.includes(s))) return { error: "screening must be a list of known criteria" };
    out.screening = JSON.stringify([...new Set(b.screening as string[])]);
  }
  return { value: out };
}
