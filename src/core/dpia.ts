// DPIA document. Structure follows GDPR Art. 35(7) (accepted by EU regulators) and carries the UU PDP Pasal 34
// screening basis, so one document serves both. Output: .docx so organisations can edit and sign it.
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { CRITERIA, screen } from "./screening.js";
import { needsPriorConsultation, riskLevel, type Level } from "./risk.js";

export type Lang = "en" | "id";
export type Activity = {
  name: string; department: string; purpose: string; description: string; data_categories: string;
  data_subjects: string; ai_system: string; vendor: string; data_location: string; cross_border: number;
  legal_basis: string; retention: string; necessity: string; screening: string[]; dpo_advice: string;
  subjects_views: string; review_date: string; signed_by: string;
};
export type RiskRow = {
  title: string; description: string; likelihood: number; severity: number;
  residual_likelihood: number | null; residual_severity: number | null;
  controls: { title: string; owner: string; due: string; status: string }[];
};

const T = {
  en: {
    title: "Data Protection Impact Assessment (DPIA)", basis: "Legal basis for this assessment",
    s1: "1. Systematic description of the processing", s2: "2. Necessity and proportionality",
    s3: "3. Risks to the rights and freedoms of people", s4: "4. Measures to address the risks",
    s5: "5. Advice, views and consultation", s6: "6. Review and sign-off",
    dept: "Department", purpose: "Purpose", desc: "Description", data: "Personal data processed",
    subjects: "People concerned", ai: "AI system / model", vendor: "Vendor / processor", loc: "Where data is stored",
    xb: "Data leaves Indonesia", yes: "Yes", no: "No", lb: "Legal basis (lawfulness)", ret: "Retention",
    triggers: "Why a DPIA is needed", none: "No high-risk criteria selected.",
    inh: "Inherent risk", res: "Residual risk", ctl: "Control", owner: "Owner", due: "Due", status: "Status",
    dpo: "Advice of the data protection officer", views: "Views of the people concerned (or why not sought)",
    consult: "Prior consultation with the authority (GDPR Art. 36 / UU PDP): required because high residual risk remains.",
    consultNo: "Prior consultation with the authority: not triggered (no high residual risk).",
    review: "Next review date (also when the processing or risk changes)", signed: "Signed off by", todo: "(to be completed)",
    law: (b: string) => b === "uu-pdp" ? "UU PDP No. 27/2022 Article 34(2): at least one high-risk category applies."
      : b === "gdpr-two-criteria" ? "GDPR Art. 35 / EDPB criteria: two or more criteria apply."
      : "Voluntary assessment (no mandatory criteria matched).",
    lvl: { low: "Low", medium: "Medium", high: "High", "very-high": "Very high" } as Record<Level, string>,
  },
  id: {
    title: "Penilaian Dampak Pelindungan Data Pribadi (DPIA)", basis: "Dasar hukum penilaian ini",
    s1: "1. Deskripsi sistematis pemrosesan", s2: "2. Kebutuhan dan proporsionalitas",
    s3: "3. Risiko terhadap hak dan kebebasan subjek data", s4: "4. Langkah mengatasi risiko",
    s5: "5. Saran, pandangan dan konsultasi", s6: "6. Peninjauan dan pengesahan",
    dept: "Departemen", purpose: "Tujuan", desc: "Deskripsi", data: "Data pribadi yang diproses",
    subjects: "Subjek data", ai: "Sistem AI / model", vendor: "Vendor / prosesor", loc: "Lokasi penyimpanan data",
    xb: "Data keluar dari Indonesia", yes: "Ya", no: "Tidak", lb: "Dasar pemrosesan (kesahan)", ret: "Retensi",
    triggers: "Mengapa DPIA diperlukan", none: "Tidak ada kriteria berisiko tinggi yang dipilih.",
    inh: "Risiko awal", res: "Risiko residual", ctl: "Kontrol", owner: "Penanggung jawab", due: "Tenggat", status: "Status",
    dpo: "Saran Pejabat Pelindungan Data Pribadi (PPDP)", views: "Pandangan subjek data (atau alasan tidak diminta)",
    consult: "Konsultasi dengan Lembaga (UU PDP / GDPR Art. 36): diperlukan karena masih ada risiko residual tinggi.",
    consultNo: "Konsultasi dengan Lembaga: tidak terpicu (tidak ada risiko residual tinggi).",
    review: "Tanggal peninjauan berikutnya (juga bila pemrosesan atau risiko berubah)", signed: "Disahkan oleh", todo: "(belum diisi)",
    law: (b: string) => b === "uu-pdp" ? "UU PDP No. 27/2022 Pasal 34 ayat (2): sedikitnya satu kategori berisiko tinggi berlaku."
      : b === "gdpr-two-criteria" ? "GDPR Art. 35 / kriteria EDPB: dua kriteria atau lebih berlaku."
      : "Penilaian sukarela (tidak ada kriteria wajib yang terpenuhi).",
    lvl: { low: "Rendah", medium: "Sedang", high: "Tinggi", "very-high": "Sangat tinggi" } as Record<Level, string>,
  },
};

