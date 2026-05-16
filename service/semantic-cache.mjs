import crypto from "crypto";
import { pipeline } from "@xenova/transformers";
import db from "./db.mjs";
import { normalizePrompt } from "./normalize.mjs";

// Cosine similarity threshold for accepting a semantic match.
const SIMILARITY_THRESHOLD = 0.82;

// ─── Embedding model ──────────────────────────────────────────────────────────
// Loaded once at startup. Falls back to TF cosine while the model is loading
// (first cold start downloads ~23 MB to ~/.cache/huggingface/).

let extractor = null;
let modelReady = false;

pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2").then((e) => {
  extractor = e;
  modelReady = true;
  console.log("[semantic] embedding model ready (all-MiniLM-L6-v2)");
}).catch((err) => {
  console.error("[semantic] model load failed, falling back to TF cosine:", err.message);
});

async function embed(text) {
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Buffer.from(out.data.buffer);   // Float32Array → BLOB
}

// ─── TF cosine fallback (used while model loads and for legacy rows) ──────────
const STOPWORDS = new Set([
  "the", "a", "an", "is", "it", "this", "that", "what", "how", "do", "i",
  "in", "to", "of", "and", "or", "for", "my", "be", "can", "does", "will",
  "with", "on", "at", "are", "was", "have", "get", "me", "please", "just",
  "use", "from", "by", "not", "its",
]);

