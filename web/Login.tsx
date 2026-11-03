import { useEffect, useState } from "react";
import { api } from "./api.js";
import { TXT, type Lang } from "./i18n.js";
import { Btn, Card, inputCls } from "./ui.js";

export function Login({ lang, setLang, done }: { lang: Lang; setLang: (l: Lang) => void; done: () => void }) {
  const t = TXT[lang];
  const [cfg, setCfg] = useState<{ sso: boolean; org: string }>({ sso: false, org: "" });
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const sso = new URLSearchParams(location.search).get("sso_error");
  useEffect(() => { api<typeof cfg>("/api/auth/config").then(setCfg).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/login", "POST", { email, password }); history.replaceState(null, "", "/"); done(); }
    catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4">
        <div className="flex items-start justify-between"><div><div className="text-xl font-semibold">Patuh</div><div className="text-sm text-muted-foreground">{cfg.org}</div></div>
          <div className="flex gap-1">{(["en", "id"] as const).map((l) => <Btn key={l} variant={lang === l ? "primary" : "outline"} onClick={() => setLang(l)}>{l.toUpperCase()}</Btn>)}</div></div>
        {sso && <p className="rounded-md bg-red-500/15 p-2 text-sm text-red-600">{sso === "denied" ? t.ssoDenied : t.ssoError}</p>}
        {cfg.sso && <><a href="/api/auth/oidc/login" className="flex h-9 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground">{t.signInSso}</a>
          <div className="text-center text-xs text-muted-foreground">{t.or}</div></>}
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{t.email}</span>
            <input className={`${inputCls} w-full`} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{t.password}</span>
            <input className={`${inputCls} w-full`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Btn type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{t.signIn}</Btn>
        </form>
      </Card>
    </div>
  );
}
