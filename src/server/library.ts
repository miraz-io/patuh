// The regulation library: parsed from library/*.md into SQLite, searched with FTS5.
// The AI never sees more than a few units at a time, and every unit it quotes can be checked against this table.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Q = Record<string, string | number | null>;

export type ParsedSource = { meta: Record<string, string>; units: { id: string; level: number; heading: string; text: string }[] };

export function parseSource(md: string): ParsedSource {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error("library file needs front matter");
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, ""); }
  if (!meta.code || !meta.lang || !meta.title) throw new Error("front matter needs code, lang and title");
  const units: ParsedSource["units"] = [];
  let cur: ParsedSource["units"][number] | null = null;
  for (const line of m[2].split(/\r?\n/)) {
    const h = /^(#{2,4})\s+(.*?)\s*\{#([^}\s]+)\}\s*$/.exec(line);
    if (h) { cur = { id: h[3], level: h[1].length, heading: h[2].trim(), text: "" }; units.push(cur); } else if (cur) cur.text += line + "\n";
  }
  for (const u of units) u.text = u.text.trim();
  return { meta, units };
}

/** Load (or reload) sources. A source is replaced only when its file changed; mappings are replaced as a whole. */
export function importSources(db: DatabaseSync, files: { name: string; content: string }[], mappingsCsv = ""): { sources: number; units: number } {
  let changed = false, units = 0;
  db.exec("BEGIN");
  try {
    const seen: string[] = [];
    for (const f of files) {
      const { meta, units: us } = parseSource(f.content);
      seen.push(meta.code);
      const hash = sha(f.content);
      const old = db.prepare("SELECT id,sha256 FROM lib_source WHERE code=?").get(meta.code) as { id: number; sha256: string } | undefined;
      if (old?.sha256 === hash) continue;
      if (old) db.prepare("DELETE FROM lib_source WHERE id=?").run(old.id);
      changed = true;
      const sid = Number(db.prepare(`INSERT INTO lib_source (code,lang,title,kind,jurisdiction,version,effective_from,status,licence,text_kind,url,verified,verified_on,note,sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(meta.code, meta.lang, meta.title, meta.kind ?? "", meta.jurisdiction ?? "", meta.version ?? "", meta.effective_from ?? "",
        meta.status ?? "in_force", meta.licence ?? "public", meta.text_kind ?? "verbatim", meta.url ?? "", meta.verified ?? "no", meta.verified_on ?? "", meta.note ?? "", hash).lastInsertRowid);
      const stack: { level: number; id: number }[] = [];
      us.forEach((u, ord) => {
        while (stack.length && stack[stack.length - 1].level >= u.level) stack.pop();
        const id = Number(db.prepare("INSERT INTO lib_unit (source_id,uid,parent_id,ord,level,ref,heading,text,text_kind,text_hash) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(sid, `${meta.code}/${u.id}`, stack.at(-1)?.id ?? null, ord, u.level, u.heading, u.heading, u.text, meta.text_kind ?? "verbatim", sha(u.text)).lastInsertRowid);
        stack.push({ level: u.level, id }); units++;
      });
    }
    for (const gone of db.prepare("SELECT id,code FROM lib_source").all() as { id: number; code: string }[]) if (!seen.includes(gone.code)) { db.prepare("DELETE FROM lib_source WHERE id=?").run(gone.id); changed = true; }
    db.exec("DELETE FROM lib_map");
    for (const line of mappingsCsv.split(/\r?\n/).slice(1)) {
      const [from, to, relation, note = "", by = ""] = line.split(",").map((x) => x.trim());
      if (from && to && relation) db.prepare("INSERT INTO lib_map (from_uid,to_uid,relation,note,reviewed_by) VALUES (?,?,?,?,?)").run(from, to, relation, note, by);
    }
    if (changed) for (const t of ["lib_fts", "lib_tri"]) db.exec(`INSERT INTO ${t}(${t}) VALUES('rebuild')`);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { sources: (db.prepare("SELECT COUNT(*) n FROM lib_source").get() as { n: number }).n, units: (db.prepare("SELECT COUNT(*) n FROM lib_unit").get() as { n: number }).n };
}

export function importLibraryDir(db: DatabaseSync, dir: string) {
  if (!existsSync(dir)) return { sources: 0, units: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !["readme.md", "verified.md"].includes(f.toLowerCase())).sort().map((name) => ({ name, content: readFileSync(join(dir, name), "utf8") }));
  const map = join(dir, "mappings.csv");
  return importSources(db, files, existsSync(map) ? readFileSync(map, "utf8") : "");
}

// ---------- search ----------
// English <-> Indonesian query expansion: the laws are in both languages, people ask in either.
const TERMS: string[][] = [
  ["dpia", "penilaian dampak", "impact assessment"], ["controller", "pengendali"], ["processor", "prosesor"], ["data subject", "subjek data"],
  ["personal data", "data pribadi"], ["consent", "persetujuan"], ["breach", "kegagalan", "pelanggaran"], ["retention", "retensi", "penyimpanan"],
  ["transfer", "transfer", "pengalihan", "luar wilayah"], ["dpo", "data protection officer", "pejabat", "petugas pelindungan"], ["security", "keamanan"],
  ["automated", "otomatis"], ["profiling", "profil", "pemrofilan"], ["risk", "risiko"], ["lawful basis", "legal basis", "dasar pemrosesan", "dasar"],
  ["notify", "notification", "pemberitahuan", "notifikasi"], ["high-risk", "high risk", "berisiko tinggi", "risiko tinggi"],
];
const words = (q: string) => q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const expand = (q: string): string[] => {
  const l = q.toLowerCase(), out = new Set(words(q));
  for (const g of TERMS) if (g.some((t) => l.includes(t))) for (const t of g) for (const w of words(t)) out.add(w);
  return [...out];
};
const quote = (w: string) => `"${w.replace(/"/g, '""')}"`;

export type Hit = { uid: string; source: string; sourceTitle: string; ref: string; text_kind: string; verified: string; snippet: string; score: number };
export type SearchOpts = { source?: string; lang?: string; limit?: number; advanced?: boolean };

const REF = /\b(?:pasal|article|art\.?|clause|ayat)\s*(\d+)(?:\s*(?:\(|\/|ayat\s*)(\d+)\)?)?/i;

function rows(db: DatabaseSync, table: "lib_fts" | "lib_tri", match: string, o: SearchOpts): Hit[] {
  const cols = table === "lib_fts" ? "snippet(lib_fts, 2, '[', ']', ' … ', 24)" : "snippet(lib_tri, 1, '[', ']', ' … ', 24)";
  const rank = table === "lib_fts" ? "bm25(lib_fts, 10, 5, 1)" : "bm25(lib_tri, 5, 1)";
  const sql = `SELECT u.uid, s.code source, s.title sourceTitle, COALESCE(pp.ref || ' › ', '') || u.ref ref, u.text_kind, s.verified, ${cols} snippet, ${rank} score
    FROM ${table} JOIN lib_unit u ON u.id=${table}.rowid LEFT JOIN lib_unit pp ON pp.id=u.parent_id JOIN lib_source s ON s.id=u.source_id
    WHERE ${table} MATCH ? AND s.status='in_force' AND (?='' OR s.code=?) AND (?='' OR s.lang=?) ORDER BY score LIMIT ?`;
  try { return db.prepare(sql).all(match, o.source ?? "", o.source ?? "", o.lang ?? "", o.lang ?? "", o.limit ?? 8) as Hit[]; } catch { return []; } // a bad advanced query is just "no results"
}

export function searchLibrary(db: DatabaseSync, q: string, o: SearchOpts = {}): Hit[] {
  q = q.trim().slice(0, 300);
  if (!q) return [];
  const advanced = o.advanced ?? /["*:]|\b(AND|OR|NOT|NEAR)\b/.test(q);
  if (advanced) return rows(db, "lib_fts", q, o);
  const out = new Map<string, Hit>();
  const ref = REF.exec(q); // "Pasal 34", "Art. 35(7)": jump straight to the unit
  if (ref) {
    const ids = [ref[1] + (ref[2] ? `/${ref[2]}` : ""), ref[1]];
    for (const id of ids) for (const r of db.prepare(`SELECT u.uid, s.code source, s.title sourceTitle, COALESCE(pp.ref || ' › ', '') || u.ref ref, u.text_kind, s.verified, substr(u.text,1,160) snippet, -100 score FROM lib_unit u LEFT JOIN lib_unit pp ON pp.id=u.parent_id JOIN lib_source s ON s.id=u.source_id
      WHERE (u.uid LIKE ? OR u.uid=?) AND s.status='in_force' AND (?='' OR s.code=?) AND (?='' OR s.lang=?) ORDER BY u.uid LIMIT 6`)
      .all(`%/${id}`, `%/${id}`, o.source ?? "", o.source ?? "", o.lang ?? "", o.lang ?? "") as Hit[]) out.set(r.uid, r);
  }
  const ws = expand(q);
  if (ws.length) for (const r of rows(db, "lib_fts", ws.map(quote).join(" OR "), o)) if (!out.has(r.uid)) out.set(r.uid, r);
  if (out.size < 3) { // trigram fallback: Indonesian affixes ("lindung" inside "pelindungan")
    const tri = ws.filter((w) => w.length >= 3);
    if (tri.length) for (const r of rows(db, "lib_tri", tri.map(quote).join(" OR "), o)) if (!out.has(r.uid)) out.set(r.uid, { ...r, score: r.score + 5 });
  }
  return [...out.values()].sort((a, b) => a.score - b.score).slice(0, o.limit ?? 8);
}

export type Unit = { uid: string; source: string; sourceTitle: string; url: string; verified: string; verified_on: string; text_kind: string; licence: string; ref: string; text: string; text_hash: string;
  breadcrumb: { uid: string; ref: string }[]; children: { uid: string; ref: string }[]; related: { uid: string; ref: string; source: string; relation: string; note: string; reviewed_by: string }[] };

export function getUnit(db: DatabaseSync, uid: string): Unit | null {
  const u = db.prepare(`SELECT u.*, s.code source, s.title sourceTitle, s.url, s.verified, s.verified_on, s.licence FROM lib_unit u JOIN lib_source s ON s.id=u.source_id WHERE u.uid=?`).get(uid) as Q | undefined;
  if (!u) return null;
  const breadcrumb: Unit["breadcrumb"] = [];
  for (let p = u.parent_id as number | null; p;) { const r = db.prepare("SELECT id,parent_id,uid,ref FROM lib_unit WHERE id=?").get(p) as Q; breadcrumb.unshift({ uid: r.uid as string, ref: r.ref as string }); p = r.parent_id as number | null; }
  const related = db.prepare(`SELECT x.uid, x.ref, s.code source, m.relation, m.note, m.reviewed_by FROM lib_map m JOIN lib_unit x ON x.uid = CASE WHEN m.from_uid=? THEN m.to_uid ELSE m.from_uid END
    JOIN lib_source s ON s.id=x.source_id WHERE m.from_uid=? OR m.to_uid=?`).all(uid, uid, uid) as Unit["related"];
  return { uid, source: u.source as string, sourceTitle: u.sourceTitle as string, url: u.url as string, verified: u.verified as string, verified_on: u.verified_on as string, text_kind: u.text_kind as string,
    licence: u.licence as string, ref: u.ref as string, text: u.text as string, text_hash: u.text_hash as string, breadcrumb,
    children: db.prepare("SELECT uid,ref FROM lib_unit WHERE parent_id=? ORDER BY ord").all(u.id as number) as Unit["children"], related };
}

export const listSources = (db: DatabaseSync) => db.prepare("SELECT code,lang,title,kind,jurisdiction,version,status,licence,text_kind,url,verified,verified_on,note,(SELECT COUNT(*) FROM lib_unit WHERE source_id=s.id) units FROM lib_source s ORDER BY code").all();

/** Lower-case, strip accents and collapse whitespace so a quote survives line breaks and typography. */
export const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();
