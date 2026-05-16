import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { getLoadablePath } from "sqlite-vec";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "tokencut.db"), { allowExtension: true });
db.loadExtension(getLoadablePath());

// Enable WAL mode for better concurrent read performance.
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS exact_cache (
    prompt_key   TEXT    PRIMARY KEY,
    request_kind TEXT    NOT NULL,
    answer       TEXT    NOT NULL,
    model_id     TEXT    NOT NULL,
    workspace_id TEXT,
    git_revision TEXT,
    created_at   INTEGER NOT NULL,
    hit_count    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS request_log (
    id           TEXT    PRIMARY KEY,
    timestamp    INTEGER NOT NULL,
    request_kind TEXT    NOT NULL,
    prompt_key   TEXT    NOT NULL,
    workspace_id TEXT,
    decision     TEXT    NOT NULL,
    reason       TEXT    NOT NULL,
    latency_ms   INTEGER
  );

  CREATE TABLE IF NOT EXISTS semantic_cache (
    prompt_key        TEXT    PRIMARY KEY,
    request_kind      TEXT    NOT NULL,
    workspace_id      TEXT,
    selection_hash    TEXT,
    normalized_prompt TEXT    NOT NULL,
    created_at        INTEGER NOT NULL,
    embedding         BLOB
  );
`);

// Add embedding column to existing DBs that pre-date this migration.
try {
  db.exec("ALTER TABLE semantic_cache ADD COLUMN embedding BLOB");
} catch { /* column already exists */ }

// Virtual table for ANN vector search (sqlite-vec).
// +prompt_key is an auxiliary column — stored but not indexed.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_prompts USING vec0(
    embedding float[384],
    +prompt_key TEXT
  );
`);

export default db;
