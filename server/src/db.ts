import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { GeneratedAcceptanceItem } from "./ai.js";

export type VersionOperation = "generate" | "modify" | "repair" | "restore";
export type AcceptanceStatus = "unchecked" | "passed" | "failed";

export interface ProjectRow {
  id: string;
  name: string;
  prompt: string;
  original_prompt: string;
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
  operation_type: VersionOperation;
  change_summary: string;
  created_at: string;
}

export interface AcceptanceRow {
  id: string;
  project_id: string;
  version_no: number;
  title: string;
  expected_result: string;
  status: AcceptanceStatus;
  issue_description: string;
  source: "ai" | "user";
  sort_order: number;
  created_at: string;
  updated_at: string;
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
if (!projectColumns.some((column) => column.name === "original_prompt")) {
  database.exec("ALTER TABLE projects ADD COLUMN original_prompt TEXT NOT NULL DEFAULT ''");
  database.exec(`
    UPDATE projects SET original_prompt = COALESCE(
      (SELECT prompt FROM project_versions WHERE project_versions.project_id = projects.id ORDER BY version_no ASC LIMIT 1),
      prompt
    ) WHERE original_prompt = ''
  `);
}
const versionColumns = database.prepare("PRAGMA table_info(project_versions)").all() as Array<{ name: string }>;
if (!versionColumns.some((column) => column.name === "operation_type")) {
  database.exec("ALTER TABLE project_versions ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'generate'");
  database.exec("UPDATE project_versions SET operation_type = 'modify' WHERE version_no > 1");
}
if (!versionColumns.some((column) => column.name === "change_summary")) {
  database.exec("ALTER TABLE project_versions ADD COLUMN change_summary TEXT NOT NULL DEFAULT ''");
}
database.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS acceptance_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    expected_result TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unchecked' CHECK(status IN ('unchecked', 'passed', 'failed')),
    issue_description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai', 'user')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id, version_no) REFERENCES project_versions(project_id, version_no) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_acceptance_version ON acceptance_items(project_id, version_no, sort_order);
`);

export const db = database;

function insertAcceptance(projectId: string, versionNo: number, items: GeneratedAcceptanceItem[], source: "ai" | "user" = "ai") {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO acceptance_items
      (id, project_id, version_no, title, expected_result, status, issue_description, source, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'unchecked', '', ?, ?, ?, ?)
  `);
  items.slice(0, 20).forEach((item, index) => {
    statement.run(crypto.randomUUID(), projectId, versionNo, item.title, item.expected, source, index, now, now);
  });
}

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
      SELECT id, project_id, version_no, prompt, operation_type, change_summary, created_at
      FROM project_versions WHERE project_id = ? ORDER BY version_no DESC
    `).all(id);
  },
  version(id: string, versionNo: number, ownerId: string) {
    if (!this.get(id, ownerId)) return undefined;
    return db.prepare("SELECT * FROM project_versions WHERE project_id = ? AND version_no = ?")
      .get(id, versionNo) as VersionRow | undefined;
  },
  create(project: ProjectRow, meta?: { acceptance?: GeneratedAcceptanceItem[]; summary?: string }) {
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO projects (id, name, prompt, original_prompt, code, current_version, created_at, updated_at, owner_id)
        VALUES (@id, @name, @prompt, @original_prompt, @code, @current_version, @created_at, @updated_at, @owner_id)
      `).run(project);
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, prompt, code, operation_type, change_summary, created_at)
        VALUES (?, ?, 1, ?, ?, 'generate', ?, ?)
      `).run(crypto.randomUUID(), project.id, project.prompt, project.code, meta?.summary || "首次生成", project.created_at);
      insertAcceptance(project.id, 1, meta?.acceptance || []);
    });
    transaction();
    return this.get(project.id, project.owner_id);
  },
  update(id: string, prompt: string, code: string, ownerId: string, options?: {
    operationType?: VersionOperation;
    summary?: string;
    acceptance?: GeneratedAcceptanceItem[];
  }) {
    const current = this.get(id, ownerId);
    if (!current) return undefined;
    const latest = db.prepare("SELECT COALESCE(MAX(version_no), 0) AS value FROM project_versions WHERE project_id = ?")
      .get(id) as { value: number };
    const nextVersion = latest.value + 1;
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO project_versions (id, project_id, version_no, prompt, code, operation_type, change_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), id, nextVersion, prompt, code,
        options?.operationType || "modify", options?.summary || "继续修改", now,
      );
      db.prepare(`
        UPDATE projects SET prompt = ?, code = ?, current_version = ?, updated_at = ? WHERE id = ? AND owner_id = ?
      `).run(prompt, code, nextVersion, now, id, ownerId);
      insertAcceptance(id, nextVersion, options?.acceptance || []);
    });
    transaction();
    return this.get(id, ownerId);
  },
  restore(id: string, targetVersionNo: number, ownerId: string) {
    const current = this.get(id, ownerId);
    const target = this.version(id, targetVersionNo, ownerId);
    if (!current || !target) return undefined;
    const priorItems = acceptanceRepository.list(id, targetVersionNo, ownerId)
      .map((item) => ({ title: item.title, expected: item.expected_result }));
    return this.update(id, target.prompt, target.code, ownerId, {
      operationType: "restore",
      summary: `恢复 v${targetVersionNo} 的内容`,
      acceptance: priorItems,
    });
  },
  restorePrevious(id: string, ownerId: string) {
    const current = this.get(id, ownerId);
    if (!current || current.current_version <= 1) return undefined;
    return this.restore(id, current.current_version - 1, ownerId);
  },
  rename(id: string, name: string, ownerId: string) {
    const now = new Date().toISOString();
    const changed = db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(name, now, id, ownerId).changes;
    return changed ? this.get(id, ownerId) : undefined;
  },
  delete(id: string, ownerId?: string) {
    return ownerId
      ? db.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").run(id, ownerId).changes > 0
      : db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  },
};

export const acceptanceRepository = {
  list(projectId: string, versionNo: number, ownerId: string) {
    if (!projectRepository.version(projectId, versionNo, ownerId)) return [];
    return db.prepare(`
      SELECT * FROM acceptance_items WHERE project_id = ? AND version_no = ? ORDER BY sort_order, created_at
    `).all(projectId, versionNo) as AcceptanceRow[];
  },
  add(projectId: string, versionNo: number, ownerId: string, title: string, expected: string) {
    if (!projectRepository.version(projectId, versionNo, ownerId)) return undefined;
    const next = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 value FROM acceptance_items WHERE project_id = ? AND version_no = ?")
      .get(projectId, versionNo) as { value: number };
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO acceptance_items
        (id, project_id, version_no, title, expected_result, status, issue_description, source, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'unchecked', '', 'user', ?, ?, ?)
    `).run(id, projectId, versionNo, title, expected, next.value, now, now);
    return db.prepare("SELECT * FROM acceptance_items WHERE id = ?").get(id) as AcceptanceRow;
  },
  update(projectId: string, versionNo: number, itemId: string, ownerId: string, values: {
    title: string;
    expected: string;
    status: AcceptanceStatus;
    issueDescription: string;
  }) {
    if (!projectRepository.version(projectId, versionNo, ownerId)) return undefined;
    const now = new Date().toISOString();
    const changed = db.prepare(`
      UPDATE acceptance_items SET title = ?, expected_result = ?, status = ?, issue_description = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND version_no = ?
    `).run(values.title, values.expected, values.status, values.issueDescription, now, itemId, projectId, versionNo).changes;
    return changed ? db.prepare("SELECT * FROM acceptance_items WHERE id = ?").get(itemId) as AcceptanceRow : undefined;
  },
  delete(projectId: string, versionNo: number, itemId: string, ownerId: string) {
    if (!projectRepository.version(projectId, versionNo, ownerId)) return false;
    return db.prepare("DELETE FROM acceptance_items WHERE id = ? AND project_id = ? AND version_no = ?")
      .run(itemId, projectId, versionNo).changes > 0;
  },
};

export const userRepository = {
  count() {
    return (db.prepare("SELECT COUNT(*) AS value FROM users").get() as { value: number }).value;
  },
  create(user: UserRow) {
    db.prepare(`INSERT INTO users (id, username, password_hash, password_salt, created_at)
      VALUES (@id, @username, @password_hash, @password_salt, @created_at)`).run(user);
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
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(tokenHash, userId, new Date().toISOString(), expiresAt);
  },
  getUser(tokenHash: string) {
    return db.prepare(`
      SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, new Date().toISOString()) as UserRow | undefined;
  },
  delete(tokenHash: string) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  },
};
