// DPIA screening. One list, two legal sources.
// uu = UU PDP 27/2022 Pasal 34(2) (a..g): ANY one => DPIA required.
// wp = EDPB/WP29 WP248 criteria (GDPR Art. 35): TWO or more => DPIA likely required.
// We apply the stricter rule: any UU PDP category requires a DPIA; vulnerable
// subjects (WP29 only) counts as an extra flag and is reported either way.

export type Criterion = {
  id: string;
  uu?: string; // UU PDP Pasal 34(2) letter
  wp: number; // WP248 criterion number
  gdpr: string;
  en: string;
  id_: string; // Indonesian
};

export const CRITERIA: Criterion[] = [
  { id: "automated-decision", uu: "a", wp: 2, gdpr: "Art. 35(3)(a), Art. 22",
    en: "Automated decisions with legal or similarly significant effects on people",
    id_: "Keputusan otomatis yang berakibat hukum atau berdampak signifikan bagi subjek data" },
  { id: "specific-data", uu: "b", wp: 4, gdpr: "Art. 35(3)(b), Art. 9-10",
    en: "Specific / sensitive personal data (health, biometric, genetic, children, finance, criminal records)",
    id_: "Data pribadi yang bersifat spesifik (kesehatan, biometrik, genetika, anak, keuangan, catatan kejahatan)" },
  { id: "large-scale", uu: "c", wp: 5, gdpr: "Art. 35(3)(b)",
    en: "Large-scale processing (many people, large volume, wide area or long duration)",
    id_: "Pemrosesan data pribadi dalam skala besar (banyak orang, volume besar, wilayah luas, jangka panjang)" },
  { id: "scoring-monitoring", uu: "d", wp: 1, gdpr: "Art. 35(3)(a), Art. 35(3)(c)",
    en: "Systematic evaluation, scoring, profiling or monitoring of people",
    id_: "Evaluasi, penskoran, profiling atau pemantauan yang sistematis terhadap subjek data" },
  { id: "data-matching", uu: "e", wp: 6, gdpr: "WP248 criterion 6",
    en: "Matching or combining datasets from different sources or purposes",
    id_: "Pencocokan atau penggabungan kelompok data dari sumber atau tujuan berbeda" },
  { id: "new-technology", uu: "f", wp: 8, gdpr: "Art. 35(1)",
    en: "New or innovative technology (includes generative AI, LLMs, machine learning on personal data)",
    id_: "Penggunaan teknologi baru (termasuk AI generatif, LLM, machine learning atas data pribadi)" },
  { id: "restricts-rights", uu: "g", wp: 9, gdpr: "WP248 criterion 9",
    en: "Processing that blocks people from using their rights, a service or a contract",
    id_: "Pemrosesan yang membatasi pelaksanaan hak subjek data atau akses ke layanan atau kontrak" },
  { id: "vulnerable-subjects", wp: 7, gdpr: "WP248 criterion 7, Recital 75",
    en: "Vulnerable people (children, employees, patients, elderly, anyone in an imbalance of power)",
    id_: "Subjek data rentan (anak, karyawan, pasien, lansia, pihak dengan ketimpangan posisi)" },
];

export type ScreeningResult = {
  dpiaRequired: boolean;
  basis: "uu-pdp" | "gdpr-two-criteria" | "none";
  matched: string[];
  uuCount: number;
  wpCount: number;
};

export function screen(answers: string[]): ScreeningResult {
  const matched = CRITERIA.filter((c) => answers.includes(c.id));
  const uuCount = matched.filter((c) => c.uu).length;
  const wpCount = matched.length;
  const basis = uuCount >= 1 ? "uu-pdp" : wpCount >= 2 ? "gdpr-two-criteria" : "none";
  return { dpiaRequired: basis !== "none", basis, matched: matched.map((c) => c.id), uuCount, wpCount };
}
