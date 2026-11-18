import { useCallback, useEffect, useRef, useState } from "react";
import { api, canSignOff, canWriteDept, onError, onSignedOut, type Me } from "./api.js";
import { TXT, humanError, type Lang, type T } from "./i18n.js";
import { ControlsChart, DepartmentChart, PipelineChart, RiskChart, type Overview } from "./Charts.js";
import { ChatBubble } from "./Chat.js";
import { Login } from "./Login.js";
import { LibraryPage } from "./Library.js";
import { Settings } from "./Settings.js";
import { TourPlayer } from "./Tour.js";
import { TOURS, type Page, type Tour } from "./tours.js";
import { Badge, Btn, Card, inputCls } from "./ui.js";

type Criterion = { id: string; uu?: string; en: string; id_: string; gdpr: string };
type Dept = { id: number; name: string };
type Activity = Record<string, any> & { id: number; name: string; department: string; department_id: number; screening: string[] };
type DashRow = { id: number; name: string; department: string; dpiaRequired: boolean; basis: string; risks: number; openControls: number; consultation: boolean };
type Nav = "dashboard" | "processes" | "library" | "tutorials" | "settings";
type Comp = { items: { key: string; state: string }[]; confirmed: number; total: number; ready: boolean; gaps: { key: string; kind: string; state: string; question: string; risk_id?: number }[]; meta: Record<string, { source: string; confirmed: boolean }> };

export function App() {
  const [lang, setLang] = useState<Lang>(() => (navigator.language.startsWith("id") ? "id" : "en"));
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking, null = signed out
  const [error, setError] = useState("");
  const [page, setPage] = useState<Nav>("dashboard");
  const [open, setOpen] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null); // process just drafted by AI
  const [depts, setDepts] = useState<Dept[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [dash, setDash] = useState<DashRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [tour, setTour] = useState<Tour | null>(null);
  const t = TXT[lang];
  useEffect(() => setError(""), [page, open, me?.user.id]); // an error belongs to the screen where it happened

  const loadMe = useCallback(() => api<Me>("/api/auth/me").then(setMe).catch(() => setMe(null)), []);
  const load = useCallback(async () => {
    const [d, a, s, o] = await Promise.all([api<Dept[]>("/api/departments"), api<Activity[]>("/api/activities"), api<DashRow[]>("/api/dashboard"), api<Overview>("/api/overview")]);
    setDepts(d); setActs(a); setDash(s); setOverview(o);
  }, []);
  useEffect(() => { onError(setError); onSignedOut(() => setMe(null)); loadMe(); }, [loadMe]);
  useEffect(() => { // forget the previous person's data as soon as they sign out
    if (me === null) { setActs([]); setDash([]); setOverview(null); setDepts([]); setCriteria([]); setTour(null); setOpen(null); setPage("dashboard"); }
  }, [me]);
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
  const items: Nav[] = [...(me.demo ? ["dashboard", "processes", "library", "tutorials"] as const : ["dashboard", "processes", "library"] as const), ...(me.user.role === "admin" ? ["settings" as const] : [])];
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
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-2 md:hidden">{items.map((p) => <Btn key={p} variant="outline" onClick={() => nav(p)}>{t[p]}</Btn>)}</div>
          <div className="ml-auto flex items-center gap-3">
            <div data-tour="user" className="text-right text-sm leading-tight"><div className="font-medium">{me.user.name}</div><div className="text-xs text-muted-foreground">{t.roles[me.user.role]}</div></div>
            <div className="flex gap-1">{(["en", "id"] as const).map((l) => <Btn key={l} variant={lang === l ? "primary" : "outline"} onClick={() => setLang(l)}>{l.toUpperCase()}</Btn>)}</div>
            <Btn variant="outline" onClick={signOut}>{t.signOut}</Btn>
          </div>
        </header>
        {error && <div role="alert" className="fixed left-1/2 top-3 z-[90] flex w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg"><span>{humanError(error, t)}</span><button onClick={() => setError("")} aria-label="Close" className="text-lg leading-none">×</button></div>}
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
          {page === "dashboard" && <Dashboard rows={dash} overview={overview} t={t} me={me} tourAct={tourAct} go={(id) => { setPage("processes"); setOpen(id); }} startWelcome={() => play(TOURS[0])} />}
          {page === "processes" && open === null && <List acts={acts} dash={dash} depts={depts} me={me} t={t} lang={lang} tourAct={tourAct} reload={load} go={(id, drafted) => { setFresh(drafted ? id : null); setOpen(id); }} openSettings={() => nav("settings")} />}
          {page === "processes" && activity && <Detail key={open} act={activity} res={dash.find((d) => d.id === open)} me={me} criteria={criteria} lang={lang} t={t} reload={load} fresh={fresh === open} back={() => setOpen(null)} />}
          {page === "library" && <LibraryPage t={t} lang={lang} openProcess={(id) => { setPage("processes"); setOpen(id); }} />}
          {page === "settings" && me.user.role === "admin" && <Settings t={t} reloadMe={loadMe} />}
          {page === "tutorials" && <Tutorials me={me} lang={lang} t={t} play={play} />}
        </div>
      </main>
      {tour && <TourPlayer tour={tour} lang={lang} show={show} onClose={closeTour} />}
    </div>
  );
}

