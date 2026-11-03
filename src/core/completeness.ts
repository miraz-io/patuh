// What is still missing before a process can be signed off. Deterministic: the AI proposes, this decides what counts as done.
import { CRITERIA, screen } from "./screening.js";

export const REQUIRED_FIELDS = ["purpose", "description", "data_categories", "data_subjects", "legal_basis", "retention", "necessity", "data_location"] as const;
export type State = "empty" | "draft" | "confirmed"; // draft = written by an AI, not yet confirmed by a person

export type Meta = { field: string; source: "user" | "ai_draft" | "ai_assumption"; confirmed: number };
export type CRisk = { id: number; title: string; source: string; confirmed: number; controls: number };
export type CAct = Record<string, unknown> & { screening: string[] };

export type Gap = { key: string; kind: "screening" | "field" | "risk" | "control" | "confirm" ; state: State; risk_id?: number };
export type Completeness = { items: { key: string; kind: Gap["kind"]; state: State; risk_id?: number }[]; confirmed: number; total: number; gaps: Gap[]; ready: boolean };

export function completeness(act: CAct, meta: Meta[], risks: CRisk[]): Completeness {
  const m = new Map(meta.map((x) => [x.field, x]));
  // A field with no provenance row was typed by a person (or predates provenance tracking).
  const stateOf = (field: string, filled: boolean): State => (!filled ? "empty" : m.get(field) && !m.get(field)!.confirmed ? "draft" : "confirmed");
  const items: Completeness["items"] = [];
  const dpia = screen(act.screening).dpiaRequired;
  const sm = m.get("screening");
  items.push({ key: "screening", kind: "screening", state: act.screening.length ? stateOf("screening", true) : sm?.confirmed ? "confirmed" : "empty" });
  for (const f of REQUIRED_FIELDS) items.push({ key: f, kind: "field", state: stateOf(f, String(act[f] ?? "").trim() !== "") });
  if (dpia) {
    if (!risks.length) items.push({ key: "risks", kind: "risk", state: "empty" });
    for (const r of risks) {
      items.push({ key: `risk:${r.id}`, kind: "risk", state: r.confirmed ? "confirmed" : "draft", risk_id: r.id });
      items.push({ key: `controls:${r.id}`, kind: "control", state: r.controls ? "confirmed" : "empty", risk_id: r.id });
    }
  }
  const gaps: Gap[] = items.filter((i) => i.state !== "confirmed").map((i) => ({ key: i.key, kind: i.kind === "field" || i.kind === "screening" ? i.kind : i.kind, state: i.state, risk_id: i.risk_id }));
  return { items, confirmed: items.length - gaps.length, total: items.length, gaps, ready: gaps.length === 0 };
}

const Q = {
  en: {
    screening: "Does this process do any of the things in the DPIA checklist (automated decisions, sensitive data, large scale, profiling, new technology…)?",
    purpose: "What is the purpose of this process, in one sentence?", description: "In a few sentences: what happens, step by step?",
    data_categories: "Which personal data does it use (for example name, contact, ID, health, location)?", data_subjects: "Whose data is it (customers, employees, applicants…)?",
    legal_basis: "Why may you process this data: consent, a contract, a legal duty, or a legitimate interest?", retention: "How long is the data kept, and what happens after that?",
    necessity: "Could you reach the purpose with less data? Why is this amount needed?", data_location: "Where is the data stored (country, cloud, vendor)?",
    risks: "What could go wrong for the people whose data it is (wrong decisions, leaks, loss of control)?", risk: "Please check this risk and confirm it.", controls: "What measure will reduce this risk, and who owns it?",
  },
  id: {
    screening: "Apakah proses ini melakukan hal-hal dalam daftar periksa DPIA (keputusan otomatis, data sensitif, skala besar, profiling, teknologi baru…)?",
    purpose: "Apa tujuan proses ini, dalam satu kalimat?", description: "Dalam beberapa kalimat: apa yang terjadi, langkah demi langkah?",
    data_categories: "Data pribadi apa yang dipakai (misalnya nama, kontak, KTP, kesehatan, lokasi)?", data_subjects: "Data siapa (pelanggan, karyawan, pelamar…)?",
    legal_basis: "Mengapa data ini boleh diproses: persetujuan, perjanjian, kewajiban hukum, atau kepentingan yang sah?", retention: "Berapa lama data disimpan, dan apa yang terjadi setelahnya?",
    necessity: "Apakah tujuan bisa dicapai dengan data lebih sedikit? Mengapa jumlah ini diperlukan?", data_location: "Di mana data disimpan (negara, cloud, vendor)?",
    risks: "Apa yang bisa salah bagi pemilik data (keputusan keliru, kebocoran, hilangnya kendali)?", risk: "Mohon periksa risiko ini dan konfirmasikan.", controls: "Langkah apa yang akan menurunkan risiko ini, dan siapa pemiliknya?",
  },
};

/** The question for one gap, from a fixed bank: the AI may choose and explain which to ask, never invent new ones. */
export function questionFor(g: Gap, lang: "en" | "id"): string {
  const q = Q[lang] as Record<string, string>;
  if (g.kind === "risk") return g.key === "risks" ? q.risks : q.risk;
  if (g.kind === "control") return q.controls;
  return q[g.key] ?? g.key;
}

export const CRITERIA_IDS = CRITERIA.map((c) => c.id);
