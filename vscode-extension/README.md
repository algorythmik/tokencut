# tokencut

**tokencut** is a local-first caching layer for GitHub Copilot in VS Code. It detects when you (or an agent) ask the same or a semantically similar question and serves the cached answer instantly — saving tokens, reducing latency, and keeping responses consistent.

> All data stays on your machine. Nothing is sent to any external service.

---

## How it works

1. You ask `@tokencut` a question in Copilot Chat.
2. tokencut checks its local cache:
   - **Exact match** — identical (normalised) prompt → instant answer.
   - **Semantic match** — similar meaning detected via a local `all-MiniLM-L6-v2` embedding model → cached answer returned with a confidence score.
   - **Miss** — falls through to the live Copilot model and stores the answer for next time.
3. Every cache hit is logged so you can track token savings over time.

---

## Requirements

- **VS Code** 1.90 or later
- **GitHub Copilot** extension installed and signed in
- **Node.js** 22 or later (needed to run the bundled service)

---

## Installation

### From the Marketplace _(once published)_

Search for **tokencut** in the VS Code Extensions panel and click **Install**. The bundled service starts automatically.

### From source

```sh
git clone https://github.com/algorythmik/tokencut
cd tokencut/vscode-extension
npm install
npm run vscode:prepublish   # compiles TS + bundles the service
vsce package                # produces tokencut-x.y.z.vsix
code --install-extension tokencut-*.vsix
```

---

## Usage

### Chat participant

Open Copilot Chat and type:

```
@tokencut how do I run the tests?
```

Once you invoke `@tokencut` once in a conversation it stays selected — you don't need to type `@tokencut` again for follow-up messages.

Press `Cmd+Shift+/` (Mac) or `Ctrl+Shift+/` (Windows/Linux) to open the chat panel with `@tokencut` pre-filled.

### Editor commands

| Command | What it does |
|---|---|
| `tokencut: Explain Selection` | Explains the currently selected code, with semantic reuse across identical or near-identical selections |
| `tokencut: How Do I Build / Test / Run This Repo?` | Answers common repo-specific questions, cached per workspace |

Access them via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `tokencut.serviceUrl` | `http://127.0.0.1:8787` | URL of the local tokencut service. Change only if you run the service manually on a different port. |
| `tokencut.forceFresh` | `false` | When `true`, always calls the live model and skips the cache. Useful for debugging. |

---

## Token savings

tokencut estimates tokens saved using the rule of thumb **1 token ≈ 4 characters**. Each cached answer multiplied by how many times it was reused gives the estimate.

Check your live savings in the status bar at the bottom-right of VS Code:

```
⊙  1,234 tokens saved
```

Click it to see the full breakdown and write a timestamped snapshot to `~/.tokencut/stats.jsonl`.

Analyse snapshots over time:

```sh
cat ~/.tokencut/stats.jsonl | jq -r '[.timestamp, .estimatedTokensSaved, .totalHits] | @csv'
```

---

## Cache details

| Request type | Cache TTL | Notes |
|---|---|---|
| Repo question | 7 days | Scoped to workspace |
| Explain selection | 30 days | Keyed to selected code content |
| Summarize file | 1 day | Short TTL — file content changes often |

The cache is a local SQLite database at `vscode-extension/service/data/tokencut.db`. Delete it at any time to start fresh.

---

## Running the service manually

The service starts automatically with VS Code. If you want to run it separately (e.g. for development):

```sh
cd service
npm start
```

It listens on `127.0.0.1:8787` and only accepts connections from localhost.

**Available endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/v1/query` | Look up a cached answer |
| `POST` | `/v1/store` | Store a new answer |
| `GET` | `/v1/stats` | Hit/miss counts and token savings |
| `POST` | `/v1/stats/snapshot` | Write a snapshot to `~/.tokencut/stats.jsonl` |

---

## Privacy

- Every prompt and answer is stored **locally only** in a SQLite file on your machine.
- The service binds to `127.0.0.1` and rejects all non-localhost requests.
- The embedding model (`all-MiniLM-L6-v2`, ~23 MB) is downloaded once to `~/.cache/huggingface/` and runs entirely offline after that.
- Nothing is sent to any remote server by tokencut.

---
## License

MIT
