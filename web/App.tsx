import { useCallback, useEffect, useState, type ReactNode } from "react";

type Lang = "en" | "id";
type Criterion = { id: string; uu?: string; en: string; id_: string; gdpr: string };
type Dept = { id: number; name: string };
type Activity = Record<string, any> & { id: number; name: string; department: string; screening: string[] };
type DashRow = { id: number; name: string; department: string; dpiaRequired: boolean; basis: string; risks: number; openControls: number; consultation: boolean };

const TXT = {
  en: { dashboard: "Dashboard", processes: "Processes", total: "Processes", needDpia: "DPIA required", openCtl: "Open controls",
    consult: "Need authority consultation", name: "Process", dept: "Department", dpia: "DPIA", risks: "Risks", status: "Status",
    yes: "Required", no: "Not required", newProc: "New process", addDept: "Add department", save: "Create", back: "Back",
    screening: "1. Does a DPIA apply? (tick what is true)", details: "2. Describe the process", risksH: "3. Risks and controls",
    addRisk: "Add risk", likelihood: "Likelihood (1-4)", severity: "Severity (1-4)", resL: "Residual likelihood", resS: "Residual severity",
    addCtl: "Add control", owner: "Owner", due: "Due", exportEn: "Download DPIA (English)", exportId: "Download DPIA (Indonesian)",
    consultFlag: "Authority consultation needed", none: "Nothing yet. Add a department, then a process.",
    fields: { purpose: "Purpose", description: "Description", data_categories: "Personal data processed", data_subjects: "People concerned",
      ai_system: "AI system / model", vendor: "Vendor / processor", data_location: "Where data is stored", legal_basis: "Legal basis",
      retention: "Retention", necessity: "Why is this necessary and proportionate?", dpo_advice: "DPO advice",
      subjects_views: "Views of the people concerned", review_date: "Next review date", signed_by: "Signed off by" },
    crossBorder: "Data leaves Indonesia", riskTitle: "Risk to people (e.g. biased decisions)", ctlTitle: "Control (e.g. human review)" },
  id: { dashboard: "Dasbor", processes: "Proses", total: "Proses", needDpia: "Perlu DPIA", openCtl: "Kontrol terbuka",
    consult: "Perlu konsultasi Lembaga", name: "Proses", dept: "Departemen", dpia: "DPIA", risks: "Risiko", status: "Status",
    yes: "Wajib", no: "Tidak wajib", newProc: "Proses baru", addDept: "Tambah departemen", save: "Buat", back: "Kembali",
    screening: "1. Apakah DPIA berlaku? (centang yang benar)", details: "2. Jelaskan prosesnya", risksH: "3. Risiko dan kontrol",
    addRisk: "Tambah risiko", likelihood: "Kemungkinan (1-4)", severity: "Dampak (1-4)", resL: "Kemungkinan residual", resS: "Dampak residual",
    addCtl: "Tambah kontrol", owner: "Penanggung jawab", due: "Tenggat", exportEn: "Unduh DPIA (Inggris)", exportId: "Unduh DPIA (Indonesia)",
    consultFlag: "Perlu konsultasi Lembaga", none: "Belum ada. Tambah departemen, lalu proses.",
    fields: { purpose: "Tujuan", description: "Deskripsi", data_categories: "Data pribadi yang diproses", data_subjects: "Subjek data",
      ai_system: "Sistem AI / model", vendor: "Vendor / prosesor", data_location: "Lokasi penyimpanan data", legal_basis: "Dasar pemrosesan",
      retention: "Retensi", necessity: "Mengapa ini perlu dan proporsional?", dpo_advice: "Saran PPDP",
      subjects_views: "Pandangan subjek data", review_date: "Tanggal peninjauan berikutnya", signed_by: "Disahkan oleh" },
    crossBorder: "Data keluar dari Indonesia", riskTitle: "Risiko bagi subjek data (mis. keputusan bias)", ctlTitle: "Kontrol (mis. tinjauan manusia)" },
};

const api = async <T,>(url: string, method = "GET", body?: unknown): Promise<T> => {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
};

