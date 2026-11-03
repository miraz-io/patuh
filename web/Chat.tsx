import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import type { Lang, T } from "./i18n.js";
import { Btn, inputCls } from "./ui.js";

type Applied = { kind: "field" | "screening" | "risk" | "control"; label: string };
type Turn = { role: "user" | "assistant"; content: string; applied?: Applied[] };

// Floating chat for one process. The AI answers and may edit the record; `changed` refreshes the page behind it.
export function ChatBubble({ actId, lang, t, changed }: { actId: number; lang: Lang; t: T; changed: () => void }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy, open]);

  const send = async () => {
    const message = msg.trim(); if (!message || busy) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns([...turns, { role: "user", content: message }]); setMsg(""); setBusy(true);
    try {
      const r = await api<{ reply: string; applied: Applied[] }>(`/api/activities/${actId}/chat`, "POST", { message, history, lang });
      setTurns((x) => [...x, { role: "assistant", content: r.reply, applied: r.applied }]);
      if (r.applied.length) changed();
    } catch { /* the error banner shows the reason */ } finally { setBusy(false); }
  };
  const label = (a: Applied) => `${t.chatKinds[a.kind]}: ${a.kind === "field" ? (t.fields as Record<string, string>)[a.label] ?? a.label : a.kind === "screening" ? t.screening.replace(/^\d\.\s*/, "") : a.label}`;

  return <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
    {open && <div role="dialog" aria-label={t.chatTitle} className="flex h-[32rem] max-h-[75vh] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-lg border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3"><span className="font-medium">{t.chatTitle}</span>
        <button onClick={() => setOpen(false)} aria-label="Close" className="text-lg leading-none text-muted-foreground">×</button></div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {!turns.length && <p className="text-muted-foreground">{t.chatHint}</p>}
        {turns.map((x, i) => <div key={i} className={x.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "mr-8 rounded-lg bg-muted px-3 py-2"}>
          <div className="whitespace-pre-wrap">{x.content}</div>
          {!!x.applied?.length && <div className="mt-2 border-t pt-2 text-xs text-muted-foreground"><div className="font-medium">{t.chatChanged}</div>
            <ul className="list-inside list-disc">{x.applied.map((a, j) => <li key={j}>{label(a)}</li>)}</ul></div>}
        </div>)}
        {busy && <p className="text-muted-foreground">{t.thinking}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className={`${inputCls} min-w-0 flex-1`} placeholder={t.chatPlaceholder} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus />
        <Btn disabled={busy || !msg.trim()}>{t.send}</Btn>
      </form>
    </div>}
    <button data-tour="chat" onClick={() => setOpen(!open)} aria-label={t.chatTitle} aria-expanded={open}
      className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
    </button>
  </div>;
}
