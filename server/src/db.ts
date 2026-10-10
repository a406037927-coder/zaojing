import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export interface ProjectRow {
  id: string;
  name: string;
  prompt: string;
  code: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  project_id: string;
  version_no: number;
  prompt: string;
  code: string;
  created_at: string;
}

fs.mkdirSync(config.dataDir, { recursive: true });
const database = new Database(path.join(config.dataDir, "zaojing.sqlite"));
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    code TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, version_no)
  );

  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_versions_project ON project_versions(project_id, version_no DESC);
`);

export const db = database;

export const projectRepository = {
  list() {
    return db.prepare(`
      SELECT id, name, prompt, current_version, created_at, updated_at
      FROM projects ORDER BY updated_at DESC
    `).all();
  },
  get(id: string) {
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  },
  versions(id: string) {
    return db.prepare(`
      SELECT id, project_id, version_no, prompt, created_at
      FROM project_versions WHERE project_id = ? ORDER BY version_no DESC
    `).all(id);
  },
  create(project: ProjectRow) {
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, prompt, code, current_version, created_at, updated_at)
        VALUES (@id, @name, @prompt, @code, @current_version, @created_at, @updated_at)
      `).run(project);
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, prompt, code, created_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(crypto.randomUUID(), project.id, project.prompt, project.code, project.created_at);
    });
    transaction();
    return this.get(project.id);
  },
  update(id: string, prompt: string, code: string) {
    const current = this.get(id);
    if (!current) return undefined;
    const latest = db.prepare("SELECT COALESCE(MAX(version_no), 0) AS value FROM project_versions WHERE project_id = ?")
      .get(id) as { value: number };
    const nextVersion = latest.value + 1;
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, prompt, code, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), id, nextVersion, prompt, code, now);
      db.prepare(`
        UPDATE projects SET prompt = ?, code = ?, current_version = ?, updated_at = ? WHERE id = ?
      `).run(prompt, code, nextVersion, now, id);
    });
    transaction();
    return this.get(id);
  },
  restorePrevious(id: string) {
    const current = this.get(id);
    if (!current || current.current_version <= 1) return undefined;
    const previous = db.prepare(`
      SELECT * FROM project_versions
      WHERE project_id = ? AND version_no < ?
      ORDER BY version_no DESC LIMIT 1
    `).get(id, current.current_version) as VersionRow | undefined;
    if (!previous) return undefined;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE projects SET prompt = ?, code = ?, current_version = ?, updated_at = ? WHERE id = ?
    `).run(previous.prompt, previous.code, previous.version_no, now, id);
    return this.get(id);
  },
  delete(id: string) {
    return db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  },
};