function tokenize(text) {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function tf(tokens) {
  const counts = {};
  for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
  const max = Math.max(...Object.values(counts), 1);
  const result = {};
  for (const [t, c] of Object.entries(counts)) result[t] = c / max;
  return result;
}

function tfCosine(a, b) {
  const va = tf(tokenize(a)), vb = tf(tokenize(b));
  let dot = 0, magA = 0, magB = 0;
  for (const k of Object.keys(va)) {
    dot  += va[k] * (vb[k] ?? 0);
    magA += va[k] * va[k];
  }
  for (const v of Object.values(vb)) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── Key derivation (matches exact-cache) ────────────────────────────────────
function makeKey(requestKind, normalizedPrompt, selectionHash, workspaceId) {
  const raw = [requestKind, normalizedPrompt, selectionHash ?? "", workspaceId ?? ""].join("\x00");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ─── SQLite statements ────────────────────────────────────────────────────────
const stmtInsertSemantic = db.prepare(`
  INSERT OR REPLACE INTO semantic_cache
    (prompt_key, request_kind, workspace_id, selection_hash, normalized_prompt, created_at, embedding)
  VALUES
    (@promptKey, @requestKind, @workspaceId, @selectionHash, @normalizedPrompt, @createdAt, @embedding)
`);

const stmtInsertVec = db.prepare(`
  INSERT OR REPLACE INTO vec_prompts (rowid, embedding, prompt_key)
  SELECT sc.rowid, @embedding, @promptKey
  FROM   semantic_cache sc WHERE sc.prompt_key = @promptKey
`);

// sqlite-vec ANN search filtered by kind/workspace/selectionHash.
// k=5 returns up to 5 nearest neighbours; we take the closest.
const stmtVecSearch = db.prepare(`
  SELECT v.prompt_key, v.distance
  FROM   vec_prompts v
  JOIN   semantic_cache sc ON sc.rowid = v.rowid
  WHERE  v.embedding MATCH @embedding
    AND  sc.request_kind  = @requestKind
    AND  (sc.workspace_id = @workspaceId OR (sc.workspace_id IS NULL AND @workspaceId IS NULL))
    AND  (@selectionHash IS NULL OR sc.selection_hash = @selectionHash)
    AND  k = 5
  ORDER  BY v.distance
`);

// Legacy rows (embedding IS NULL) — used by TF cosine fallback.
const stmtGetLegacyCandidates = db.prepare(`
  SELECT prompt_key, normalized_prompt, selection_hash
  FROM   semantic_cache
  WHERE  request_kind = ?
    AND  (workspace_id = ? OR (workspace_id IS NULL AND ? IS NULL))
    AND  embedding IS NULL
`);

const stmtGetAnswer = db.prepare(`
  SELECT answer FROM exact_cache WHERE prompt_key = ?
`);

const stmtLog = db.prepare(`
  INSERT INTO request_log
    (id, timestamp, request_kind, prompt_key, workspace_id, decision, reason, latency_ms)
  VALUES
    (@id, @timestamp, @requestKind, @promptKey, @workspaceId, @decision, @reason, @latencyMs)
`);

// ─── Shared log + return helper ───────────────────────────────────────────────
function reusedResult(promptKey, answer, similarity, requestKind, workspaceId) {
  stmtLog.run({
    id:          crypto.randomUUID(),
    timestamp:   Date.now(),
    requestKind: requestKind ?? "unknown",
    promptKey,
    workspaceId: workspaceId ?? null,
    decision:    "reused",
    reason:      "semantic_match",
    latencyMs:   null,
  });
  return {
    decision:        "reused",
    answer,
    reason:          "semantic_match",
    confidence:      Math.round(similarity * 1000) / 1000,
    sourceRequestId: promptKey,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function querySemantic(body) {
  const { requestKind, prompt, selectionHash, workspaceId } = body;

  // summarize-file has a 1-day TTL and content drifts — skip semantic reuse.
  if (requestKind === "summarize-file") return null;

  const normalized = normalizePrompt(prompt);

  if (modelReady) {
    // ── Dense embedding path (sqlite-vec ANN) ────────────────────────────────
    const queryEmbed = await embed(normalized);
    const rows = stmtVecSearch.all({
      embedding:     queryEmbed,
      requestKind,
      workspaceId:   workspaceId ?? null,
      // For explain-selection, restrict to the same code block.
      selectionHash: requestKind === "explain-selection" ? (selectionHash ?? null) : null,
    });

    if (rows.length > 0) {
      // Model embeds with L2-normalised vectors, so cosine = 1 - dist²/2.
      const best       = rows[0];
      const similarity = 1 - (best.distance * best.distance) / 2;
      if (similarity >= SIMILARITY_THRESHOLD) {
        const row = stmtGetAnswer.get(best.prompt_key);
        if (row) return reusedResult(best.prompt_key, row.answer, similarity, requestKind, workspaceId);
      }
    }
    return null;
  }

  // ── TF cosine fallback (model still loading) ─────────────────────────────
  let candidates = stmtGetLegacyCandidates.all(requestKind, workspaceId ?? null, workspaceId ?? null);
  if (requestKind === "explain-selection") {
    candidates = candidates.filter(c => c.selection_hash === (selectionHash ?? null));
  }
  if (candidates.length === 0) return null;

  let bestScore = 0, bestKey = null;
  for (const c of candidates) {
    const score = tfCosine(normalized, c.normalized_prompt);
    if (score > bestScore) { bestScore = score; bestKey = c.prompt_key; }
  }
  if (bestScore < SIMILARITY_THRESHOLD || bestKey === null) return null;

  const row = stmtGetAnswer.get(bestKey);
  if (!row) return null;
  return reusedResult(bestKey, row.answer, bestScore, requestKind, workspaceId);
}

export async function storeSemantic(body) {
  const { query } = body;
  const { requestKind, prompt, selectionHash, workspaceId } = query;

  if (requestKind === "summarize-file") return;

  const normalized = normalizePrompt(prompt);
  const key        = makeKey(requestKind, normalized, selectionHash, workspaceId);
  const embedding  = modelReady ? await embed(normalized) : null;

  stmtInsertSemantic.run({
    promptKey:        key,
    requestKind,
    workspaceId:      workspaceId ?? null,
    selectionHash:    selectionHash ?? null,
    normalizedPrompt: normalized,
    createdAt:        Date.now(),
    embedding,
  });

  if (embedding) {
    stmtInsertVec.run({ embedding, promptKey: key });
  }
}