function Dashboard({ rows, overview, t, me, tourAct, go, startWelcome }: { rows: DashRow[]; overview: Overview | null; t: T; me: Me; tourAct: number | null; go: (id: number) => void; startWelcome: () => void }) {
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
    {overview && <div data-tour="charts" className="grid gap-4 lg:grid-cols-2">
      <PipelineChart o={overview} t={t} /><ControlsChart o={overview} t={t} />
      <RiskChart o={overview} t={t} className="lg:col-span-2" /><DepartmentChart o={overview} t={t} className="lg:col-span-2" />
    </div>}
    <Card data-tour="table" className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground">{[t.name, t.dept, t.dpia, t.risks, t.openCtl, t.status].map((h, i) => <th key={h} className={`px-3 py-3 font-medium sm:px-4 ${i === 1 || i === 3 ? "hidden sm:table-cell" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} data-tour={r.id === tourAct ? "row-first" : undefined} onClick={() => go(r.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted">
          <td className="px-3 py-3 font-medium sm:px-4">{r.name}</td><td className="hidden px-4 py-3 sm:table-cell">{r.department}</td>
          <td className="px-3 py-3 sm:px-4"><Badge tone={r.dpiaRequired ? "amber" : "gray"}>{r.dpiaRequired ? t.yes : t.no}</Badge></td>
          <td className="hidden px-4 py-3 sm:table-cell">{r.risks}</td><td className="px-3 py-3 sm:px-4">{r.openControls}</td>
          <td className="px-3 py-3 sm:px-4">{r.consultation ? <Badge tone="red">{t.consultFlag}</Badge> : <Badge tone="green">OK</Badge>}</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t.none}</td></tr>}</tbody>
      </table>
    </Card>
  </>;
}

