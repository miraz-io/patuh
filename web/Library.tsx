import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { T } from "./i18n.js";
import { Badge, Btn, Card, inputCls } from "./ui.js";

export type Unit = { uid: string; source: string; sourceTitle: string; url: string; verified: string; verified_on: string; text_kind: string; ref: string; text: string;
  breadcrumb: { uid: string; ref: string }[]; children: { uid: string; ref: string }[]; related: { uid: string; ref: string; source: string; relation: string; note: string }[] };
const SRC: Record<string, string> = { "uupdp-2022": "UU PDP 27/2022", "gdpr-2016-679": "GDPR", "eu-ai-act-2024-1689": "EU AI Act", "nist-ai-rmf-1.0": "NIST AI RMF" };
/** Source first, so "Pasal 34" (UU PDP) and "A.5.34" (ISO 27001) never read as the same thing. */
const hitLabel = (h: { uid: string; ref: string }) => { const [code = "", ...rest] = h.uid.split("/"); return code === "iso-ids" ? `ISO ${rest.join(" ")}` : `${SRC[code] ?? code} · ${h.ref}`; };
type Hit = { uid: string; sourceTitle: string; ref: string; snippet: string; text_kind: string; verified: string };
type PHit = { kind: "process" | "risk" | "control"; activity_id: number; title: string; department: string; snippet: string };

// One library unit: the words, where they come from, whether they were checked, and the same topic in other laws.
export function UnitView({ uid, t, open }: { uid: string; t: T; open: (uid: string) => void }) {
  const [u, setU] = useState<Unit | null>(null);
  useEffect(() => { setU(null); api<Unit>(`/api/library/unit?uid=${encodeURIComponent(uid)}`).then(setU).catch(() => {}); }, [uid]);
  if (!u) return null;
  const link = (id: string, label: string) => <button key={id} className="underline" onClick={() => open(id)}>{label}</button>;
  return <div className="space-y-3 text-sm">
    <div className="text-xs text-muted-foreground">{u.sourceTitle}{u.breadcrumb.length > 0 && <> · {t.libParent} {u.breadcrumb.map((b, i) => <span key={b.uid}>{i > 0 && " › "}{link(b.uid, b.ref)}</span>)}</>}</div>
    <h3 className="text-base font-semibold">{u.ref}</h3>
    <div className="flex flex-wrap gap-2"><Badge tone={u.verified === "yes" ? "green" : "amber"}>{u.verified === "yes" ? t.libVerified : t.libUnverified}</Badge>
      <Badge tone={u.text_kind === "verbatim" ? "gray" : "amber"}>{u.text_kind === "verbatim" ? t.libVerbatim : t.libSummary}</Badge></div>
    <p className="whitespace-pre-wrap leading-relaxed">{u.text || "…"}</p>
    {u.children.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t.libParts}</div><div className="flex flex-wrap gap-2">{u.children.map((c) => link(c.uid, c.ref))}</div></div>}
    {u.related.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t.libEquiv}</div>
      <ul className="space-y-1">{u.related.map((r) => <li key={r.uid}>{link(r.uid, `${r.source} · ${r.ref}`)} <span className="text-xs text-muted-foreground">({t.libRel[r.relation] ?? r.relation})</span></li>)}</ul></div>}
    {u.url && <a className="text-xs underline" href={u.url} target="_blank" rel="noopener noreferrer">{t.libOpenSource} ↗</a>}
  </div>;
}

export function LibraryPage({ t, lang, openProcess }: { t: T; lang: string; openProcess: (id: number) => void }) {
  const [q, setQ] = useState(""); const [scope, setScope] = useState("all"); const [source, setSource] = useState("");
  const [sources, setSources] = useState<{ code: string; title: string; units: number }[]>([]);
  const [res, setRes] = useState<{ library: Hit[]; processes: PHit[] } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => { api<typeof sources>("/api/library/sources").then(setSources).catch(() => {}); }, []);
  const go = async () => { if (!q.trim()) return; setRes(await api(`/api/search?q=${encodeURIComponent(q)}&scope=${scope}${source ? `&source=${encodeURIComponent(source)}` : ""}`)); };
  return <>
    <h1 className="text-2xl font-semibold">{t.library}</h1>
    <Card className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input className={`${inputCls} min-w-60 flex-1`} placeholder={t.libSearch} maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">{t.libAll}</option><option value="library">{t.libLaw}</option><option value="processes">{t.libProc}</option></select>
        <select className={`${inputCls} max-w-56`} value={source} onChange={(e) => setSource(e.target.value)}><option value="">{t.libAnySource}</option>{sources.map((s) => <option key={s.code} value={s.code}>{s.title.slice(0, 50)}</option>)}</select>
        <Btn disabled={!q.trim()}>{t.libSearch.split(" ")[0]}</Btn>
      </form>
      <p className="text-xs text-muted-foreground">{t.libHint}</p>
    </Card>
    {res && <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        {!res.library.length && !res.processes.length && <p className="text-muted-foreground">{t.libNoResults}</p>}
        {res.library.map((h) => <Card key={h.uid} onClick={() => setUid(h.uid)} className={`cursor-pointer py-3 hover:bg-muted ${uid === h.uid ? "ring-2 ring-ring" : ""}`}>
          <div className="text-xs text-muted-foreground">{h.sourceTitle}</div><div className="font-medium">{hitLabel(h)}</div>
          <p className="mt-1 text-sm text-muted-foreground">{h.snippet.replace(/[\[\]]/g, "")}</p></Card>)}
        {res.processes.map((p, i) => <Card key={i} onClick={() => openProcess(p.activity_id)} className="cursor-pointer py-3 hover:bg-muted">
          <div className="flex items-center gap-2"><Badge tone="gray">{t.libKinds[p.kind]}</Badge><span className="font-medium">{p.title}</span></div>
          <div className="text-xs text-muted-foreground">{p.department}</div>{p.snippet && <p className="mt-1 text-sm text-muted-foreground">{p.snippet}</p>}</Card>)}
      </div>
      <Card className="h-fit md:sticky md:top-4">{uid ? <UnitView uid={uid} t={t} open={setUid} /> : <p className="text-sm text-muted-foreground">{t.libPick}</p>}</Card>
    </div>}
  </>;
}
