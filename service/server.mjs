import http from "http";
import { queryExact, storeExact, getStats } from "./exact-cache.mjs";
import { querySemantic, storeSemantic } from "./semantic-cache.mjs";

const PORT = 8787;

const routes = {
  "GET /health": (_body, res) => {
    json(res, 200, { ok: true });
  },

  "POST /v1/query": async (body, res) => {
    let result = queryExact(body);
    if (result.decision === "miss") {
      const sem = await querySemantic(body);
      if (sem) result = sem;
    }
    console.log(
      `[query] kind=${body.requestKind ?? "-"} ` +
      `workspace=${body.workspaceId ?? "-"} ` +
      `→ ${result.decision} (${result.reason})`
    );
    json(res, 200, result);
  },

  "POST /v1/store": async (body, res) => {
    const result = storeExact(body);
    await storeSemantic(body);
    console.log(
      `[store] kind=${body.query?.requestKind ?? "-"} ` +
      `latency=${body.latencyMs ?? "-"}ms`
    );
    json(res, 200, result);
  },

  "GET /v1/stats": (_body, res) => {
    json(res, 200, getStats());
  },
};

const server = http.createServer((req, res) => {
  // Only accept requests from localhost.
  const remoteAddr = req.socket.remoteAddress;
  if (remoteAddr !== "127.0.0.1" && remoteAddr !== "::1" && remoteAddr !== "::ffff:127.0.0.1") {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const key     = `${req.method} ${req.url}`;
    const handler = routes[key];

    if (!handler) {
      json(res, 404, { error: `No route: ${key}` });
      return;
    }

    let body = {};
    try {
      if (raw) body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }

    Promise.resolve(handler(body, res)).catch((err) => {
      console.error("[error]", err);
      json(res, 500, { error: "Internal server error" });
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`tokencut service running at http://127.0.0.1:${PORT}`);
  console.log("  GET  /health    → liveness check");
  console.log("  POST /v1/query  → exact cache lookup");
  console.log("  POST /v1/store  → store live answer");
  console.log("  GET  /v1/stats  → hit/miss counts");
});

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type":  "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