function List({ acts, dash, depts, me, t, lang, tourAct, reload, go, openSettings }: { acts: Activity[]; dash: DashRow[]; depts: Dept[]; me: Me; t: T; lang: Lang; tourAct: number | null; reload: () => void; go: (id: number, drafted?: boolean) => void; openSettings: () => void }) {
  const [dept, setDept] = useState(""); const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [procDept, setProcDept] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const dpiaOf = (id: number) => dash.find((d) => d.id === id)?.dpiaRequired;
  const writable = depts.filter((d) => canWriteDept(me, d.id));
  const admin = canSignOff(me);
  const create = async (ai: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>(ai ? "/api/activities/ai" : "/api/activities", "POST", { name, department_id: procDept, ...(ai ? { description: desc, lang } : {}) });
      setName(""); setDesc(""); await reload(); go(r.id, ai);
    } catch { /* the error banner shows the reason; the form keeps what was typed */ } finally { setBusy(false); }
  };
  return <>
    {admin && <Card className="flex flex-wrap items-end gap-3"><input className={`${inputCls} max-w-52`} placeholder={t.dept} maxLength={200} value={dept} onChange={(e) => setDept(e.target.value)} />
      <Btn variant="outline" disabled={!dept.trim()} onClick={async () => { await api("/api/departments", "POST", { name: dept }); setDept(""); reload(); }}>{t.addDept}</Btn></Card>}
    {writable.length > 0 && <Card data-tour="new-process" className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <select className={`${inputCls} max-w-52`} value={procDept} onChange={(e) => setProcDept(Number(e.target.value))}>
          <option value={0}>{t.dept}…</option>{writable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <input className={`${inputCls} min-w-48 flex-1`} placeholder={t.name} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <label className="block text-sm"><span className="mb-1 block font-medium">{t.newDesc}</span>
        <textarea rows={4} maxLength={4000} className={`${inputCls} w-full`} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <span className="mt-1 block text-xs text-muted-foreground">{t.newDescHint}</span></label>
      <div className="flex flex-wrap items-center gap-3">
        <Btn disabled={busy || !me.ai || !name.trim() || !desc.trim() || !procDept} onClick={() => create(true)}>{busy ? t.creating : t.createAi}</Btn>
        <Btn variant="outline" disabled={busy || !name.trim() || !procDept} onClick={() => create(false)}>{t.createEmpty}</Btn>
        {me.ai && <span className="text-xs text-amber-700">{t.aiNotice}</span>}
        {!me.ai && <span className="text-sm text-muted-foreground">{t.aiMissing} {me.user.role === "admin" ? <button className="underline" onClick={openSettings}>{t.aiMissingAdmin}</button> : t.aiMissingOther}</span>}</div>
    </Card>}
    <div data-tour="process-list" className="space-y-2">{acts.map((a) => <Card key={a.id} data-tour={a.id === tourAct ? "proc-first" : undefined} onClick={() => go(a.id)} className="flex cursor-pointer items-center justify-between py-3 hover:bg-muted">
      <div><div className="font-medium">{a.name}</div><div className="text-sm text-muted-foreground">{a.department}</div></div>
      <Badge tone={dpiaOf(a.id) ? "amber" : "gray"}>{dpiaOf(a.id) ? t.yes : t.no}</Badge></Card>)}
      {!acts.length && <p className="text-muted-foreground">{t.none}</p>}</div>
  </>;
}

type RiskData = { id: number; source?: string; confirmed?: number; title: string; likelihood: number; severity: number; residual_likelihood: number | null; residual_severity: number | null; controls: { id: number; title: string; owner: string; due: string; status: string }[] };

