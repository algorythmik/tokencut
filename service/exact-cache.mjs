// node:sqlite StatementSync has the same .get() / .run() surface as better-sqlite3.
import crypto from "crypto";
import db from "./db.mjs";
import { normalizePrompt } from "./normalize.mjs";

// TTL per request kind in milliseconds.
const TTL_MS = {
  "repo-question":     7  * 24 * 60 * 60 * 1000, // 7 days  — stable across sessions
  "explain-selection": 30 * 24 * 60 * 60 * 1000, // 30 days — keyed to selectionHash
  "summarize-file":    1  * 24 * 60 * 60 * 1000, // 1 day   — file content may change
};
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Exact match key is a SHA-256 hash of four stable fields joined with a
 * null byte to prevent collision across fields.
 *
 *   requestKind \0 normalizedPrompt \0 selectionHash \0 workspaceId
 *
 * - selectionHash:  ensures explain-selection answers are tied to code content
 * - workspaceId:    scopes repo-question answers to the right project
 */
function makeKey(requestKind, normalizedPrompt, selectionHash, workspaceId) {
  const raw = [
    requestKind,
    normalizedPrompt,
    selectionHash  ?? "",
    workspaceId    ?? "",
  ].join("\x00");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const stmtGet = db.prepare(`
  SELECT answer, model_id, created_at, hit_count
  FROM   exact_cache
  WHERE  prompt_key = ?
`);

const stmtInsert = db.prepare(`
  INSERT OR REPLACE INTO exact_cache
    (prompt_key, request_kind, answer, model_id, workspace_id, git_revision, created_at, hit_count)
  VALUES
    (@promptKey, @requestKind, @answer, @modelId, @workspaceId, @gitRevision, @createdAt, 0)
`);

const stmtIncrementHit = db.prepare(`
  UPDATE exact_cache SET hit_count = hit_count + 1 WHERE prompt_key = ?
`);

const stmtLog = db.prepare(`
  INSERT INTO request_log (id, timestamp, request_kind, prompt_key, workspace_id, decision, reason, latency_ms)
  VALUES (@id, @timestamp, @requestKind, @promptKey, @workspaceId, @decision, @reason, @latencyMs)
`);

export function queryExact(body) {
  const { requestId, requestKind, prompt, selectionHash, workspaceId } = body;

  const normalized = normalizePrompt(prompt);
  const key        = makeKey(requestKind, normalized, selectionHash, workspaceId);
  const ttl        = TTL_MS[requestKind] ?? DEFAULT_TTL_MS;
  const row        = stmtGet.get(key);

  let decision, reason;

  if (!row) {
    decision = "miss";
    reason   = "no_exact_match";
  } else if (Date.now() - row.created_at > ttl) {
    decision = "miss";
    reason   = "stale";
  } else {
    stmtIncrementHit.run(key);
    decision = "reused";
    reason   = "exact_match";
  }

  stmtLog.run({
    id:          requestId ?? crypto.randomUUID(),
    timestamp:   Date.now(),
    requestKind: requestKind ?? "unknown",
    promptKey:   key,
    workspaceId: workspaceId ?? null,
    decision,
    reason,
    latencyMs:   null,
  });

  if (decision === "reused") {
    return {
      decision:        "reused",
      answer:          row.answer,
      reason:          "exact_match",
      confidence:      1.0,
      sourceRequestId: key,
    };
  }

  return { decision: "miss", reason };
}

export function storeExact(body) {
  const { query, answer, modelId, latencyMs } = body;
  const { requestId, requestKind, prompt, selectionHash, workspaceId, gitRevision } = query;

  const normalized = normalizePrompt(prompt);
  const key        = makeKey(requestKind, normalized, selectionHash, workspaceId);

  stmtInsert.run({
    promptKey:   key,
    requestKind: requestKind,
    answer:      answer,
    modelId:     modelId,
    workspaceId: workspaceId ?? null,
    gitRevision: gitRevision ?? null,
    createdAt:   Date.now(),
  });

  stmtLog.run({
    id:          crypto.randomUUID(),   // always a fresh id — requestId was already logged at query time
    timestamp:   Date.now(),
    requestKind: requestKind ?? "unknown",
    promptKey:   key,
    workspaceId: workspaceId ?? null,
    decision:    "stored",
    reason:      "live",
    latencyMs:   latencyMs ?? null,
  });

  return { stored: true };
}

export function getStats() {
  const totalCached  = db.prepare("SELECT COUNT(*) as n FROM exact_cache").get().n;
  const totalHits    = db.prepare("SELECT COALESCE(SUM(hit_count), 0) as n FROM exact_cache").get().n;
  const totalMisses       = db.prepare("SELECT COUNT(*) as n FROM request_log WHERE decision = 'miss'").get().n;
  const totalStored       = db.prepare("SELECT COUNT(*) as n FROM request_log WHERE decision = 'stored'").get().n;
  const totalSemanticHits = db.prepare("SELECT COUNT(*) as n FROM request_log WHERE decision = 'reused' AND reason = 'semantic_match'").get().n;

  return { totalCached, totalHits, totalMisses, totalStored, totalSemanticHits };
}
