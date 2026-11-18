import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import type { Lang, T } from "./i18n.js";
import { UnitView } from "./Library.js";
import { Btn, inputCls } from "./ui.js";

type Cite = { uid: string; label: string; verified?: boolean };
type Block = { kind: "fact" | "talk"; text: string; cites: Cite[] };
type Proposal = { id: number; kind: "field" | "screening" | "risk" | "control" | "residual"; target: string; before: unknown; after: any; reason: string; cites: string[] };
type Reply = { interaction_id: number; outcome: string; blocks: Block[]; proposals: Proposal[]; questions: { key: string; text: string; why: string }[] };
type Turn = { role: "user" | "assistant"; text: string; reply?: Reply; rated?: number };
type Criterion = { id: string; en: string; id_: string };

// Floating assistant for one process. It looks things up and PROPOSES; the person decides.
export function ChatBubble({ actId, lang, t, criteria, changed }: { actId: number; lang: Lang; t: T; criteria: Criterion[]; changed: () => void }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Proposal[]>([]);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, pending, busy, open, unit]);
  useEffect(() => { if (open) api<Proposal[]>(`/api/activities/${actId}/proposals`).then(setPending).catch(() => {}); }, [open, actId]);

  const send = async () => {
    const message = msg.trim(); if (!message || busy) return;
    const history = turns.map((x) => ({ role: x.role, content: x.text }));
    setTurns([...turns, { role: "user", text: message }]); setMsg(""); setBusy(true);
    try {
      const r = await api<Reply>(`/api/activities/${actId}/chat`, "POST", { message, history, lang });
      const text = [...r.blocks.map((b) => b.text), ...r.questions.map((q) => q.text)].join("\n");
      setTurns((x) => [...x, { role: "assistant", text, reply: r }]);
      if (r.proposals.length) setPending((p) => [...p, ...r.proposals]);
    } catch { /* the error banner shows the reason */ } finally { setBusy(false); }
  };
  const decide = async (p: Proposal, action: "accept" | "reject", value?: string) => {
    try { await api(`/api/proposals/${p.id}/${action}`, "POST", value === undefined ? {} : { value }); if (action === "accept") changed(); }
    catch { /* stale or forbidden: banner explains */ } finally { setPending((x) => x.filter((y) => y.id !== p.id)); }
  };
  const rate = async (i: number, rating: 1 | -1) => { const id = turns[i].reply!.interaction_id; await api(`/api/interactions/${id}/rating`, "POST", { rating }).catch(() => {}); setTurns((x) => x.map((y, j) => (j === i ? { ...y, rated: rating } : y))); };

  return <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
    {open && <div role="dialog" aria-label={t.chatTitle} className="flex h-[36rem] max-h-[80vh] w-[26rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-lg border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3"><span className="font-medium">{t.chatTitle}</span>
        <button onClick={() => setOpen(false)} aria-label="Close" className="text-lg leading-none text-muted-foreground">×</button></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {!turns.length && !pending.length && <p className="text-muted-foreground">{t.chatHint}</p>}
        {turns.map((x, i) => x.role === "user" ? <div key={i} className="ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground">{x.text}</div> :
          <div key={i} className="mr-4 space-y-2 rounded-lg bg-muted px-3 py-2">
            {!x.reply!.blocks.length && !x.reply!.questions.length && <p>{x.reply!.proposals.length ? t.chatProposed.replace("{n}", String(x.reply!.proposals.length)) : "…"}</p>}
            {x.reply!.blocks.map((b, j) => <div key={j}><p className="whitespace-pre-wrap">{b.text}</p>
              {b.cites.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{b.cites.map((c) => c.uid.startsWith("P:") || c.uid === "R:screening"
                ? <span key={c.uid} className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{c.label}</span>
                : <button key={c.uid} onClick={() => setUnit(unit === c.uid ? null : c.uid)} title={c.verified ? t.chatVerified : ""} className="rounded border bg-background px-1.5 py-0.5 text-xs hover:bg-card">{c.verified ? "✓ " : ""}{c.label}</button>)}</div>}</div>)}
            {x.reply!.questions.length > 0 && <div className="border-t pt-2"><div className="text-xs font-medium text-muted-foreground">{t.chatNeed}</div>
              <ul className="list-inside list-disc">{x.reply!.questions.map((q) => <li key={q.key}>{q.text}{q.why && <span className="text-xs text-muted-foreground"> ({q.why})</span>}</li>)}</ul></div>}
            <div className="flex gap-2 text-xs text-muted-foreground">{([1, -1] as const).map((v) => <button key={v} disabled={!!x.rated} onClick={() => rate(i, v)} className={x.rated === v ? "font-semibold text-foreground" : "hover:text-foreground"}>{v === 1 ? "👍 " + t.chatHelpful : "👎 " + t.chatNot}</button>)}</div>
          </div>)}
        {unit && <div className="rounded-lg border bg-background p-3"><UnitView uid={unit} t={t} open={setUnit} /></div>}
        {pending.length > 0 && <div className="space-y-2"><div className="text-xs font-medium text-muted-foreground">{t.chatPending}</div>
          {pending.map((p) => <ProposalCard key={p.id} p={p} t={t} lang={lang} criteria={criteria} decide={decide} open={setUnit} />)}</div>}
        {busy && <p className="text-muted-foreground">{t.thinking}</p>}
        <div ref={end} />
      </div>
      <p className="border-t bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700">{t.aiNotice}</p>
      <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className={`${inputCls} min-w-0 flex-1`} placeholder={t.chatPlaceholder} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus />
        <Btn disabled={busy || !msg.trim()}>{t.send}</Btn>
      </form>
    </div>}
    <button data-tour="chat" onClick={() => setOpen(!open)} aria-label={t.chatTitle} aria-expanded={open}
      className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      {pending.length > 0 && !open && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{pending.length}</span>}
    </button>
  </div>;
}

