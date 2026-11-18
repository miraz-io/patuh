import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { addrProblem, embeddedV4, ipGroup, pinnedFetch } from "./net.js";
import { aiUrlProblem } from "./ai.js";
import { accountDelay, clearAccount, recordAccountFail } from "./auth.js";
import { aiConfig } from "./ai.js";
import { getApiKey } from "./secret.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createUser } from "./auth.js";

describe("outbound address guard", () => {
  it("normalises every IPv6 spelling of an IPv4 address", () => {
    for (const a of ["::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::169.254.169.254", "::a9fe:a9fe", "64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254", "[::ffff:a9fe:a9fe]"])
      expect(embeddedV4(a), a).toBe("169.254.169.254");
  });
  it("blocks link-local, metadata and trailing-dot hosts, allows loopback and LAN", () => {
    for (const u of ["http://169.254.169.254/", "http://[fe80::1]/", "http://[febf::1]/", "http://[fd00:ec2::254]/", "http://metadata.google.internal./v1", "http://[::ffff:169.254.169.254]/",
      "http://[64:ff9b::a9fe:a9fe]/", "http://100.100.100.200/", "http://2852039166/"]) expect(aiUrlProblem(u), u).not.toBeNull();
    for (const u of ["http://127.0.0.1:11434/v1", "http://localhost/v1", "http://192.168.1.5/v1", "https://api.openai.com/v1", "http://[::1]/v1"]) expect(aiUrlProblem(u), u).toBeNull();
    expect(addrProblem("fec0::1")).toBeNull(); // site-local is not link-local
  });
  it("groups IPv6 clients by /64 and unwraps mapped IPv4", () => {
    expect(ipGroup("2001:db8:1:2:aaaa::1")).toBe(ipGroup("2001:db8:1:2:bbbb::9"));
    expect(ipGroup("2001:db8:1:3::1")).not.toBe(ipGroup("2001:db8:1:2::1"));
    expect(ipGroup("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });
  it("pinnedFetch reaches a local server, refuses metadata literals and redirects", async () => {
    const srv = createServer((req, res) => { if (req.url === "/r") { res.writeHead(302, { location: "http://169.254.169.254/" }); return res.end(); } res.end('{"ok":1}'); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      const r = await pinnedFetch(`http://localhost:${port}/x`, { method: "POST", body: "{}" });
      expect(await r.json()).toEqual({ ok: 1 });
      await expect(pinnedFetch(`http://127.0.0.1:${port}/r`, { method: "POST", body: "{}" })).rejects.toThrow(/Redirect/);
      await expect(pinnedFetch("http://[::ffff:a9fe:a9fe]/", { method: "POST", body: "{}" })).rejects.toThrow(/not allowed/);
    } finally { srv.close(); }
  });
});

describe("per-account slowdown", () => {
  it("slows after 10 failures from anywhere, up to 2 s, and never locks", () => {
    const k = "slow@x.id"; clearAccount(k);
    for (let i = 0; i < 10; i++) recordAccountFail(k);
    expect(accountDelay(k)).toBe(0);
    for (let i = 0; i < 3; i++) recordAccountFail(k);
    expect(accountDelay(k)).toBe(600);
    for (let i = 0; i < 100; i++) recordAccountFail(k);
    expect(accountDelay(k)).toBe(2000);
    clearAccount(k); expect(accountDelay(k)).toBe(0);
  });
});

describe("AI key stays with its endpoint", () => {
  const saved = { k: process.env.PATUH_AI_API_KEY, b: process.env.PATUH_AI_BASE_URL };
  afterEach(() => { for (const [n, v] of [["PATUH_AI_API_KEY", saved.k], ["PATUH_AI_BASE_URL", saved.b]] as const) v === undefined ? delete process.env[n] : (process.env[n] = v); });
  it("env key is ignored without an operator-set base URL, and the base URL is then the operator's", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key,value) VALUES ('ai_base_url','https://admin.example/v1'),('ai_model','m')").run();
    process.env.PATUH_AI_API_KEY = "sk-operator";
    expect(getApiKey(db)).toBe("");
    process.env.PATUH_AI_BASE_URL = "https://operator.example/v1";
    expect(aiConfig(db)).toMatchObject({ baseUrl: "https://operator.example/v1", apiKey: "sk-operator" });
  });
  it("changing the address to another origin clears the stored key; the same origin keeps it", async () => {
    const db = openDb(":memory:");
    await createUser(db, { email: "a@x.id", name: "A", role: "admin", password: "correct horse battery" });
    const app = createApp(db), h = { "content-type": "application/json", "x-requested-with": "patuh" };
    const cookie = ((await app.request("/api/auth/login", { method: "POST", headers: h, body: JSON.stringify({ email: "a@x.id", password: "correct horse battery" }) })).headers.get("set-cookie") ?? "").split(";")[0];
    const put = (b: object) => app.request("/api/settings/ai", { method: "PUT", headers: { ...h, cookie }, body: JSON.stringify(b) });
    await put({ base_url: "https://one.example/v1", model: "m", api_key: "sk-1" });
    await put({ base_url: "https://one.example/v2", model: "m" });
    expect(aiConfig(db)?.apiKey).toBe("sk-1");
    await put({ base_url: "https://evil.example/v1", model: "m" });
    expect(aiConfig(db)?.apiKey).toBe("");
  });
});
