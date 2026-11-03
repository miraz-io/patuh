import { useCallback, useEffect, useRef, useState } from "react";
import { api, canSignOff, canWriteDept, onError, onSignedOut, type Me } from "./api.js";
import { TXT, type Lang, type T } from "./i18n.js";
import { Login } from "./Login.js";
import { TourPlayer } from "./Tour.js";
import { TOURS, type Page, type Tour } from "./tours.js";
import { Badge, Btn, Card, inputCls } from "./ui.js";

type Criterion = { id: string; uu?: string; en: string; id_: string; gdpr: string };
type Dept = { id: number; name: string };
type Activity = Record<string, any> & { id: number; name: string; department: string; department_id: number; screening: string[] };
type DashRow = { id: number; name: string; department: string; dpiaRequired: boolean; basis: string; risks: number; openControls: number; consultation: boolean };
type Nav = "dashboard" | "processes" | "tutorials";

export function App() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language.startsWith("id") ? "id" : "en"));
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking, null = signed out
  const [error, setError] = useState("");
  const [page, setPage] = useState<Nav>("dashboard");
  const [open, setOpen] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [dash, setDash] = useState<DashRow[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [tour, setTour] = useState<Tour | null>(null);
  const t = TXT[lang];

  const loadMe = useCallback(() => api<Me>("/api/auth/me").then(setMe).catch(() => setMe(null)), []);
  const load = useCallback(async () => {
    const [d, a, s] = await Promise.all([api<Dept[]>("/api/departments"), api<Activity[]>("/api/activities"), api<DashRow[]>("/api/dashboard")]);
    setDepts(d); setActs(a); setDash(s);
  }, []);
  useEffect(() => { onError(setError); onSignedOut(() => setMe(null)); loadMe(); }, [loadMe]);
  useEffect(() => { if (me) { load().catch(() => {}); api<Criterion[]>("/api/criteria").then(setCriteria).catch(() => {}); } }, [me?.user.id, load]);

  // The tour opens the demo process, or the first one this person is allowed to see.
  const tourAct = acts.find((a) => a.id === me?.tourActivityId)?.id ?? acts[0]?.id ?? null;
  const tourActRef = useRef<number | null>(null); tourActRef.current = tourAct;
  const tourIdRef = useRef<string | null>(null);
  // Stable identities: the tour player restarts its step if these change.
  const show = useCallback((p: Page) => {
    setPage(p === "dashboard" ? "dashboard" : "processes");
    setOpen(p === "process" ? tourActRef.current : null);
  }, []);
  const closeTour = useCallback((completed: boolean) => {
    const id = tourIdRef.current; setTour(null);
    if (completed && id) api(`/api/tutorials/${id}/complete`, "POST").then(loadMe).catch(() => {});
  }, [loadMe]);
  const play = (x: Tour) => { tourIdRef.current = x.id; setPage("dashboard"); setOpen(null); setTour(x); };

  if (me === undefined) return null;
  if (me === null) return <Login lang={lang} setLang={setLang} done={loadMe} />;

  const nav = (p: Nav) => { setPage(p); setOpen(null); };
  const items: Nav[] = me.demo ? ["dashboard", "processes", "tutorials"] : ["dashboard", "processes"];
  const signOut = async () => { await api("/api/auth/logout", "POST").catch(() => {}); setMe(null); setOpen(null); setPage("dashboard"); };
  const activity = open !== null ? acts.find((a) => a.id === open) : undefined;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r p-4 md:flex">
        <div className="mb-6"><div className="text-lg font-semibold">Patuh</div><div className="truncate text-xs text-muted-foreground">{me.org}</div></div>
        {items.map((p) => <button key={p} data-tour={`nav-${p}`} onClick={() => nav(p)} className={`mb-1 block w-full rounded-md px-3 py-2 text-left text-sm ${page === p ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>{t[p]}</button>)}
        {me.demo && <div className="mt-auto"><Badge tone="amber">{t.demoBanner}</Badge></div>}
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-3">
          <div className="flex gap-2 md:hidden">{items.map((p) => <Btn key={p} variant="outline" onClick={() => nav(p)}>{t[p]}</Btn>)}</div>
          <div className="ml-auto flex items-center gap-3">
            <div data-tour="user" className="text-right text-sm leading-tight"><div className="font-medium">{me.user.name}</div><div className="text-xs text-muted-foreground">{t.roles[me.user.role]}</div></div>
            <div className="flex gap-1">{(["en", "id"] as const).map((l) => <Btn key={l} variant={lang === l ? "primary" : "outline"} onClick={() => setLang(l)}>{l.toUpperCase()}</Btn>)}</div>
            <Btn variant="outline" onClick={signOut}>{t.signOut}</Btn>
          </div>
        </header>
        {error && <div role="alert" className="flex items-center justify-between bg-red-500/15 px-6 py-2 text-sm text-red-600">{error}<button onClick={() => setError("")} aria-label="Close">×</button></div>}
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {page === "dashboard" && <Dashboard rows={dash} t={t} me={me} tourAct={tourAct} go={(id) => { setPage("processes"); setOpen(id); }} startWelcome={() => play(TOURS[0])} />}
          {page === "processes" && open === null && <List acts={acts} dash={dash} depts={depts} me={me} t={t} tourAct={tourAct} reload={load} go={setOpen} />}
          {page === "processes" && activity && <Detail key={open} act={activity} me={me} criteria={criteria} lang={lang} t={t} reload={load} back={() => setOpen(null)} />}
          {page === "tutorials" && <Tutorials me={me} lang={lang} t={t} play={play} />}
        </div>
      </main>
      {tour && <TourPlayer tour={tour} lang={lang} show={show} onClose={closeTour} />}
    </div>
  );
}

function Dashboard({ rows, t, me, tourAct, go, startWelcome }: { rows: DashRow[]; t: T; me: Me; tourAct: number | null; go: (id: number) => void; startWelcome: () => void }) {
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem("tourDismissed") === "1"; } catch { return false; } });
  const stats = [[t.total, rows.length], [t.needDpia, rows.filter((r) => r.dpiaRequired).length],
    [t.openCtl, rows.reduce((n, r) => n + r.openControls, 0)], [t.consult, rows.filter((r) => r.consultation).length]];
  const offer = me.demo && !me.completedTours.includes("welcome") && !dismissed;
  return <>
    {offer && <Card className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm">{t.tourPrompt}</span>
      <span className="flex gap-2"><Btn variant="outline" onClick={() => { try { sessionStorage.setItem("tourDismissed", "1"); } catch { /* private mode */ } setDismissed(true); }}>{t.tourLater}</Btn>
        <Btn onClick={startWelcome}>{t.tourStart}</Btn></span></Card>}
    <div data-tour="stats" className="grid grid-cols-2 gap-4 lg:grid-cols-4">{stats.map(([l, v]) =>
      <Card key={l as string}><div className="text-sm text-muted-foreground">{l}</div><div className="mt-2 text-3xl font-semibold">{v}</div></Card>)}</div>
    <Card data-tour="table" className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground">{[t.name, t.dept, t.dpia, t.risks, t.openCtl, t.status].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} data-tour={r.id === tourAct ? "row-first" : undefined} onClick={() => go(r.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
          <td className="px-4 py-3 font-medium">{r.name}</td><td className="px-4 py-3">{r.department}</td>
          <td className="px-4 py-3"><Badge tone={r.dpiaRequired ? "amber" : "gray"}>{r.dpiaRequired ? t.yes : t.no}</Badge></td>
          <td className="px-4 py-3">{r.risks}</td><td className="px-4 py-3">{r.openControls}</td>
          <td className="px-4 py-3">{r.consultation ? <Badge tone="red">{t.consultFlag}</Badge> : <Badge tone="green">OK</Badge>}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t.none}</td></tr>}</tbody>
      </table>
    </Card>
  </>;
}

function List({ acts, dash, depts, me, t, tourAct, reload, go }: { acts: Activity[]; dash: DashRow[]; depts: Dept[]; me: Me; t: T; tourAct: number | null; reload: () => void; go: (id: number) => void }) {
  const [dept, setDept] = useState(""); const [name, setName] = useState(""); const [procDept, setProcDept] = useState<number>(0);
  const dpiaOf = (id: number) => dash.find((d) => d.id === id)?.dpiaRequired;
  const writable = depts.filter((d) => canWriteDept(me, d.id));
  const admin = canSignOff(me);
  return <>
    {(admin || writable.length > 0) && <Card data-tour="new-process" className="flex flex-wrap items-end gap-3">
      {admin && <><input className={`${inputCls} max-w-52`} placeholder={t.dept} maxLength={200} value={dept} onChange={(e) => setDept(e.target.value)} />
        <Btn variant="outline" disabled={!dept.trim()} onClick={async () => { await api("/api/departments", "POST", { name: dept }); setDept(""); reload(); }}>{t.addDept}</Btn></>}
      <select className={`${inputCls} max-w-52`} value={procDept} onChange={(e) => setProcDept(Number(e.target.value))}>
        <option value={0}>{t.dept}…</option>{writable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <input className={`${inputCls} max-w-64`} placeholder={t.name} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      <Btn disabled={!name.trim() || !procDept} onClick={async () => { const r = await api<{ id: number }>("/api/activities", "POST", { name, department_id: procDept }); setName(""); await reload(); go(r.id); }}>{t.newProc}</Btn>
    </Card>}
    <div data-tour="process-list" className="space-y-2">{acts.map((a) => <Card key={a.id} data-tour={a.id === tourAct ? "proc-first" : undefined} onClick={() => go(a.id)} className="flex cursor-pointer items-center justify-between py-3 hover:bg-muted">
      <div><div className="font-medium">{a.name}</div><div className="text-sm text-muted-foreground">{a.department}</div></div>
      <Badge tone={dpiaOf(a.id) ? "amber" : "gray"}>{dpiaOf(a.id) ? t.yes : t.no}</Badge></Card>)}
      {!acts.length && <p className="text-muted-foreground">{t.none}</p>}</div>
  </>;
}

type RiskData = { id: number; title: string; likelihood: number; severity: number; residual_likelihood: number | null; residual_severity: number | null; controls: { id: number; title: string; owner: string; due: string; status: string }[] };

function Detail({ act, me, criteria, lang, t, reload, back }: { act: Activity; me: Me; criteria: Criterion[]; lang: Lang; t: T; reload: () => void; back: () => void }) {
  const [risks, setRisks] = useState<RiskData[]>([]);
  const [form, setForm] = useState({ title: "", l: 2, s: 2 });
  const ro = !canWriteDept(me, act.department_id), signoff = canSignOff(me);
  const save = async (patch: Record<string, unknown>) => { try { await api(`/api/activities/${act.id}`, "PATCH", patch); } finally { reload(); } };
  const loadRisks = useCallback(async () => setRisks(await api<RiskData[]>(`/api/activities/${act.id}/risks`)), [act.id]);
  useEffect(() => { loadRisks().catch(() => {}); }, [loadRisks]);
  const ticked = new Set(act.screening);
  const toggle = (id: string) => { ticked.has(id) ? ticked.delete(id) : ticked.add(id); save({ screening: [...ticked] }); };

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2"><Btn data-tour="back" variant="outline" onClick={back}>{t.back}</Btn>
      <div data-tour="export" className="flex gap-2">{(["en", "id"] as const).map((l) => <a key={l} href={`/api/activities/${act.id}/dpia.docx?lang=${l}`}><Btn variant={l === lang ? "primary" : "outline"}>{l === "en" ? t.exportEn : t.exportId}</Btn></a>)}</div></div>
    <h1 className="text-2xl font-semibold">{act.name} <span className="text-base font-normal text-muted-foreground">· {act.department}</span></h1>
    {ro && <p className="rounded-md bg-muted p-3 text-sm">{t.readOnly}</p>}
    <fieldset disabled={ro} className="space-y-6">
      <Card data-tour="screening"><h2 className="mb-3 font-medium">{t.screening}</h2>
        {criteria.map((c) => <label key={c.id} className="flex items-start gap-3 py-1.5 text-sm">
          <input type="checkbox" className="mt-1" defaultChecked={ticked.has(c.id)} onChange={() => toggle(c.id)} />
          <span>{lang === "en" ? c.en : c.id_} <span className="text-xs text-muted-foreground">{c.uu ? `UU PDP 34(2)${c.uu} · ` : ""}{c.gdpr}</span></span></label>)}</Card>
      <Card data-tour="details" className="space-y-3"><h2 className="font-medium">{t.details}</h2>
        {Object.entries(t.fields).map(([k, label]) => <label key={k} className="block text-sm"><span className="mb-1 block text-muted-foreground">{label}</span>
          <textarea rows={k === "review_date" || k === "signed_by" ? 1 : 2} maxLength={5000} disabled={ro || ((k === "dpo_advice" || k === "signed_by") && !signoff)} className={`${inputCls} w-full disabled:opacity-60`}
            defaultValue={act[k] ?? ""} onBlur={(e) => e.target.value !== (act[k] ?? "") && save({ [k]: e.target.value }).catch(() => { e.target.value = act[k] ?? ""; })} /></label>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={!!act.cross_border} onChange={(e) => save({ cross_border: e.target.checked ? 1 : 0 })} />{t.crossBorder}</label></Card>
      <Card data-tour="risks" className="space-y-4"><h2 className="font-medium">{t.risksH}</h2>
        {risks.map((r, n) => <RiskBlock key={r.id} r={r} first={n === 0} t={t} reload={() => { loadRisks().catch(() => {}); reload(); }} />)}
        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <input className={`${inputCls} min-w-48 flex-1`} placeholder={t.riskTitle} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="text-xs">{t.likelihood}<input type="number" min={1} max={4} className={`${inputCls} block w-20`} value={form.l} onChange={(e) => setForm({ ...form, l: Number(e.target.value) })} /></label>
          <label className="text-xs">{t.severity}<input type="number" min={1} max={4} className={`${inputCls} block w-20`} value={form.s} onChange={(e) => setForm({ ...form, s: Number(e.target.value) })} /></label>
          <Btn disabled={!form.title.trim()} onClick={async () => { await api(`/api/activities/${act.id}/risks`, "POST", { title: form.title, likelihood: form.l, severity: form.s }); setForm({ ...form, title: "" }); loadRisks(); reload(); }}>{t.addRisk}</Btn></div></Card>
    </fieldset>
  </>;
}

const level = (l: number, s: number): ["red" | "amber" | "green", number] => { const n = l * s; return [n >= 8 ? "red" : n >= 4 ? "amber" : "green", n]; };

function RiskBlock({ r, first, t, reload }: { r: RiskData; first: boolean; t: T; reload: () => void }) {
  const [c, setC] = useState({ title: "", owner: "", due: "" });
  const [tone, n] = level(r.likelihood, r.severity);
  const [rt, rn] = level(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity);
  const setRes = async (k: "residual_likelihood" | "residual_severity", v: number) => { await api(`/api/risks/${r.id}`, "PATCH", { [k]: v }); reload(); };
  return <div data-tour={first ? "risk-first" : undefined} className="rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><Badge tone={tone}>{n}</Badge>→<Badge tone={rt}>{rn}</Badge>
      <label className="ml-auto text-xs">{t.resL}<input type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_likelihood ?? ""} onBlur={(e) => e.target.value && setRes("residual_likelihood", Number(e.target.value))} /></label>
      <label className="text-xs">{t.resS}<input type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_severity ?? ""} onBlur={(e) => e.target.value && setRes("residual_severity", Number(e.target.value))} /></label></div>
    <ul data-tour={first ? "controls-first" : undefined} className="my-2 space-y-1 text-sm">{r.controls.map((k) => <li key={k.id} className="flex flex-wrap items-center gap-2">
      <select className="rounded-md border bg-background px-1 text-xs" value={k.status} onChange={async (e) => { await api(`/api/controls/${k.id}`, "PATCH", { status: e.target.value }); reload(); }}>
        {["planned", "in-progress", "done"].map((s) => <option key={s}>{s}</option>)}</select>{k.title}
      <span className="text-muted-foreground">{[k.owner, k.due].filter(Boolean).join(" · ")}</span></li>)}</ul>
    <div className="flex flex-wrap gap-2">
      <input className={`${inputCls} min-w-48 flex-1`} placeholder={t.ctlTitle} maxLength={200} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
      <input className={`${inputCls} w-32`} placeholder={t.owner} maxLength={200} value={c.owner} onChange={(e) => setC({ ...c, owner: e.target.value })} />
      <input type="date" className={`${inputCls} w-40`} value={c.due} onChange={(e) => setC({ ...c, due: e.target.value })} />
      <Btn variant="outline" disabled={!c.title.trim()} onClick={async () => { await api(`/api/risks/${r.id}/controls`, "POST", c); setC({ title: "", owner: "", due: "" }); reload(); }}>{t.addCtl}</Btn></div>
  </div>;
}

function Tutorials({ me, lang, t, play }: { me: Me; lang: Lang; t: T; play: (x: Tour) => void }) {
  return <>
    <div><h1 className="text-2xl font-semibold">{t.tutorials}</h1><p className="mt-1 text-sm text-muted-foreground">{t.tutorialsIntro}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{TOURS.map((x) => {
      const done = me.completedTours.includes(x.id);
      return <Card key={x.id} className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2"><div className="font-medium">{x.title[lang]}</div>{done && <Badge tone="green">{t.completed}</Badge>}</div>
        <p className="text-sm text-muted-foreground">{x.summary[lang]}</p>
        <div className="mt-auto flex items-center justify-between"><span className="text-xs text-muted-foreground">{x.steps.length} {t.steps} · ~{x.minutes} {t.min}</span>
          <Btn variant={done ? "outline" : "primary"} onClick={() => play(x)}>{done ? t.replay : t.play}</Btn></div></Card>;
    })}</div>
  </>;
}