const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) =>
  <div className={`rounded-lg border bg-card p-5 shadow-sm ${className}`}>{children}</div>;
const Btn = ({ variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" }) =>
  <button {...p} className={`inline-flex h-9 items-center rounded-md px-4 text-sm font-medium disabled:opacity-50 ${variant === "primary" ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-muted"}`} />;
const Badge = ({ tone, children }: { tone: "red" | "green" | "gray" | "amber"; children: ReactNode }) =>
  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${{ red: "bg-red-500/15 text-red-600", green: "bg-green-500/15 text-green-600", gray: "bg-muted text-muted-foreground", amber: "bg-amber-500/15 text-amber-600" }[tone]}`}>{children}</span>;
const inputCls = "rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ring-ring";

export function App() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language.startsWith("id") ? "id" : "en"));
  const [page, setPage] = useState<"dashboard" | "processes">("dashboard");
  const [open, setOpen] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [dash, setDash] = useState<DashRow[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const t = TXT[lang];

  const load = useCallback(async () => {
    const [d, a, s] = await Promise.all([api<Dept[]>("/api/departments"), api<Activity[]>("/api/activities"), api<DashRow[]>("/api/dashboard")]);
    setDepts(d); setActs(a); setDash(s);
  }, []);
  useEffect(() => { load(); api<Criterion[]>("/api/criteria").then(setCriteria); }, [load]);

  const nav = (p: "dashboard" | "processes") => { setPage(p); setOpen(null); };
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
        <div className="mb-6 text-lg font-semibold">Patuh</div>
        {(["dashboard", "processes"] as const).map((p) =>
          <button key={p} onClick={() => nav(p)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-sm ${page === p ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>{t[p]}</button>)}
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex gap-2 md:hidden">{(["dashboard", "processes"] as const).map((p) => <Btn key={p} variant="outline" onClick={() => nav(p)}>{t[p]}</Btn>)}</div>
          <div className="ml-auto flex gap-1">{(["en", "id"] as const).map((l) =>
            <Btn key={l} variant={lang === l ? "primary" : "outline"} onClick={() => setLang(l)}>{l.toUpperCase()}</Btn>)}</div>
        </header>
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {page === "dashboard" && <Dashboard rows={dash} t={t} go={(id) => { setPage("processes"); setOpen(id); }} />}
          {page === "processes" && open === null && <List acts={acts} dash={dash} depts={depts} t={t} reload={load} go={setOpen} />}
          {page === "processes" && open !== null && acts.find((a) => a.id === open) &&
            <Detail key={open} act={acts.find((a) => a.id === open)!} criteria={criteria} lang={lang} t={t} reload={load} back={() => setOpen(null)} />}
        </div>
      </main>
    </div>
  );
}

function Dashboard({ rows, t, go }: { rows: DashRow[]; t: typeof TXT.en; go: (id: number) => void }) {
  const stats = [[t.total, rows.length], [t.needDpia, rows.filter((r) => r.dpiaRequired).length],
    [t.openCtl, rows.reduce((n, r) => n + r.openControls, 0)], [t.consult, rows.filter((r) => r.consultation).length]];
  return <>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{stats.map(([l, v]) =>
      <Card key={l as string}><div className="text-sm text-muted-foreground">{l}</div><div className="mt-2 text-3xl font-semibold">{v}</div></Card>)}</div>
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground">{[t.name, t.dept, t.dpia, t.risks, t.openCtl, t.status].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} onClick={() => go(r.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
          <td className="px-4 py-3 font-medium">{r.name}</td><td className="px-4 py-3">{r.department}</td>
          <td className="px-4 py-3"><Badge tone={r.dpiaRequired ? "amber" : "gray"}>{r.dpiaRequired ? t.yes : t.no}</Badge></td>
          <td className="px-4 py-3">{r.risks}</td><td className="px-4 py-3">{r.openControls}</td>
          <td className="px-4 py-3">{r.consultation ? <Badge tone="red">{t.consultFlag}</Badge> : <Badge tone="green">OK</Badge>}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t.none}</td></tr>}</tbody>
      </table>
    </Card>
  </>;
}

function List({ acts, dash, depts, t, reload, go }: { acts: Activity[]; dash: DashRow[]; depts: Dept[]; t: typeof TXT.en; reload: () => void; go: (id: number) => void }) {
  const [dept, setDept] = useState(""); const [name, setName] = useState(""); const [procDept, setProcDept] = useState<number>(0);
  const dpiaOf = (id: number) => dash.find((d) => d.id === id)?.dpiaRequired;
  return <>
    <Card className="flex flex-wrap items-end gap-3">
      <input className={`${inputCls} max-w-52`} placeholder={t.dept} value={dept} onChange={(e) => setDept(e.target.value)} />
      <Btn variant="outline" disabled={!dept.trim()} onClick={async () => { await api("/api/departments", "POST", { name: dept }); setDept(""); reload(); }}>{t.addDept}</Btn>
      <select className={`${inputCls} max-w-52`} value={procDept} onChange={(e) => setProcDept(Number(e.target.value))}>
        <option value={0}>{t.dept}…</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <input className={`${inputCls} max-w-64`} placeholder={t.name} value={name} onChange={(e) => setName(e.target.value)} />
      <Btn disabled={!name.trim() || !procDept} onClick={async () => { const r = await api<{ id: number }>("/api/activities", "POST", { name, department_id: procDept }); setName(""); await reload(); go(r.id); }}>{t.newProc}</Btn>
    </Card>
    <div className="space-y-2">{acts.map((a) => <Card key={a.id} className="flex cursor-pointer items-center justify-between py-3 hover:bg-muted" >
      <div onClick={() => go(a.id)} className="flex-1"><div className="font-medium">{a.name}</div><div className="text-sm text-muted-foreground">{a.department}</div></div>
      <Badge tone={dpiaOf(a.id) ? "amber" : "gray"}>{dpiaOf(a.id) ? t.yes : t.no}</Badge></Card>)}
      {!acts.length && <p className="text-muted-foreground">{t.none}</p>}</div>
  </>;
}

function Detail({ act, criteria, lang, t, reload, back }: { act: Activity; criteria: Criterion[]; lang: Lang; t: typeof TXT.en; reload: () => void; back: () => void }) {
  const [risks, setRisks] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", l: 2, s: 2 });
  const save = async (patch: Record<string, unknown>) => { await api(`/api/activities/${act.id}`, "PATCH", patch); reload(); };
  // The server returns risks only inside the DPIA, so keep a local list for editing.
  const loadRisks = useCallback(async () => setRisks(await api<any[]>(`/api/activities/${act.id}/risks`)), [act.id]);
  useEffect(() => { loadRisks(); }, [loadRisks]);
  const ticked = new Set(act.screening);
  const toggle = (id: string) => { ticked.has(id) ? ticked.delete(id) : ticked.add(id); save({ screening: [...ticked] }); };

  return <>
    <div className="flex items-center justify-between"><div><Btn variant="outline" onClick={back}>{t.back}</Btn></div>
      <div className="flex gap-2">{(["en", "id"] as const).map((l) => <a key={l} href={`/api/activities/${act.id}/dpia.docx?lang=${l}`}><Btn variant={l === lang ? "primary" : "outline"}>{l === "en" ? t.exportEn : t.exportId}</Btn></a>)}</div></div>
    <h1 className="text-2xl font-semibold">{act.name} <span className="text-base font-normal text-muted-foreground">· {act.department}</span></h1>
    <Card><h2 className="mb-3 font-medium">{t.screening}</h2>
      {criteria.map((c) => <label key={c.id} className="flex items-start gap-3 py-1.5 text-sm">
        <input type="checkbox" className="mt-1" defaultChecked={ticked.has(c.id)} onChange={() => toggle(c.id)} />
        <span>{lang === "en" ? c.en : c.id_} <span className="text-xs text-muted-foreground">{c.uu ? `UU PDP 34(2)${c.uu} · ` : ""}{c.gdpr}</span></span></label>)}</Card>
    <Card className="space-y-3"><h2 className="font-medium">{t.details}</h2>
      {Object.entries(t.fields).map(([k, label]) => <label key={k} className="block text-sm"><span className="mb-1 block text-muted-foreground">{label}</span>
        <textarea rows={k === "review_date" || k === "signed_by" ? 1 : 2} className={`${inputCls} w-full`} defaultValue={act[k] ?? ""} onBlur={(e) => e.target.value !== (act[k] ?? "") && save({ [k]: e.target.value })} /></label>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={!!act.cross_border} onChange={(e) => save({ cross_border: e.target.checked ? 1 : 0 })} />{t.crossBorder}</label></Card>
    <Card className="space-y-4"><h2 className="font-medium">{t.risksH}</h2>
      {risks.map((r) => <RiskBlock key={r.id} r={r} t={t} reload={loadRisks} />)}
      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <input className={`${inputCls} flex-1`} placeholder={t.riskTitle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <label className="text-xs">{t.likelihood}<input type="number" min={1} max={4} className={`${inputCls} w-20`} value={form.l} onChange={(e) => setForm({ ...form, l: Number(e.target.value) })} /></label>
        <label className="text-xs">{t.severity}<input type="number" min={1} max={4} className={`${inputCls} w-20`} value={form.s} onChange={(e) => setForm({ ...form, s: Number(e.target.value) })} /></label>
        <Btn disabled={!form.title.trim()} onClick={async () => { await api(`/api/activities/${act.id}/risks`, "POST", { title: form.title, likelihood: form.l, severity: form.s }); setForm({ ...form, title: "" }); loadRisks(); reload(); }}>{t.addRisk}</Btn></div></Card>
  </>;
}

const LEVEL = (l: number, s: number) => { const n = l * s; return n >= 12 ? ["red", n] : n >= 8 ? ["red", n] : n >= 4 ? ["amber", n] : ["green", n]; };

function RiskBlock({ r, t, reload }: { r: any; t: typeof TXT.en; reload: () => void }) {
  const [c, setC] = useState({ title: "", owner: "", due: "" });
  const [tone, n] = LEVEL(r.likelihood, r.severity);
  const [rt, rn] = LEVEL(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity);
  const setRes = async (k: "residual_likelihood" | "residual_severity", v: number) => { await api(`/api/risks/${r.id}`, "PATCH", { [k]: v }); reload(); };
  return <div className="rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><Badge tone={tone as any}>{n}</Badge>→<Badge tone={rt as any}>{rn}</Badge>
      <label className="ml-auto text-xs">{t.resL}<input type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_likelihood ?? ""} onBlur={(e) => e.target.value && setRes("residual_likelihood", Number(e.target.value))} /></label>
      <label className="text-xs">{t.resS}<input type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_severity ?? ""} onBlur={(e) => e.target.value && setRes("residual_severity", Number(e.target.value))} /></label></div>
    <ul className="my-2 space-y-1 text-sm">{r.controls.map((k: any) => <li key={k.id} className="flex items-center gap-2">
      <select className="rounded-md border bg-background px-1 text-xs" value={k.status} onChange={async (e) => { await api(`/api/controls/${k.id}`, "PATCH", { status: e.target.value }); reload(); }}>
        {["planned", "in-progress", "done"].map((s) => <option key={s}>{s}</option>)}</select>{k.title}
      <span className="text-muted-foreground">{[k.owner, k.due].filter(Boolean).join(" · ")}</span></li>)}</ul>
    <div className="flex flex-wrap gap-2">
      <input className={`${inputCls} flex-1`} placeholder={t.ctlTitle} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
      <input className={`${inputCls} w-32`} placeholder={t.owner} value={c.owner} onChange={(e) => setC({ ...c, owner: e.target.value })} />
      <input type="date" className={`${inputCls} w-40`} value={c.due} onChange={(e) => setC({ ...c, due: e.target.value })} />
      <Btn variant="outline" disabled={!c.title.trim()} onClick={async () => { await api(`/api/risks/${r.id}/controls`, "POST", c); setC({ title: "", owner: "", due: "" }); reload(); }}>{t.addCtl}</Btn></div>
  </div>;
}