const p = (text: string) => new Paragraph({ children: [new TextRun(text)] });
const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
const cell = (text: string, bold = false) =>
  new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
const table = (rows: string[][], header = false) =>
  new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, i) => new TableRow({ children: r.map((c) => cell(c, header && i === 0)) })) });

export function buildDpia(a: Activity, risks: RiskRow[], lang: Lang): Document {
  const t = T[lang];
  const s = screen(a.screening);
  const lvl = (l: number, sv: number) => { const r = riskLevel(l, sv); return `${t.lvl[r.level]} (${r.score})`; };
  const residual = risks.map((r) =>
    riskLevel(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity).level);
  const v = (x: string) => x || t.todo;
  const trig = CRITERIA.filter((c) => s.matched.includes(c.id))
    .map((c) => `• ${lang === "en" ? c.en : c.id_}${c.uu ? ` [UU PDP 34(2)${c.uu}]` : ""} [${c.gdpr}]`);

  return new Document({ sections: [{ children: [
    new Paragraph({ text: t.title, heading: HeadingLevel.TITLE }),
    p(`${a.name}`),
    p(`${t.basis}: ${t.law(s.basis)}`),
    h(t.s1),
    table([[t.dept, a.department], [t.purpose, v(a.purpose)], [t.desc, v(a.description)], [t.data, v(a.data_categories)],
      [t.subjects, v(a.data_subjects)], [t.ai, v(a.ai_system)], [t.vendor, v(a.vendor)], [t.loc, v(a.data_location)],
      [t.xb, a.cross_border ? t.yes : t.no]]),
    p(`${t.triggers}:`), ...(trig.length ? trig.map(p) : [p(t.none)]),
    h(t.s2),
    table([[t.lb, v(a.legal_basis)], [t.ret, v(a.retention)], [t.s2, v(a.necessity)]]),
    h(t.s3),
    table([["", t.inh, t.res], ...risks.map((r) => [
      `${r.title}${r.description ? ` – ${r.description}` : ""}`, lvl(r.likelihood, r.severity),
      lvl(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity)])], true),
    h(t.s4),
    table([[t.ctl, `${t.owner} / ${t.due} / ${t.status}`],
      ...risks.flatMap((r) => r.controls.map((c) => [`${r.title}: ${c.title}`, `${c.owner} / ${c.due} / ${c.status}`]))], true),
    h(t.s5),
    table([[t.dpo, v(a.dpo_advice)], [t.views, v(a.subjects_views)]]),
    p(needsPriorConsultation(residual) ? t.consult : t.consultNo),
    h(t.s6),
    table([[t.review, v(a.review_date)], [t.signed, v(a.signed_by)]]),
  ] }] });
}

export const dpiaBuffer = (a: Activity, risks: RiskRow[], lang: Lang) => Packer.toBuffer(buildDpia(a, risks, lang));
