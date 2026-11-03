import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { createUser, type Role } from "./auth.js";
import { importSources, searchLibrary, getUnit } from "./library.js";
import { completeness } from "../core/completeness.js";

const PW = "correct horse battery";

const LIB = [
  { name: "uupdp.md", content: `---
code: uupdp-2022
lang: id
title: UU 27/2022 Pelindungan Data Pribadi
kind: law
jurisdiction: ID
text_kind: verbatim
verified: yes
---
## Pasal 34 {#34}
### Ayat (1) {#34/1}
Pengendali Data Pribadi wajib melakukan penilaian dampak Pelindungan Data Pribadi dalam hal pemrosesan Data Pribadi memiliki potensi risiko tinggi terhadap Subjek Data Pribadi.
### Ayat (2) {#34/2}
Pemrosesan Data Pribadi dengan potensi risiko tinggi meliputi pengambilan keputusan secara otomatis, pemrosesan data pribadi yang bersifat spesifik, dan pemrosesan data pribadi dalam skala besar.
## Pasal 46 {#46}
Dalam hal terjadi kegagalan Pelindungan Data Pribadi, Pengendali wajib menyampaikan pemberitahuan secara tertulis paling lambat 3 x 24 jam.
` },
  { name: "gdpr.md", content: `---
code: gdpr-2016-679
lang: en
title: GDPR
kind: law
jurisdiction: EU
text_kind: verbatim
verified: yes
---
## Article 35 {#35}
Where a type of processing is likely to result in a high risk to the rights and freedoms of natural persons, the controller shall carry out an assessment of the impact of the envisaged processing operations.
## Article 33 {#33}
In the case of a personal data breach, the controller shall notify the supervisory authority without undue delay and, where feasible, not later than 72 hours.
` },
];
const MAPS = "from,to,relation,note,reviewed_by\nuupdp-2022/34,gdpr-2016-679/35,equivalent,DPIA,test\n";

