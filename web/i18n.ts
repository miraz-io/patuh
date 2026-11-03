export type Lang = "en" | "id";
export type L = { en: string; id: string };

const en = {
  dashboard: "Dashboard", processes: "Processes", tutorials: "Tutorials", total: "Processes", needDpia: "DPIA required", openCtl: "Open controls",
  consult: "Need authority consultation", name: "Process", dept: "Department", dpia: "DPIA", risks: "Risks", status: "Status",
  yes: "Required", no: "Not required", newProc: "New process", addDept: "Add department", back: "Back",
  screening: "1. Does a DPIA apply? (tick what is true)", details: "2. Describe the process", risksH: "3. Risks and controls",
  addRisk: "Add risk", likelihood: "Likelihood (1-4)", severity: "Severity (1-4)", resL: "Residual likelihood", resS: "Residual severity",
  addCtl: "Add control", owner: "Owner", due: "Due", exportEn: "Download DPIA (English)", exportId: "Download DPIA (Indonesian)",
  consultFlag: "Authority consultation needed", none: "Nothing yet. Add a department, then a process.",
  fields: { purpose: "Purpose", description: "Description", data_categories: "Personal data processed", data_subjects: "People concerned",
    ai_system: "AI system / model", vendor: "Vendor / processor", data_location: "Where data is stored", legal_basis: "Legal basis",
    retention: "Retention", necessity: "Why is this necessary and proportionate?", dpo_advice: "DPO advice (DPO or admin only)",
    subjects_views: "Views of the people concerned", review_date: "Next review date (YYYY-MM-DD)", signed_by: "Signed off by (DPO or admin only)" },
  crossBorder: "Data leaves Indonesia", riskTitle: "Risk to people (e.g. biased decisions)", ctlTitle: "Control (e.g. human review)",
  readOnly: "You can view this process but not change it.",
  signIn: "Sign in", email: "Email", password: "Password", signInSso: "Sign in with your company account", signOut: "Sign out", or: "or",
  ssoError: "Single sign-on did not work. Try again or ask your admin.", ssoDenied: "Your account has no access yet. Ask your admin.",
  roles: { admin: "Admin", dpo: "DPO", member: "Department member", auditor: "Auditor" },
  tutorialsIntro: "Short guided tours on the demo data. They move through the app for you and explain each part. Replay any of them whenever you like.",
  play: "Play", replay: "Play again", completed: "Done", steps: "steps", min: "min",
  tourPrompt: "New here? Take a 2-minute guided tour of Patuh.", tourStart: "Start the tour", tourLater: "Not now",
  next: "Next", prev: "Back", finish: "Finish", skip: "Close", tryIt: "Your turn: click the highlighted item.",
  demoBanner: "Demo data",
};

const id: typeof en = {
  dashboard: "Dasbor", processes: "Proses", tutorials: "Tutorial", total: "Proses", needDpia: "Perlu DPIA", openCtl: "Kontrol terbuka",
  consult: "Perlu konsultasi Lembaga", name: "Proses", dept: "Departemen", dpia: "DPIA", risks: "Risiko", status: "Status",
  yes: "Wajib", no: "Tidak wajib", newProc: "Proses baru", addDept: "Tambah departemen", back: "Kembali",
  screening: "1. Apakah DPIA berlaku? (centang yang benar)", details: "2. Jelaskan prosesnya", risksH: "3. Risiko dan kontrol",
  addRisk: "Tambah risiko", likelihood: "Kemungkinan (1-4)", severity: "Dampak (1-4)", resL: "Kemungkinan residual", resS: "Dampak residual",
  addCtl: "Tambah kontrol", owner: "Penanggung jawab", due: "Tenggat", exportEn: "Unduh DPIA (Inggris)", exportId: "Unduh DPIA (Indonesia)",
  consultFlag: "Perlu konsultasi Lembaga", none: "Belum ada. Tambah departemen, lalu proses.",
  fields: { purpose: "Tujuan", description: "Deskripsi", data_categories: "Data pribadi yang diproses", data_subjects: "Subjek data",
    ai_system: "Sistem AI / model", vendor: "Vendor / prosesor", data_location: "Lokasi penyimpanan data", legal_basis: "Dasar pemrosesan",
    retention: "Retensi", necessity: "Mengapa ini perlu dan proporsional?", dpo_advice: "Saran PPDP (hanya PPDP atau admin)",
    subjects_views: "Pandangan subjek data", review_date: "Tanggal peninjauan berikutnya (YYYY-MM-DD)", signed_by: "Disahkan oleh (hanya PPDP atau admin)" },
  crossBorder: "Data keluar dari Indonesia", riskTitle: "Risiko bagi subjek data (mis. keputusan bias)", ctlTitle: "Kontrol (mis. tinjauan manusia)",
  readOnly: "Anda dapat melihat proses ini tetapi tidak dapat mengubahnya.",
  signIn: "Masuk", email: "Email", password: "Kata sandi", signInSso: "Masuk dengan akun perusahaan", signOut: "Keluar", or: "atau",
  ssoError: "Single sign-on gagal. Coba lagi atau hubungi admin.", ssoDenied: "Akun Anda belum memiliki akses. Hubungi admin.",
  roles: { admin: "Admin", dpo: "PPDP", member: "Anggota departemen", auditor: "Auditor" },
  tutorialsIntro: "Tur singkat dengan data demo. Tur berpindah halaman sendiri dan menjelaskan setiap bagian. Putar ulang kapan saja.",
  play: "Mulai", replay: "Putar lagi", completed: "Selesai", steps: "langkah", min: "mnt",
  tourPrompt: "Baru di sini? Ikuti tur 2 menit untuk mengenal Patuh.", tourStart: "Mulai tur", tourLater: "Nanti",
  next: "Lanjut", prev: "Kembali", finish: "Selesai", skip: "Tutup", tryIt: "Giliran Anda: klik bagian yang disorot.",
  demoBanner: "Data demo",
};

export const TXT = { en, id };
export type T = typeof en;
