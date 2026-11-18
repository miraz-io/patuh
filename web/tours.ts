import type { L } from "./i18n.js";

// Tours only move around and explain. They never change data, so they are safe to replay on real workspaces too.
// target = the data-tour="..." attribute on an element. click = the cursor clicks it for you. wait = the user must click it.
export type Page = "dashboard" | "processes" | "process";
export type Step = { page: Page; target?: string; title: L; body: L; click?: boolean; wait?: boolean };
export type Tour = { id: string; title: L; summary: L; minutes: number; steps: Step[] };

const s = (page: Page, en: [string, string], id: [string, string], extra: Partial<Step> = {}): Step =>
  ({ page, title: { en: en[0], id: id[0] }, body: { en: en[1], id: id[1] }, ...extra });

export const TOURS: Tour[] = [
  { id: "welcome", minutes: 2, title: { en: "Welcome to Patuh", id: "Selamat datang di Patuh" },
    summary: { en: "The big picture: the dashboard, one process and the DPIA document.", id: "Gambaran besar: dasbor, satu proses dan dokumen DPIA." },
    steps: [
      s("dashboard", ["Welcome to Patuh", "Patuh helps every department record how it uses personal data and AI, check the risk, and produce the DPIA document for UU PDP and GDPR. This tour shows how. Use Next or the arrow keys."],
        ["Selamat datang di Patuh", "Patuh membantu setiap departemen mencatat penggunaan data pribadi dan AI, menilai risikonya, dan menyusun dokumen DPIA untuk UU PDP dan GDPR. Tur ini menunjukkan caranya. Gunakan Lanjut atau tombol panah."]),
      s("dashboard", ["Your organisation at a glance", "How many processes are registered, how many need a DPIA, how many controls are still open, and which processes must be discussed with the authority."],
        ["Gambaran organisasi Anda", "Berapa proses yang terdaftar, berapa yang perlu DPIA, berapa kontrol yang masih terbuka, dan proses mana yang harus dikonsultasikan dengan Lembaga."], { target: "stats" }),
      s("dashboard", ["See where you stand", "The journey shows how far processes get: registered, DPIA required, risks assessed, controls complete, signed off. The two grids show every risk before and after controls, so you can see what the controls achieved. Hover any bar or cell for the numbers, or switch a chart to its table."],
        ["Lihat posisi Anda", "Perjalanan menunjukkan sejauh mana proses berjalan: terdaftar, perlu DPIA, risiko dinilai, kontrol selesai, disahkan. Dua kisi menunjukkan setiap risiko sebelum dan sesudah kontrol, sehingga hasil kontrol terlihat. Arahkan kursor ke bar atau sel untuk melihat angkanya, atau ubah grafik menjadi tabel."], { target: "charts" }),
      s("dashboard", ["Every process in one table", "Each row is one use of data or AI in a department. The DPIA column says if an assessment is required. The status shows if a high risk is still left after your controls."],
        ["Semua proses dalam satu tabel", "Setiap baris adalah satu penggunaan data atau AI di satu departemen. Kolom DPIA menunjukkan apakah penilaian wajib. Status menunjukkan apakah masih ada risiko tinggi setelah kontrol."], { target: "table" }),
      s("dashboard", ["Open a process", "Watch the cursor: it opens the first process for you."], ["Buka sebuah proses", "Perhatikan kursor: ia membuka proses pertama untuk Anda."], { target: "row-first", click: true }),
      s("process", ["Is a DPIA needed?", "Tick what is true for this process. Patuh decides if a DPIA is required, using the Indonesian law and the GDPR criteria together."],
        ["Apakah DPIA diperlukan?", "Centang yang benar untuk proses ini. Patuh menentukan apakah DPIA wajib, memakai hukum Indonesia dan kriteria GDPR sekaligus."], { target: "screening" }),
      s("process", ["Download the DPIA", "One click gives a Word document in English or Indonesian, filled in from what you entered and ready to review and sign."],
        ["Unduh DPIA", "Satu klik menghasilkan dokumen Word berbahasa Inggris atau Indonesia, terisi dari data Anda dan siap ditinjau dan ditandatangani."], { target: "export" }),
      s("dashboard", ["That is the idea", "Open Tutorials in the menu to replay this tour or to learn each part in more detail."],
        ["Itulah idenya", "Buka Tutorial di menu untuk memutar ulang tur ini atau mempelajari tiap bagian lebih rinci."], { target: "nav-tutorials" }),
    ] },
  { id: "screening", minutes: 2, title: { en: "Is a DPIA required?", id: "Apakah DPIA wajib?" },
    summary: { en: "How the screening questions work and which law each one comes from.", id: "Cara kerja pertanyaan penyaringan dan hukum asal tiap pertanyaan." },
    steps: [
      s("processes", ["Your list of processes", "All processes you can see. Members see their own department, the DPO and admins see everything."],
        ["Daftar proses Anda", "Semua proses yang dapat Anda lihat. Anggota melihat departemennya sendiri, PPDP dan admin melihat semuanya."], { target: "process-list" }),
      s("processes", ["Open one", "Try it: click the highlighted process."], ["Buka salah satu", "Coba: klik proses yang disorot."], { target: "proc-first", wait: true }),
      s("process", ["Eight simple questions", "Each question has a label showing its source: UU PDP Article 34(2) letters a to g, and the GDPR or EDPB criteria. You do not need to know the articles, just answer honestly."],
        ["Delapan pertanyaan sederhana", "Setiap pertanyaan memiliki label sumbernya: UU PDP Pasal 34 ayat (2) huruf a sampai g, dan kriteria GDPR atau EDPB. Anda tidak perlu hafal pasalnya, cukup jawab dengan jujur."], { target: "screening" }),
      s("process", ["The stricter rule wins", "Under UU PDP, one ticked category is enough to require a DPIA. Under GDPR it is two. Patuh applies the stricter one, so one document satisfies both."],
        ["Aturan yang lebih ketat berlaku", "Menurut UU PDP, satu kategori sudah cukup untuk mewajibkan DPIA. Menurut GDPR dua. Patuh memakai yang lebih ketat, sehingga satu dokumen memenuhi keduanya."], { target: "screening" }),
      s("dashboard", ["The result shows up here", "Back on the dashboard, the DPIA column now reflects your answers for every process.", ],
        ["Hasilnya tampil di sini", "Kembali di dasbor, kolom DPIA kini mencerminkan jawaban Anda untuk setiap proses."], { target: "table" }),
    ] },
  { id: "register", minutes: 3, title: { en: "Register a process", id: "Daftarkan sebuah proses" },
    summary: { en: "Add departments and processes, and describe how data and AI are used.", id: "Tambah departemen dan proses, lalu jelaskan penggunaan data dan AI." },
    steps: [
      s("processes", ["Departments and processes", "An admin or the DPO adds departments. Members add processes inside their own department. Pick the department, type a name and describe the process, then press Create with AI or Create empty."],
        ["Departemen dan proses", "Admin atau PPDP menambah departemen. Anggota menambah proses di departemennya sendiri. Pilih departemen, ketik nama dan jelaskan prosesnya, lalu tekan Buat dengan AI atau Buat kosong."], { target: "new-process" }),
      s("processes", ["Open a finished example", "Click the highlighted process to see how a complete one looks."], ["Buka contoh yang lengkap", "Klik proses yang disorot untuk melihat contoh yang lengkap."], { target: "proc-first", wait: true }),
      s("process", ["Describe the process", "Plain-language answers: purpose, what personal data, whose, which AI system and vendor, where data is stored, legal basis, retention, and why it is necessary. Changes are saved when you leave a field."],
        ["Jelaskan prosesnya", "Jawaban dalam bahasa sederhana: tujuan, data pribadi apa, milik siapa, sistem AI dan vendor mana, lokasi data, dasar hukum, retensi, dan mengapa perlu. Perubahan tersimpan saat Anda meninggalkan kolom."], { target: "details" }),
      s("process", ["Sign-off is for the DPO", "The DPO advice field (and the sign-off field further down) can only be filled by the DPO or an admin. The department proposes, the DPO decides."],
        ["Pengesahan oleh PPDP", "Kolom saran PPDP (dan kolom pengesahan di bawahnya) hanya dapat diisi oleh PPDP atau admin. Departemen mengusulkan, PPDP memutuskan."], { target: "dpo-advice" }),
    ] },
  { id: "risks", minutes: 3, title: { en: "Risks and controls", id: "Risiko dan kontrol" },
    summary: { en: "Score a risk, add controls and see the residual risk.", id: "Beri nilai risiko, tambah kontrol dan lihat risiko residual." },
    steps: [
      s("dashboard", ["Start from the table", "Let the cursor open a process with risks."], ["Mulai dari tabel", "Biarkan kursor membuka proses yang memiliki risiko."], { target: "row-first", click: true }),
      s("process", ["Risks to people", "A risk is about harm to the people whose data is used, not to the company. Score likelihood and severity from 1 to 4. The number is likelihood times severity."],
        ["Risiko bagi orang", "Risiko adalah kerugian bagi orang yang datanya dipakai, bukan bagi perusahaan. Beri nilai kemungkinan dan dampak dari 1 sampai 4. Angkanya adalah kemungkinan dikali dampak."], { target: "risks" }),
      s("process", ["Before and after", "The first badge is the risk before controls, the second is the residual risk after your controls. Change the residual numbers when a control is in place."],
        ["Sebelum dan sesudah", "Lencana pertama adalah risiko sebelum kontrol, yang kedua risiko residual setelah kontrol. Ubah angka residual saat kontrol sudah berjalan."], { target: "risk-badges" }),
      s("process", ["Controls with an owner", "Each control has an owner, a due date and a status: planned, in progress or done. Open controls are counted on the dashboard."],
        ["Kontrol dengan penanggung jawab", "Setiap kontrol memiliki penanggung jawab, tenggat dan status: direncanakan, berjalan atau selesai. Kontrol yang terbuka dihitung di dasbor."], { target: "controls-first" }),
      s("dashboard", ["When risk stays high", "If a high residual risk remains after all controls, the process is flagged here for consultation with the authority (GDPR Article 36 and UU PDP)."],
        ["Bila risiko tetap tinggi", "Jika risiko residual tinggi masih ada setelah semua kontrol, proses ditandai di sini untuk konsultasi dengan Lembaga (GDPR Pasal 36 dan UU PDP)."], { target: "table" }),
    ] },
  { id: "dpia", minutes: 2, title: { en: "Export the DPIA", id: "Ekspor DPIA" },
    summary: { en: "What is in the Word document and who signs it.", id: "Isi dokumen Word dan siapa yang menandatangani." },
    steps: [
      s("dashboard", ["Pick a process", "The cursor opens one for you."], ["Pilih sebuah proses", "Kursor membukanya untuk Anda."], { target: "row-first", click: true }),
      s("process", ["Two languages, one structure", "The document follows GDPR Article 35(7): description, necessity and proportionality, risks, measures, advice and sign-off. The Indonesian version has the same content and the UU PDP legal basis."],
        ["Dua bahasa, satu struktur", "Dokumen mengikuti GDPR Pasal 35(7): deskripsi, kebutuhan dan proporsionalitas, risiko, langkah, saran dan pengesahan. Versi Indonesia memuat isi yang sama beserta dasar hukum UU PDP."], { target: "export" }),
      s("process", ["Fill it before you export", "Empty fields appear as (to be completed) in the document. Everything below comes from what you entered: description, risks, controls, advice and review date."],
        ["Isi sebelum mengekspor", "Kolom kosong muncul sebagai (belum diisi) di dokumen. Semua isinya berasal dari yang Anda masukkan: deskripsi, risiko, kontrol, saran dan tanggal peninjauan."], { target: "details" }),
    ] },
  { id: "roles", minutes: 1, title: { en: "Roles: who can do what", id: "Peran: siapa boleh apa" },
    summary: { en: "Admin, DPO, department member and auditor.", id: "Admin, PPDP, anggota departemen dan auditor." },
    steps: [
      s("dashboard", ["Your account", "Your name and role are shown here. Ask your admin to change them."], ["Akun Anda", "Nama dan peran Anda ditampilkan di sini. Minta admin untuk mengubahnya."], { target: "user" }),
      s("dashboard", ["Four roles", "Admin and DPO can do everything, including sign-off. A department member works only inside their department. An auditor can read everything but change nothing. Sign-in is by password or your company single sign-on."],
        ["Empat peran", "Admin dan PPDP dapat melakukan semuanya, termasuk pengesahan. Anggota departemen hanya bekerja di departemennya. Auditor dapat membaca semuanya tetapi tidak mengubah apa pun. Masuk memakai kata sandi atau single sign-on perusahaan."]),
    ] },
];