function ProposalCard({ p, t, lang, criteria, decide, open }: { p: Proposal; t: T; lang: Lang; criteria: Criterion[]; decide: (p: Proposal, a: "accept" | "reject", v?: string) => void; open: (uid: string) => void }) {
  const [editing, setEditing] = useState(false); const [val, setVal] = useState(typeof p.after === "string" ? p.after : "");
  const crit = (ids: string[]) => ids.map((id) => { const c = criteria.find((x) => x.id === id); return c ? (lang === "en" ? c.en : c.id_) : id; }).join("; ") || "–";
  const name = p.kind === "field" ? ((t.fields as Record<string, string>)[p.target] ?? (p.target === "cross_border" ? t.crossBorder : p.target)) : p.target;
  const show = (v: unknown): string => p.kind === "screening" ? crit(v as string[]) : p.target === "cross_border" ? (v ? "✓" : "✗") : typeof v === "string" ? (v || "–") : "–";
  return <div className="space-y-2 rounded-lg border bg-background p-3">
    <div className="text-xs font-medium text-muted-foreground">{t.chatKindsP[p.kind]}{p.kind === "field" || p.kind === "residual" || p.kind === "control" ? `: ${name}` : ""}</div>
    {p.kind === "risk" ? <div><div className="font-medium">{p.after.title}</div><div className="text-xs text-muted-foreground">{t.likelihood.split(" ")[0]} {p.after.likelihood} × {t.severity.split(" ")[0]} {p.after.severity}{p.after.residual_likelihood ? ` → ${p.after.residual_likelihood} × ${p.after.residual_severity ?? "?"}` : ""}</div>
        {p.after.controls?.length > 0 && <ul className="mt-1 list-inside list-disc text-xs">{p.after.controls.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}</div>
      : p.kind === "control" ? <div>{p.after.title}</div>
      : p.kind === "residual" ? <div className="text-xs">{t.resL} {p.after.residual_likelihood ?? "–"} · {t.resS} {p.after.residual_severity ?? "–"}</div>
      : <div className="space-y-1"><div className="text-xs text-muted-foreground">{t.chatBefore}: {show(p.before)}</div>
        {editing ? <textarea rows={3} maxLength={5000} className={`${inputCls} w-full`} value={val} onChange={(e) => setVal(e.target.value)} /> : <div><span className="text-xs text-muted-foreground">{t.chatAfter}: </span>{show(p.after)}</div>}</div>}
    {p.reason && <p className="text-xs text-muted-foreground">{t.chatWhy}: {p.reason}</p>}
    {p.cites.length > 0 && <div className="flex flex-wrap gap-1">{p.cites.map((c) => <button key={c} onClick={() => open(c)} className="rounded border px-1.5 py-0.5 text-xs hover:bg-muted">{c.split("/").slice(-1)[0]} ↗</button>)}</div>}
    <div className="flex flex-wrap gap-2">
      {editing ? <><Btn disabled={!val.trim()} onClick={() => decide(p, "accept", val)}>{t.chatSave}</Btn><Btn variant="outline" onClick={() => setEditing(false)}>{t.chatCancel}</Btn></>
        : <><Btn onClick={() => decide(p, "accept")}>{t.chatAccept}</Btn>
          {p.kind === "field" && p.target !== "cross_border" && <Btn variant="outline" onClick={() => setEditing(true)}>{t.chatEdit}</Btn>}
          <Btn variant="outline" onClick={() => decide(p, "reject")}>{t.chatReject}</Btn></>}
    </div>
  </div>;
}