function Detail({ act, res, me, criteria, lang, t, reload, back, fresh }: { act: Activity; res?: DashRow; me: Me; criteria: Criterion[]; lang: Lang; t: T; reload: () => void; back: () => void; fresh: boolean }) {
  const [risks, setRisks] = useState<RiskData[]>([]);
  const [form, setForm] = useState({ title: "", l: 2, s: 2 });
  const [comp, setComp] = useState<Comp | null>(null);
  const ro = !canWriteDept(me, act.department_id), signoff = canSignOff(me);
  const save = async (patch: Record<string, unknown>) => { try { await api(`/api/activities/${act.id}`, "PATCH", patch); } finally { reload(); } };
  const loadRisks = useCallback(async () => setRisks(await api<RiskData[]>(`/api/activities/${act.id}/risks`)), [act.id]);
  useEffect(() => { loadRisks().catch(() => {}); }, [loadRisks]);
  const loadComp = useCallback(async () => setComp(await api<Comp>(`/api/activities/${act.id}/completeness?lang=${lang}`)), [act.id, lang]);
  useEffect(() => { loadComp().catch(() => {}); }, [loadComp, act, risks]);
  const confirm = async (fields: string[]) => { await api(`/api/activities/${act.id}/confirm`, "POST", { fields }); loadComp(); };
  const prov = (k: string) => { const m = comp?.meta[k]; return m && !m.confirmed ? <><Badge tone="amber">{m.source === "ai_assumption" ? t.comp.assumption : t.comp.draft}</Badge>{!ro && <button type="button" className="text-xs underline" onClick={() => confirm([k])}>{t.comp.confirm}</button>}</> : null; };
  const gapLabel = (g: Comp["gaps"][number]) => g.kind === "field" ? (t.fields as Record<string, string>)[g.key] : g.kind === "screening" ? t.comp.screening : g.key === "risks" ? t.comp.risks
    : `${g.kind === "control" ? t.comp.controls : t.comp.risk}: ${risks.find((r) => r.id === g.risk_id)?.title ?? ""}`;
  const ticked = new Set(act.screening);
  const toggle = (id: string) => { ticked.has(id) ? ticked.delete(id) : ticked.add(id); save({ screening: [...ticked] }); };

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2"><Btn data-tour="back" variant="outline" onClick={back}>{t.back}</Btn>
      <div data-tour="export" className="flex gap-2">{(["en", "id"] as const).map((l) => <a key={l} href={`/api/activities/${act.id}/dpia.docx?lang=${l}`}><Btn variant={l === lang ? "primary" : "outline"}>{l === "en" ? t.exportEn : t.exportId}</Btn></a>)}</div></div>
    <h1 className="text-2xl font-semibold">{act.name} <span className="text-base font-normal text-muted-foreground">· {act.department}</span></h1>
    {ro && <p className="rounded-md bg-muted p-3 text-sm">{t.readOnly}</p>}
    {fresh && !ro && <p role="status" className="rounded-md bg-amber-500/15 p-3 text-sm text-amber-600">{t.drafted}</p>}
    {comp && <Card data-tour="completeness" className="space-y-2"><div className="flex items-center justify-between gap-3"><h2 className="font-medium">{t.comp.title}</h2>
        <span className="text-sm text-muted-foreground">{t.comp.progress.replace("{n}", String(comp.confirmed)).replace("{m}", String(comp.total))}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-green-600" style={{ width: `${(comp.confirmed / Math.max(1, comp.total)) * 100}%` }} /></div>
      {comp.ready ? <p className="text-sm text-green-600">{t.comp.ready}</p> : <ul className="space-y-1.5 pt-1 text-sm">{comp.gaps.slice(0, 4).map((g) => <li key={g.key} className="flex flex-wrap items-start gap-2">
        <Badge tone={g.state === "draft" ? "amber" : "gray"}>{g.state === "draft" ? t.comp.draft : t.comp.empty}</Badge><span><span className="font-medium">{gapLabel(g)}</span>{g.state === "empty" && <span className="text-muted-foreground"> · {g.question}</span>}</span></li>)}
        {comp.gaps.length > 4 && <li className="text-xs text-muted-foreground">+{comp.gaps.length - 4}</li>}</ul>}</Card>}
    <fieldset disabled={ro} className="space-y-6">
      <Card data-tour="screening"><h2 className="mb-3 flex flex-wrap items-center gap-2 font-medium">{t.screening}{prov("screening")}{!ro && !ticked.size && comp?.items.find((i) => i.key === "screening")?.state === "empty" && <Btn type="button" variant="outline" onClick={() => confirm(["screening"])}>{t.comp.confirmAll}</Btn>}</h2>
        {res && <p role="status" data-tour="screen-result" className={`mb-3 rounded-md p-3 text-sm ${res.dpiaRequired ? "bg-amber-500/15 text-amber-700" : "bg-muted"}`}><span className="font-semibold">{t.screenResult.title} {res.dpiaRequired ? t.screenResult.yes : t.screenResult.no}.</span> {res.basis === "uu-pdp" ? t.screenResult.uuPdp : res.basis === "gdpr-two-criteria" ? t.screenResult.gdpr : t.screenResult.none}</p>}
        {criteria.map((c) => <label key={c.id} className="flex items-start gap-3 py-1.5 text-sm">
          <input key={`${c.id}${ticked.has(c.id)}`} type="checkbox" className="mt-1" defaultChecked={ticked.has(c.id)} onChange={() => toggle(c.id)} />
          <span>{lang === "en" ? c.en : c.id_} <span className="text-xs text-muted-foreground">{c.uu ? `UU PDP 34(2)${c.uu} · ` : ""}{c.gdpr}</span></span></label>)}</Card>
      <Card data-tour="details" className="space-y-3"><h2 className="font-medium">{t.details}</h2>
        {Object.entries(t.fields).map(([k, label]) => <label key={k} data-tour={k === "dpo_advice" ? "dpo-advice" : undefined} className="block text-sm"><span className="mb-1 flex items-center gap-2 text-muted-foreground">{label}{prov(k)}</span>
          <textarea key={`${k}:${act[k] ?? ""}`} rows={k === "review_date" || k === "signed_by" ? 1 : 2} maxLength={5000} disabled={ro || ((k === "dpo_advice" || k === "signed_by") && !signoff)} className={`${inputCls} w-full disabled:opacity-60`}
            defaultValue={act[k] ?? ""} onBlur={(e) => e.target.value !== (act[k] ?? "") && save({ [k]: e.target.value }).catch(() => { e.target.value = act[k] ?? ""; })} /></label>)}
        <label className="flex items-center gap-2 text-sm"><input key={`cb${act.cross_border}`} type="checkbox" defaultChecked={!!act.cross_border} onChange={(e) => save({ cross_border: e.target.checked ? 1 : 0 })} />{t.crossBorder}</label></Card>
      <Card data-tour="risks" className="space-y-4"><h2 className="font-medium">{t.risksH}</h2>
        {risks.map((r, n) => <RiskBlock key={r.id} r={r} first={n === 0} t={t} reload={() => { loadRisks().catch(() => {}); reload(); }} />)}
        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <input className={`${inputCls} min-w-48 flex-1`} placeholder={t.riskTitle} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="text-xs">{t.likelihood}<input type="number" min={1} max={4} className={`${inputCls} block w-20`} value={form.l} onChange={(e) => setForm({ ...form, l: clamp(e.target.value) })} /></label>
          <label className="text-xs">{t.severity}<input type="number" min={1} max={4} className={`${inputCls} block w-20`} value={form.s} onChange={(e) => setForm({ ...form, s: clamp(e.target.value) })} /></label>
          <Btn disabled={!form.title.trim()} onClick={async () => { await api(`/api/activities/${act.id}/risks`, "POST", { title: form.title, likelihood: form.l, severity: form.s }); setForm({ ...form, title: "" }); loadRisks(); reload(); }}>{t.addRisk}</Btn></div></Card>
    </fieldset>
    {!ro && me.ai && <ChatBubble actId={act.id} lang={lang} t={t} criteria={criteria} changed={() => { loadRisks().catch(() => {}); reload(); }} />}
  </>;
}