// Scripted model: each step is either tool calls or a final answer. Without `tools` in the request it must answer.
type Step = { tools: [string, object][] } | { final: unknown };
const script = (steps: Step[]) => {
  let i = 0;
  return (body: any) => {
    const st = body.tools ? steps[i++] : { final: { blocks: [] } };
    const usage = { prompt_tokens: 100, completion_tokens: 20 };
    if (!st) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [], note: "done" }) } }], usage }));
    if ("tools" in st) return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: st.tools.map(([name, args], n) => ({ id: `c${i}_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }], usage }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(st.final) } }], usage }));
  };
};

const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

async function setup(answer: (body: any) => Response = () => reply("{}")) {
  const db = openDb(":memory:");
  const hr = Number(db.prepare("INSERT INTO departments (name) VALUES ('HR')").run().lastInsertRowid);
  const fin = Number(db.prepare("INSERT INTO departments (name) VALUES ('Finance')").run().lastInsertRowid);
  const sent: { url: string; auth: string | null; body: any }[] = [];
  const aiFetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(init.body as string) });
    return answer(JSON.parse(init.body as string));
  }) as unknown as typeof fetch;
  importSources(db, LIB, MAPS);
  const app = createApp(db, { aiFetch });
  const mk = (email: string, role: Role, departmentId?: number) => createUser(db, { email, name: email, role, departmentId, password: PW });
  await Promise.all([mk("admin@x.id", "admin"), mk("dpo@x.id", "dpo"), mk("hr@x.id", "member", hr), mk("fin@x.id", "member", fin)]);
  const cookies: Record<string, string> = {};
  for (const e of ["admin", "dpo", "hr", "fin"]) {
    const r = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "patuh" }, body: JSON.stringify({ email: `${e}@x.id`, password: PW }) });
    cookies[e] = (r.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const call = (who: string, url: string, method = "GET", body?: unknown) => app.request(url, { method, headers: { "content-type": "application/json", "x-requested-with": "patuh", cookie: cookies[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, hr, fin, sent, call };
}
const configure = (call: Awaited<ReturnType<typeof setup>>["call"]) => call("admin", "/api/settings/ai", "PUT", { base_url: "http://localhost:11434/v1/", model: "m", api_key: "sk-secret" });

describe("AI settings", () => {
  it("admin only, key never sent back, bad URL refused, empty switches off", async () => {
    const { call } = await setup();
    expect((await call("dpo", "/api/settings")).status).toBe(403);
    expect((await call("hr", "/api/settings/ai", "PUT", { base_url: "http://x", model: "m" })).status).toBe(403);
    expect((await call("admin", "/api/settings/ai", "PUT", { base_url: "file:///etc/passwd", model: "m" })).status).toBe(400);
    expect((await call("admin", "/api/settings/ai", "PUT", { base_url: "https://x.test/v1", model: "" })).status).toBe(400);
    expect((await configure(call)).status).toBe(200);
    const s = await (await call("admin", "/api/settings")).json();
    expect(s.ai).toEqual({ base_url: "http://localhost:11434/v1/", model: "m", hasKey: true });
    expect(JSON.stringify(s)).not.toContain("sk-secret");
    expect((await (await call("hr", "/api/auth/me")).json()).ai).toBe(true);
    await call("admin", "/api/settings/ai", "PUT", { base_url: "", model: "", api_key: "" });
    expect((await (await call("hr", "/api/auth/me")).json()).ai).toBe(false);
  });
  it("test button calls the provider with the key and /chat/completions", async () => {
    const { call, sent } = await setup(() => reply("OK"));
    await configure(call);
    const r = await (await call("admin", "/api/settings/ai/test", "POST")).json();
    expect(r).toEqual({ ok: true, reply: "OK" });
    expect(sent[0]).toMatchObject({ url: "http://localhost:11434/v1/chat/completions", auth: "Bearer sk-secret" });
  });
});

const DRAFT = JSON.stringify({ purpose: "Pay staff", description: "AI wrote this", dpo_advice: "I approve", signed_by: "AI", name: "evil", screening: ["specific-data", "nope", "specific-data"],
  cross_border: true, risks: [{ title: "Leak", likelihood: 9, severity: 3, residual_likelihood: 4, residual_severity: 1, controls: [{ title: "Encrypt" }, "Train staff"] }, { title: "" }, "junk"] });

describe("AI-drafted process", () => {
  it("not configured -> 400, nothing created", async () => {
    const { call, hr } = await setup();
    expect((await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "Payroll", description: "x" })).status).toBe(400);
  });
  it("creates the record from name + description, sanitising what the model returned", async () => {
    const { call, hr, db, sent } = await setup(() => reply("```json\n" + DRAFT + "\n```"));
    await configure(call);
    const r = await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "Payroll", description: "We pay staff", lang: "id" });
    expect(r.status).toBe(201);
    const id = (await r.json()).id;
    const a = db.prepare("SELECT * FROM activities WHERE id=?").get(id) as any;
    expect(a).toMatchObject({ name: "Payroll", purpose: "Pay staff", description: "AI wrote this", cross_border: 1, dpo_advice: "", signed_by: "" });
    expect(JSON.parse(a.screening)).toEqual(["specific-data"]);
    const risks = db.prepare("SELECT * FROM risks WHERE activity_id=?").all(id) as any[];
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ title: "Leak", likelihood: 2, severity: 3, residual_likelihood: 2, residual_severity: 1 }); // 9 -> default 2; residual never above inherent
    expect(db.prepare("SELECT title FROM controls").all()).toEqual([{ title: "Encrypt" }, { title: "Train staff" }]);
    expect(sent[0].body.messages[0].content).toContain("Indonesian");
    expect(sent[0].body.messages[1].content).toContain("We pay staff");
  });
  it("other department -> 404, provider error -> 502 and nothing half-created", async () => {
    const { call, fin, hr, db } = await setup(() => new Response("nope", { status: 500 }));
    await configure(call);
    expect((await call("hr", "/api/activities/ai", "POST", { department_id: fin, name: "A", description: "b" })).status).toBe(404);
    expect((await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "A", description: "b" })).status).toBe(502);
    expect((db.prepare("SELECT COUNT(*) n FROM activities").get() as any).n).toBe(0);
  });
  it("garbage instead of JSON -> 502", async () => {
    const { call, hr } = await setup(() => reply("Sorry, I cannot help"));
    await configure(call);
    expect((await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "A", description: "b" })).status).toBe(502);
  });
});


// ---------- agent ----------
const mkAct = (db: any, hr: number, extra: Record<string, string> = {}) => {
  const id = Number(db.prepare("INSERT INTO activities (department_id,name,purpose,signed_by) VALUES (?,?,?,?)").run(hr, "Payroll", "Pay staff", extra.signed ?? "").lastInsertRowid);
  return id;
};
const chat = async (call: any, who: string, id: number, message: string, history: unknown[] = []) => (await call(who, `/api/activities/${id}/chat`, "POST", { message, history, lang: "en" })).json();

describe("agent: grounded answers", () => {
  it("answers a legal question from a library unit it read, with a verified quote", async () => {
    const { call, hr, db } = await setup(script([
      { tools: [["search_library", { query: "DPIA when required" }]] },
      { tools: [["read_unit", { uid: "uupdp-2022/34/2" }]] },
      { final: { blocks: [{ text: "High-risk processing includes automated decisions.", cites: ["uupdp-2022/34/2"], quote: "pengambilan keputusan secara otomatis" } ], note: "Anything else?" } },
    ]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "When is a DPIA required?");
    expect(r.outcome).toBe("answered");
    expect(r.blocks[0]).toMatchObject({ kind: "fact", cites: [{ uid: "uupdp-2022/34/2", verified: true }] });
    const log = db.prepare("SELECT * FROM ai_interaction WHERE kind='chat'").get() as any;
    expect(JSON.parse(log.tools_json)).toEqual(["search_library", "read_unit"]);
    expect(JSON.parse(log.cited_json)).toEqual(["uupdp-2022/34/2"]);
    expect(r.blocks[1]).toEqual({ kind: "talk", text: "Anything else?", cites: [] });
    expect(log).toMatchObject({ blocks_total: 1, blocks_dropped: 0, prompt_tokens: 300, completion_tokens: 60, steps: 3 });
  });
  it("drops a fact whose quote is not in the cited unit, one that cites nothing, and one that cites a unit it never read", async () => {
    const { call, hr, db } = await setup(script([
      { tools: [["search_library", { query: "breach" }], ["read_unit", { uid: "uupdp-2022/46" }]] },
      { final: { blocks: [
        { text: "Notify within 24 hours.", cites: ["uupdp-2022/46"], quote: "paling lambat 24 jam" },
        { text: "Fines are huge.", cites: [] },
        { text: "GDPR says 72 hours.", cites: ["gdpr-2016-679/33"], quote: "not later than 72 hours" },
        ], note: "Let me know." } },
    ]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "breach deadline?");
    expect(r.blocks.map((b: any) => b.text)).toEqual(["Let me know."]);
    expect((db.prepare("SELECT blocks_dropped d FROM ai_interaction").get() as any).d).toBe(3);
  });
  it("answering from memory (no tools, uncited fact) is declined with the closest library sections", async () => {
    const { call, hr, db } = await setup(script([{ final: { blocks: [{ text: "A DPIA is always required.", cites: [] }] } }]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "Pasal 34 DPIA?");
    expect(r.outcome).toBe("declined");
    expect(r.blocks[0].text).toMatch(/won't guess/);
    expect(r.blocks[0].cites.map((c: any) => c.uid)).toContain("uupdp-2022/34");
  });
  it("record facts need get_record first; R:screening needs run_screening", async () => {
    const { call, hr, db } = await setup(script([
      { tools: [["get_record", {}], ["run_screening", {}]] },
      { final: { blocks: [{ text: "Purpose is paying staff.", cites: ["P:purpose"] }, { text: "No DPIA criteria ticked.", cites: ["R:screening"] }] } },
    ]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "summary");
    expect(r.blocks).toHaveLength(2);
    const { call: c2, hr: h2, db: d2 } = await setup(script([{ final: { blocks: [{ text: "Purpose is X.", cites: ["P:purpose"] }] } }]));
    await configure(c2);
    expect((await chat(c2, "hr", mkAct(d2, h2), "summary")).outcome).toBe("declined");
  });
  it("a long legal statement cannot hide in the note (clipped), and made-up record cites are dropped", async () => {
    const { call, hr, db } = await setup(script([
      { tools: [["get_record", {}]] },
      { final: { blocks: [{ text: "Invented.", cites: ["P:made_up"] }, { text: "Real.", cites: ["P:purpose"] }], note: "x".repeat(500) } },
    ]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "q");
    expect(r.blocks.map((b: any) => b.text.length)).toEqual([5, 200]);
  });
  it("stops after a bounded number of tool rounds and still answers", async () => {
    const { call, hr, db } = await setup((body) => body.tools
      ? new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "x", function: { name: "get_record", arguments: "{}" } }] } }] }))
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"blocks":[],"note":"ok"}' } }] })));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "loop");
    expect(r.blocks[0].text).toBe("ok");
    expect((db.prepare("SELECT steps s FROM ai_interaction").get() as any).s).toBe(6);
  });
});

describe("agent: proposals", () => {
  const turn = (field: string, value: unknown): Step[] => [
    { tools: [["propose_field", { field, value, reason: "user said so" }], ["propose_field", { field: "signed_by", value: "AI", reason: "x" }], ["propose_field", { field: "purpose", value: "Pay staff", reason: "same" }]] },
    { final: { blocks: [], note: "Proposed." } },
  ];
  const propose = (field: string, value: unknown) => script([...turn(field, value), ...turn(field, value), ...turn(field, value)]);
  it("proposes without changing anything; only real, changed, allowed fields become proposals", async () => {
    const { call, hr, db } = await setup(propose("retention", "2 years"));
    await configure(call);
    const id = mkAct(db, hr);
    const r = await chat(call, "hr", id, "retention 2 years");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ kind: "field", target: "retention", before: "", after: "2 years" });
    expect(db.prepare("SELECT retention FROM activities WHERE id=?").get(id)).toEqual({ retention: "" });
  });
  it("accept applies it, records provenance, withdraws a sign-off; a second accept and a stale proposal fail", async () => {
    const { call, hr, db } = await setup(propose("retention", "2 years"));
    await configure(call);
    const id = mkAct(db, hr, { signed: "DPO Dina" });
    const p = (await chat(call, "hr", id, "x")).proposals[0], q = (await chat(call, "hr", id, "y")).proposals[0]; // both saw retention = ""
    expect((await call("fin", `/api/proposals/${p.id}/accept`, "POST", {})).status).toBe(404);
    expect((await call("hr", `/api/proposals/${p.id}/accept`, "POST", {})).status).toBe(200);
    expect(db.prepare("SELECT retention,signed_by FROM activities WHERE id=?").get(id)).toEqual({ retention: "2 years", signed_by: "" });
    expect(db.prepare("SELECT source,confirmed FROM field_meta WHERE activity_id=? AND field='retention'").get(id)).toEqual({ source: "ai_draft", confirmed: 1 });
    expect((await call("hr", `/api/proposals/${p.id}/accept`, "POST", {})).status).toBe(409);
    expect((await call("hr", `/api/proposals/${q.id}/accept`, "POST", {})).status).toBe(409); // the field changed after the AI looked
    expect((db.prepare("SELECT status FROM ai_proposal WHERE id=?").get(q.id) as any).status).toBe("stale");
  });
  it("edit-then-accept stores the person's text as theirs; reject changes nothing; auditor cannot decide", async () => {
    const { call, hr, db } = await setup(propose("retention", "2 years"));
    await configure(call);
    const id = mkAct(db, hr);
    const a = (await chat(call, "hr", id, "x")).proposals[0], b = (await chat(call, "hr", id, "x")).proposals[0];
    expect((await (await call("hr", `/api/proposals/${a.id}/accept`, "POST", { value: "18 months" })).json()).status).toBe("edited");
    expect(db.prepare("SELECT retention FROM activities WHERE id=?").get(id)).toEqual({ retention: "18 months" });
    expect(db.prepare("SELECT source FROM field_meta WHERE activity_id=? AND field='retention'").get(id)).toEqual({ source: "user" });
    expect((await call("hr", `/api/proposals/${b.id}/reject`, "POST", {})).status).toBe(200);
    expect(db.prepare("SELECT retention FROM activities WHERE id=?").get(id)).toEqual({ retention: "18 months" });
  });
  it("new risk proposal becomes a confirmed risk only when accepted; ask_user maps keys to the fixed question bank", async () => {
    const { call, hr, db } = await setup(script([
      { tools: [["propose_risk", { title: "Bias", likelihood: 3, severity: 3, residual_likelihood: 4, controls: ["Review"], reason: "r" }], ["ask_user", { gaps: [{ key: "retention", why: "needed" }, { key: "made_up", why: "x" }] }]] },
      { final: { blocks: [], note: "Two things." } },
    ]));
    await configure(call);
    const id = mkAct(db, hr);
    const r = await chat(call, "hr", id, "x");
    expect(r.outcome).toBe("clarified");
    expect(r.questions).toEqual([{ key: "retention", text: expect.stringContaining("kept"), why: "needed" }]);
    expect(db.prepare("SELECT COUNT(*) n FROM risks").get()).toEqual({ n: 0 });
    await call("hr", `/api/proposals/${r.proposals[0].id}/accept`, "POST", {});
    expect(db.prepare("SELECT title,source,confirmed,residual_likelihood FROM risks").get()).toEqual({ title: "Bias", source: "ai", confirmed: 1, residual_likelihood: 3 });
    expect(db.prepare("SELECT title FROM controls").all()).toEqual([{ title: "Review" }]);
  });
});

describe("provenance and sign-off gate", () => {
  it("an AI-drafted process cannot be signed until its drafts are confirmed", async () => {
    const { call, hr, db } = await setup(() => reply(DRAFT));
    await configure(call);
    const id = (await (await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "Payroll", description: "We pay staff" })).json()).id;
    expect(db.prepare("SELECT source,confirmed FROM field_meta WHERE activity_id=? AND field='purpose'").get(id)).toEqual({ source: "ai_draft", confirmed: 0 });
    expect(db.prepare("SELECT source,confirmed FROM risks").get()).toEqual({ source: "ai", confirmed: 0 });
    expect((await call("dpo", `/api/activities/${id}`, "PATCH", { signed_by: "DPO" })).status).toBe(400);
    const c = await (await call("hr", `/api/activities/${id}/completeness?lang=id`)).json();
    expect(c.ready).toBe(false);
    expect(c.gaps.find((g: any) => g.key === "purpose")).toMatchObject({ state: "draft" });
    expect(c.gaps.find((g: any) => g.key === "retention").question).toMatch(/Berapa lama/);
  });
  it("confirming everything (fields, screening, risks, controls) makes it signable", async () => {
    const { call, hr, db } = await setup(() => reply(DRAFT));
    await configure(call);
    const id = (await (await call("hr", "/api/activities/ai", "POST", { department_id: hr, name: "Payroll", description: "We pay staff" })).json()).id;
    const c0 = await (await call("hr", `/api/activities/${id}/completeness`)).json();
    const fields = c0.gaps.filter((g: any) => g.kind === "field" || g.kind === "screening").map((g: any) => g.key).concat(["retention", "legal_basis", "necessity", "data_location", "data_subjects", "data_categories", "description"]);
    await call("hr", `/api/activities/${id}/confirm`, "POST", { fields });
    for (const r of db.prepare("SELECT id FROM risks").all() as any[]) await call("hr", `/api/risks/${r.id}/confirm`, "POST", {});
    const c = await (await call("hr", `/api/activities/${id}/completeness`)).json();
    // the fixture draft has no retention/legal_basis/etc: those stay empty and keep blocking
    expect(c.gaps.every((g: any) => g.state === "empty" || g.kind === "control")).toBe(true);
    for (const k of ["legal_basis", "retention", "necessity", "data_location", "data_subjects", "data_categories"]) await call("hr", `/api/activities/${id}`, "PATCH", { [k]: "filled" });
    db.prepare("INSERT INTO controls (risk_id,title) SELECT id,'x' FROM risks WHERE id NOT IN (SELECT risk_id FROM controls)").run();
    expect((await call("dpo", `/api/activities/${id}`, "PATCH", { signed_by: "DPO" })).status).toBe(200);
  });
});

describe("library", () => {
  it("finds by reference, by Indonesian word stem, by phrase, and crosses languages", async () => {
    const { db } = await setup();
    expect(searchLibrary(db, "Pasal 34")[0].uid).toBe("uupdp-2022/34");
    expect(searchLibrary(db, "Art. 35")[0].uid).toBe("gdpr-2016-679/35");
    expect(searchLibrary(db, "lindung").some((h) => h.uid.startsWith("uupdp"))).toBe(true);        // trigram: "Pelindungan"
    expect(searchLibrary(db, '"keputusan secara otomatis"')[0].uid).toBe("uupdp-2022/34/2");        // advanced phrase
    expect(searchLibrary(db, "breach notification deadline").map((h) => h.uid)).toEqual(expect.arrayContaining(["gdpr-2016-679/33", "uupdp-2022/46"])); // EN query reaches the ID law
    expect(searchLibrary(db, "x", { source: "gdpr-2016-679" })).toEqual([]);
    expect(searchLibrary(db, 'unbalanced "quote')).toEqual([]);                                      // never throws
    const u = getUnit(db, "uupdp-2022/34/2")!;
    expect(u.breadcrumb.map((b) => b.ref)).toEqual(["Pasal 34"]);
    expect(getUnit(db, "uupdp-2022/34")!.related).toMatchObject([{ uid: "gdpr-2016-679/35", relation: "equivalent" }]);
    expect(getUnit(db, "nope")).toBeNull();
  });
  it("search API: library plus own processes, department rules apply; unit and sources endpoints", async () => {
    const { call, hr, fin, db } = await setup();
    const a = mkAct(db, hr); db.prepare("UPDATE activities SET vendor='Acme Cloud' WHERE id=?").run(a);
    const f = Number(db.prepare("INSERT INTO activities (department_id,name,vendor) VALUES (?,?,?)").run(fin, "Treasury", "Acme Bank").lastInsertRowid);
    const mine = await (await call("hr", "/api/search?q=acme")).json();
    expect(mine.processes.map((p: any) => p.activity_id)).toEqual([a]);
    expect((await (await call("admin", "/api/search?q=acme")).json()).processes.map((p: any) => p.activity_id).sort()).toEqual([a, f].sort());
    expect((await (await call("hr", "/api/search?q=Pasal%2034&scope=library")).json()).library[0].uid).toBe("uupdp-2022/34");
    expect((await call("hr", "/api/library/unit?uid=uupdp-2022/34")).status).toBe(200);
    expect((await (await call("hr", "/api/library/sources")).json()).map((s: any) => s.code)).toEqual(["gdpr-2016-679", "uupdp-2022"]);
  });
  it("re-import replaces only changed sources and removes deleted ones", async () => {
    const { db } = await setup();
    const before = db.prepare("SELECT id FROM lib_source WHERE code='gdpr-2016-679'").get() as any;
    importSources(db, LIB, MAPS);
    expect((db.prepare("SELECT id FROM lib_source WHERE code='gdpr-2016-679'").get() as any).id).toBe(before.id);
    importSources(db, [LIB[0]], MAPS);
    expect(db.prepare("SELECT COUNT(*) n FROM lib_source").get()).toEqual({ n: 1 });
    expect(searchLibrary(db, "controller").some((h) => h.uid.startsWith("gdpr"))).toBe(false);
  });
});

describe("completeness (rules, no AI)", () => {
  const act = { screening: [] as string[], purpose: "p", description: "d", data_categories: "c", data_subjects: "s", legal_basis: "l", retention: "r", necessity: "n", data_location: "id" };
  it("screening must be answered; empty fields and AI drafts are gaps", () => {
    expect(completeness(act, [], []).gaps.map((g) => g.key)).toEqual(["screening"]);
    expect(completeness(act, [{ field: "screening", source: "user", confirmed: 1 }], []).ready).toBe(true);
    const c = completeness({ ...act, retention: "" }, [{ field: "screening", source: "user", confirmed: 1 }, { field: "purpose", source: "ai_draft", confirmed: 0 }], []);
    expect(c.gaps).toEqual([{ key: "purpose", kind: "field", state: "draft" }, { key: "retention", kind: "field", state: "empty" }].map((g) => expect.objectContaining(g)));
  });
  it("a DPIA process also needs reviewed risks, each with a control", () => {
    const m = [{ field: "screening", source: "user" as const, confirmed: 1 }];
    const a = { ...act, screening: ["new-technology"] };
    expect(completeness(a, m, []).gaps.map((g) => g.key)).toContain("risks");
    const c = completeness(a, m, [{ id: 7, title: "t", source: "ai", confirmed: 0, controls: 0 }]);
    expect(c.gaps.map((g) => g.key)).toEqual(["risk:7", "controls:7"]);
  });
});

describe("AI metrics", () => {
  it("admin and DPO only; counts grounding, proposals and declines from the audit trail", async () => {
    const { call, hr, db } = await setup(script([{ final: { blocks: [{ text: "x", cites: [] }] } }]));
    await configure(call);
    await chat(call, "hr", mkAct(db, hr), "unsupported question");
    expect((await call("hr", "/api/ai/metrics")).status).toBe(403);
    const m = await (await call("dpo", "/api/ai/metrics")).json();
    expect(m).toMatchObject({ chats: 1, declineRate: 1, unsupportedRate: 1, groundingRate: 0, library: { sources: 2 } });
    expect(m.declinedQuestions).toEqual([{ q: "unsupported question", n: 1 }]);
  });
  it("rating is only for your own interaction; question text is purged after the retention period", async () => {
    const { call, hr, db } = await setup(script([{ final: { blocks: [], note: "hi" } }]));
    await configure(call);
    const r = await chat(call, "hr", mkAct(db, hr), "secret personal question");
    expect((await call("fin", `/api/interactions/${r.interaction_id}/rating`, "POST", { rating: 1 })).status).toBe(404);
    expect((await call("hr", `/api/interactions/${r.interaction_id}/rating`, "POST", { rating: 1 })).status).toBe(200);
    db.prepare("UPDATE ai_interaction SET at=datetime('now','-200 days')").run();
    await chat(call, "hr", mkAct(db, hr), "another"); // any new chat runs the purge
    expect(db.prepare("SELECT question,answer_json,outcome FROM ai_interaction WHERE id=?").get(r.interaction_id)).toEqual({ question: "", answer_json: "", outcome: "answered" });
  });
});
