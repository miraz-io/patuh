// Patuh admin script. Run on the server:  npm run admin -- help
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { openDb, getSetting, setSetting } from "../server/db.js";
import { createUser, findUserByEmail, setPassword, type Role } from "../server/auth.js";
import { DEMO_DEPARTMENTS, demoLoaded, loadDemo, removeDemo } from "../server/demo.js";
import type { DatabaseSync } from "node:sqlite";

const HELP = `Patuh admin

  npm run admin -- init [--org NAME] [--demo | --no-demo] [--admin-email E] [--admin-name N]
      First-time setup: organisation name, first admin, optional demo data + interactive tutorials.
  npm run admin -- user add --email E --name N --role admin|dpo|member|auditor [--department D] [--sso]
      --sso creates a user with no password who signs in through your identity provider.
  npm run admin -- user list | passwd --email E | disable --email E | enable --email E | remove --email E
  npm run admin -- department add --name N
  npm run admin -- demo load | remove
  npm run admin -- audit [--limit 50]

Roles: admin and dpo can do everything; member works only in their department; auditor can read everything and change nothing.
Passwords are asked for hidden (or set PATUH_NEW_PASSWORD for scripts). Add --db PATH for a non-default database.
Single sign-on is set up with PATUH_OIDC_* environment variables, see the README.`;

async function ask(q: string, def = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim(); rl.close();
  return a || def;
}
async function askHidden(q: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("No terminal to ask for a password. Set PATUH_NEW_PASSWORD instead.");
  process.stdout.write(q + " ");
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let s = "";
    const on = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", on); process.stdout.write("\n"); return resolve(s); }
        if (c === "\u0003") { process.stdin.setRawMode(false); return reject(new Error("Cancelled")); }
        if (c === "\u007f") s = s.slice(0, -1); else s += c;
      }
    };
    process.stdin.on("data", on);
  });
}
async function newPassword(): Promise<string> {
  if (process.env.PATUH_NEW_PASSWORD) return process.env.PATUH_NEW_PASSWORD;
  const a = await askHidden("Password (min 12 characters):"), b = await askHidden("Repeat password:");
  if (a !== b) throw new Error("Passwords do not match");
  return a;
}
const deptId = (db: DatabaseSync, name?: string): number | null => {
  if (!name) return null;
  const d = db.prepare("SELECT id FROM departments WHERE name=? COLLATE NOCASE").get(name) as { id: number } | undefined;
  if (!d) throw new Error(`No department called "${name}". Add it with: department add --name "${name}"`);
  return d.id;
};

export async function run(argv: string[]): Promise<void> {
  const { values: v, positionals: p } = parseArgs({ args: argv, allowPositionals: true, options: {
    db: { type: "string" }, org: { type: "string" }, demo: { type: "boolean" }, "no-demo": { type: "boolean" }, email: { type: "string" }, name: { type: "string" },
    role: { type: "string" }, department: { type: "string" }, sso: { type: "boolean" }, limit: { type: "string" }, "admin-email": { type: "string" }, "admin-name": { type: "string" } } });
  const [cmd, sub] = p;
  if (!cmd || cmd === "help") return console.log(HELP);
  const db = openDb(v.db ?? process.env.PATUH_DB ?? "data/patuh.db");
  const need = (x: string | undefined, flag: string) => { if (!x) throw new Error(`--${flag} is required`); return x; };

  if (cmd === "init") {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) throw new Error("Already set up (users exist). Use `user add` to add people.");
    const org = v.org ?? (await ask("Organisation name:"));
    if (!org) throw new Error("Organisation name is required");
    const email = v["admin-email"] ?? (await ask("Admin email:"));
    const name = v["admin-name"] ?? (await ask("Admin name:", "Administrator"));
    const demo = v.demo ? true : v["no-demo"] ? false
      : /^y/i.test(await ask("Include demo data and interactive tutorials? A fictional organisation with sample processes, risks and DPIAs (y/N)", "n"));
    const sso = v.sso ? true : false;
    const password = sso ? null : await newPassword();
    setSetting(db, "org_name", org.trim().slice(0, 200));
    await createUser(db, { email, name, role: "admin", password });
    if (demo) { const r = loadDemo(db); console.log(`Demo data loaded: ${r.processes} processes in ${DEMO_DEPARTMENTS.length} departments.`); }
    console.log(`Done. Start Patuh with: npm start   (admin: ${email})`);
    return;
  }
  if (cmd === "user") {
    if (sub === "add") {
      const role = need(v.role, "role") as Role;
      const password = v.sso ? null : await newPassword();
      const id = await createUser(db, { email: need(v.email, "email"), name: need(v.name, "name"), role, departmentId: deptId(db, v.department), password });
      return console.log(`User created (#${id}).${v.sso ? " Sign-in is by single sign-on only." : ""}`);
    }
    if (sub === "list") {
      for (const u of db.prepare("SELECT u.email,u.name,u.role,u.disabled,u.password_hash IS NULL AS sso,d.name AS dept FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.id").all() as Record<string, string | number | null>[])
        console.log(`${u.email}\t${u.name}\t${u.role}\t${u.dept ?? "-"}\t${u.sso ? "sso" : "password"}${u.disabled ? "\tDISABLED" : ""}`);
      return;
    }
    const email = need(v.email, "email"), u = findUserByEmail(db, email);
    if (!u) throw new Error("No such user");
    if (sub === "passwd") { await setPassword(db, email, await newPassword()); return console.log("Password changed. The user is signed out everywhere."); }
    if (sub === "disable" || sub === "enable") {
      if (sub === "disable" && u.role === "admin" && (db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0").get() as { n: number }).n <= 1) throw new Error("Cannot disable the last active admin");
      db.prepare("UPDATE users SET disabled=? WHERE id=?").run(sub === "disable" ? 1 : 0, u.id);
      if (sub === "disable") db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
      return console.log(`User ${sub}d.`);
    }
    if (sub === "remove") {
      if (u.role === "admin" && (db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get() as { n: number }).n <= 1) throw new Error("Cannot remove the last admin");
      db.prepare("DELETE FROM users WHERE id=?").run(u.id); return console.log("User removed.");
    }
  }
  if (cmd === "department" && sub === "add") {
    db.prepare("INSERT INTO departments (name) VALUES (?)").run(need(v.name, "name").trim()); return console.log("Department added.");
  }
  if (cmd === "demo" && (sub === "load" || sub === "remove")) {
    if (sub === "load") { if (!getSetting(db, "org_name")) setSetting(db, "org_name", "Demo Organisation"); const r = loadDemo(db); return console.log(demoLoaded(db) && !r.processes ? "Demo data is already loaded." : `Demo data loaded: ${r.processes} processes.`); }
    removeDemo(db); return console.log("Demo data and tutorials removed. Your own data is untouched.");
  }
  if (cmd === "audit") {
    const n = Math.min(Math.max(Number(v.limit ?? 50) || 50, 1), 1000);
    for (const r of db.prepare("SELECT at,email,method,path,status FROM audit_log ORDER BY id DESC LIMIT ?").all(n) as Record<string, string | number>[]) console.log(`${r.at}\t${r.email || "-"}\t${r.method} ${r.path}\t${r.status}`);
    return;
  }
  throw new Error(`Unknown command. Run: npm run admin -- help`);
}

// Only run when executed directly, so tests can import `run`.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
