import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { T } from "./i18n.js";
import { Btn, Card, inputCls } from "./ui.js";

export function Settings({ t, reloadMe }: { t: T; reloadMe: () => void }) {
  const [f, setF] = useState({ base_url: "", model: "", api_key: "" });
  const [hasKey, setHasKey] = useState(false);
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ ai: { base_url: string; model: string; hasKey: boolean } }>("/api/settings").then(({ ai }) => { setF({ base_url: ai.base_url, model: ai.model, api_key: "" }); setHasKey(ai.hasKey); }).catch(() => {}); }, []);
  const save = async () => {
    await api("/api/settings/ai", "PUT", { base_url: f.base_url, model: f.model, ...(f.api_key ? { api_key: f.api_key } : {}) });
    if (f.api_key) setHasKey(true);
    setF({ ...f, api_key: "" }); setNote(t.saved); reloadMe();
  };
  const test = async () => { setBusy(true); setNote(t.testing); try { await save(); const r = await api<{ reply: string }>("/api/settings/ai/test", "POST"); setNote(`${t.testOk} “${r.reply}”`); } catch { setNote(""); } finally { setBusy(false); } };
  const field = (k: "base_url" | "model", label: string, hint?: string) => <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{label}</span>
    <input className={`${inputCls} w-full`} maxLength={k === "model" ? 100 : 300} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setNote(""); }} />{hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}</label>;
  return <>
    <h1 className="text-2xl font-semibold">{t.settings}</h1>
    <Card className="max-w-2xl space-y-4"><div><h2 className="font-medium">{t.aiTitle}</h2><p className="mt-1 text-sm text-muted-foreground">{t.aiIntro}</p></div>
      {field("base_url", t.aiUrl, t.aiUrlHint)}
      {field("model", t.aiModel)}
      <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{t.aiKey}</span>
        <input type="password" autoComplete="off" className={`${inputCls} w-full`} maxLength={500} placeholder={hasKey ? t.aiKeyKept : t.aiKeyNone} value={f.api_key} onChange={(e) => { setF({ ...f, api_key: e.target.value }); setNote(""); }} /></label>
      <p className="rounded-md bg-amber-500/15 p-3 text-sm text-amber-600">{t.aiPrivacy}</p>
      <div className="flex flex-wrap items-center gap-3"><Btn disabled={busy} onClick={() => save().catch(() => {})}>{t.save}</Btn>
        <Btn variant="outline" disabled={busy || !f.base_url || !f.model} onClick={test}>{t.test}</Btn>
        {note && <span role="status" className="text-sm text-muted-foreground">{note}</span>}</div>
      <p className="text-xs text-muted-foreground">{t.aiOff}</p></Card>
  </>;
}
