import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  data_categories TEXT NOT NULL DEFAULT '', data_subjects TEXT NOT NULL DEFAULT '',
  ai_system TEXT NOT NULL DEFAULT '', vendor TEXT NOT NULL DEFAULT '',
  data_location TEXT NOT NULL DEFAULT '', cross_border INTEGER NOT NULL DEFAULT 0,
  legal_basis TEXT NOT NULL DEFAULT '', retention TEXT NOT NULL DEFAULT '',
  necessity TEXT NOT NULL DEFAULT '',
  screening TEXT NOT NULL DEFAULT '[]',
  dpo_advice TEXT NOT NULL DEFAULT '', subjects_views TEXT NOT NULL DEFAULT '',
  review_date TEXT NOT NULL DEFAULT '', signed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS risks (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 4),
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  residual_likelihood INTEGER CHECK (residual_likelihood BETWEEN 1 AND 4),
  residual_severity INTEGER CHECK (residual_severity BETWEEN 1 AND 4));
CREATE TABLE IF NOT EXISTS controls (
  id INTEGER PRIMARY KEY,
  risk_id INTEGER NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in-progress','done')));
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA);
  return db;
}

export type Row = Record<string, string | number | null>;
export const ACTIVITY_FIELDS = ["name", "purpose", "description", "data_categories", "data_subjects", "ai_system",
  "vendor", "data_location", "cross_border", "legal_basis", "retention", "necessity", "screening", "dpo_advice",
  "subjects_views", "review_date", "signed_by"] as const;

export function createActivity(db: DatabaseSync, departmentId: number, input: Row): number {
  const cols = ACTIVITY_FIELDS.filter((f) => input[f] !== undefined);
  const sql = `INSERT INTO activities (department_id, ${cols.join(",")}) VALUES (?, ${cols.map(() => "?").join(",")})`;
  return Number(db.prepare(sql).run(departmentId, ...cols.map((c) => input[c] as string | number)).lastInsertRowid);
}

export function updateActivity(db: DatabaseSync, id: number, input: Row): void {
  const cols = ACTIVITY_FIELDS.filter((f) => input[f] !== undefined); // allow-list: never builds SQL from user keys
  if (!cols.length) return;
  db.prepare(`UPDATE activities SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id=?`)
    .run(...cols.map((c) => input[c] as string | number), id);
}
