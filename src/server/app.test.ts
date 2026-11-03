import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

const post = (app: ReturnType<typeof createApp>, url: string, body: unknown) =>
  app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API end to end", () => {
  it("register -> risk -> control -> dashboard -> DPIA docx (en + id)", async () => {
    const app = createApp(openDb(":memory:"));
    const dep = (await (await post(app, "/api/departments", { name: "HR" })).json()) as { id: number };
    const act = (await (await post(app, "/api/activities", { department_id: dep.id, name: "CV screening with LLM",
      screening: ["new-technology", "scoring-monitoring"], cross_border: 1 })).json()) as { id: number };
    const risk = (await (await post(app, `/api/activities/${act.id}/risks`, { title: "Biased ranking", likelihood: 3, severity: 4 })).json()) as { id: number };
    expect((await post(app, `/api/risks/${risk.id}/controls`, { title: "Human review of every rejection" })).status).toBe(201);

    const dash = (await (await app.request("/api/dashboard")).json()) as Record<string, unknown>[];
    expect(dash[0]).toMatchObject({ dpiaRequired: true, basis: "uu-pdp", risks: 1, openControls: 1, consultation: true });

    for (const lang of ["en", "id"]) {
      const res = await app.request(`/api/activities/${act.id}/dpia.docx?lang=${lang}`);
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK"); // a .docx is a zip
    }
  });

  it("rejects bad input", async () => {
    const app = createApp(openDb(":memory:"));
    expect((await post(app, "/api/departments", {})).status).toBe(400);
    expect((await post(app, "/api/activities", { name: "x" })).status).toBe(400);
    expect((await app.request("/api/activities/999/dpia.docx")).status).toBe(404);
  });
});
