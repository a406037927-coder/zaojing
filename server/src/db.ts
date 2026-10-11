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
  owner_id: string;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

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
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

const projectColumns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
if (!projectColumns.some((column) => column.name === "owner_id")) {
  database.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)");
}
database.exec("CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at DESC)");

export const db = database;

export const projectRepository = {
  claimUnowned(ownerId: string) {
    return db.prepare("UPDATE projects SET owner_id = ? WHERE owner_id IS NULL").run(ownerId).changes;
  },
  list(ownerId: string) {
    return db.prepare(`
      SELECT id, name, prompt, current_version, created_at, updated_at
      FROM projects WHERE owner_id = ? ORDER BY updated_at DESC
    `).all(ownerId);
  },
  get(id: string, ownerId: string) {
    return db.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?").get(id, ownerId) as ProjectRow | undefined;
  },
  versions(id: string, ownerId: string) {
    if (!this.get(id, ownerId)) return [];
    return db.prepare(`
      SELECT id, project_id, version_no, prompt, created_at
      FROM project_versions WHERE project_id = ? ORDER BY version_no DESC
    `).all(id);
  },
  create(project: ProjectRow) {
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, prompt, code, current_version, created_at, updated_at, owner_id)
        VALUES (@id, @name, @prompt, @code, @current_version, @created_at, @updated_at, @owner_id)
      `).run(project);
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, prompt, code, created_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(crypto.randomUUID(), project.id, project.prompt, project.code, project.created_at);
    });
    transaction();
    return this.get(project.id, project.owner_id);
  },
  update(id: string, prompt: string, code: string, ownerId: string) {
    const current = this.get(id, ownerId);
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
    return this.get(id, ownerId);
  },
  restorePrevious(id: string, ownerId: string) {
    const current = this.get(id, ownerId);
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
    return this.get(id, ownerId);
  },
  delete(id: string, ownerId?: string) {
    return ownerId
      ? db.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").run(id, ownerId).changes > 0
      : db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  },
};

export const userRepository = {
  count() {
    return (db.prepare("SELECT COUNT(*) AS value FROM users").get() as { value: number }).value;
  },
  create(user: UserRow) {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, password_salt, created_at)
      VALUES (@id, @username, @password_hash, @password_salt, @created_at)
    `).run(user);
    return this.getById(user.id);
  },
  getById(id: string) {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  },
  getByUsername(username: string) {
    return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | undefined;
  },
};

export const sessionRepository = {
  create(tokenHash: string, userId: string, expiresAt: string) {
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
    db.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, userId, new Date().toISOString(), expiresAt);
  },
  getUser(tokenHash: string) {
    return db.prepare(`
      SELECT users.* FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, new Date().toISOString()) as UserRow | undefined;
  },
  delete(tokenHash: string) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  },
};
