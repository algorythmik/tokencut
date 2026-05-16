#!/usr/bin/env node
// Minimal tokencut mock service.
// Always returns miss on /v1/query and acks on /v1/store.
// Use this to test the extension's live Copilot path end-to-end.

import http from "http";

const PORT = 8787;

const routes = {
  "GET /health": (_body, res) => {
    json(res, 200, { ok: true });
  },

  "POST /v1/query": (body, res) => {
    console.log(`[query] kind=${body.requestKind} workspace=${body.workspaceId ?? "-"}`);
    json(res, 200, { decision: "miss", reason: "mock_service" });
  },

  "POST /v1/store": (body, res) => {
    console.log(`[store] kind=${body.query?.requestKind} latency=${body.latencyMs}ms`);
    json(res, 200, { stored: true });
  },
};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const key = `${req.method} ${req.url}`;
    const handler = routes[key];

    if (!handler) {
      json(res, 404, { error: `No route for ${key}` });
      return;
    }

    let body = {};
    try {
      if (raw) body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }

    handler(body, res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`tokencut mock service running at http://127.0.0.1:${PORT}`);
  console.log("  GET  /health   → ok");
  console.log("  POST /v1/query → always miss");
  console.log("  POST /v1/store → ack");
});

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
