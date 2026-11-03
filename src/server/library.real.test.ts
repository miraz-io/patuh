// Checks on the shipped library/ files and the golden retrieval set (no AI involved).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { getUnit, importLibraryDir, searchLibrary } from "./library.js";

const db = openDb(":memory:");
const stats = importLibraryDir(db, "library");

describe("shipped library", () => {
  it("loads, every source says whether its text was verified, summaries are never marked verbatim", () => {
    expect(stats.sources).toBeGreaterThanOrEqual(5);
    for (const s of db.prepare("SELECT code,verified,text_kind,licence FROM lib_source").all() as any[]) {
      expect(["yes", "no"]).toContain(s.verified);
      if (s.licence === "summary") expect(s.text_kind).toBe("summary");
    }
  });
  it("every mapping points at units that exist, and the units behind the screening rules exist", () => {
    for (const m of db.prepare("SELECT from_uid f,to_uid t FROM lib_map").all() as any[]) { expect(getUnit(db, m.f), m.f).not.toBeNull(); expect(getUnit(db, m.t), m.t).not.toBeNull(); }
    for (const u of ["uupdp-2022/34", "uupdp-2022/34/2", "gdpr-2016-679/35", "gdpr-2016-679/35/3"]) expect(getUnit(db, u), u).not.toBeNull();
  });
  it("ISO text is never shipped, only IDs and short labels", () => {
    for (const u of db.prepare("SELECT length(u.text) n FROM lib_unit u JOIN lib_source s ON s.id=u.source_id WHERE s.code LIKE 'iso%'").all() as any[]) expect(u.n).toBeLessThan(300);
  });
});

// eval/golden.jsonl: {q, lang, expect: [uid...]} - the expected unit must be in the top 5 results. Target: >= 85%.
describe("golden retrieval set", () => {
  const items = readFileSync("eval/golden.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l) as { q: string; expect: string[] });
  it("hit@5 is at least 85%", () => {
    const misses = items.filter((i) => !i.expect.some((e) => searchLibrary(db, i.q, { limit: 5 }).some((h) => h.uid === e || h.uid.startsWith(e + "/"))));
    expect(misses.map((m) => m.q), `hit@5 ${(1 - misses.length / items.length).toFixed(2)}`).toEqual(expect.any(Array));
    expect(1 - misses.length / items.length).toBeGreaterThanOrEqual(0.85);
  });
});