const clamp = (v: string) => Math.min(4, Math.max(1, Math.round(Number(v)) || 1)); // the scale is 1-4: typing 9 or 0 snaps back
const level = (l: number, s: number): ["red" | "amber" | "green", number] => { const n = l * s; return [n >= 8 ? "red" : n >= 4 ? "amber" : "green", n]; };

function RiskBlock({ r, first, t, reload }: { r: RiskData; first: boolean; t: T; reload: () => void }) {
  const [c, setC] = useState({ title: "", owner: "", due: "" });
  const [tone, n] = level(r.likelihood, r.severity);
  const [rt, rn] = level(r.residual_likelihood ?? r.likelihood, r.residual_severity ?? r.severity);
  const setRes = async (k: "residual_likelihood" | "residual_severity", v: number) => { await api(`/api/risks/${r.id}`, "PATCH", { [k]: v }); reload(); };
  return <div data-tour={first ? "risk-first" : undefined} className="rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span>{r.confirmed === 0 && <><Badge tone="amber">{t.comp.draft}</Badge><button type="button" className="text-xs underline" onClick={async () => { await api(`/api/risks/${r.id}/confirm`, "POST"); reload(); }}>{t.comp.confirm}</button></>}<span data-tour={first ? "risk-badges" : undefined} className="inline-flex items-center gap-1"><Badge tone={tone}>{n}</Badge>→<Badge tone={rt}>{rn}</Badge></span>
      <label className="ml-auto text-xs">{t.resL}<input key={`rl${r.residual_likelihood}`} type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_likelihood ?? ""} onBlur={(e) => e.target.value && setRes("residual_likelihood", clamp(e.target.value))} /></label>
      <label className="text-xs">{t.resS}<input key={`rs${r.residual_severity}`} type="number" min={1} max={4} className={`${inputCls} ml-1 w-16`} defaultValue={r.residual_severity ?? ""} onBlur={(e) => e.target.value && setRes("residual_severity", clamp(e.target.value))} /></label></div>
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
