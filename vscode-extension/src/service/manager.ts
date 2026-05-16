import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";

const PORT = 8787;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

let proc: cp.ChildProcess | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/** Start the bundled service if it isn't already running externally. */
export async function startService(context: vscode.ExtensionContext): Promise<void> {
  // If something is already listening on the port, don't spawn a second copy.
  if (await isPortListening()) {
    return;
  }

  outputChannel = vscode.window.createOutputChannel("tokencut service");
  context.subscriptions.push(outputChannel);

  const serviceDir = path.join(context.extensionPath, "service");
  const serverScript = path.join(serviceDir, "server.mjs");

  if (!fs.existsSync(serverScript)) {
    vscode.window.showErrorMessage(
      "tokencut: Bundled service not found. Re-install the extension."
    );
    return;
  }

  // Use the node binary that ships with VS Code's electron runtime so we don't
  // depend on a user-installed node.
  const nodeBin = process.execPath;

  proc = cp.spawn(
    nodeBin,
    ["--experimental-sqlite", serverScript],
    {
      cwd:   serviceDir,
      env:   { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  proc.stdout?.on("data", (d: Buffer) => outputChannel?.append(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => outputChannel?.append(d.toString()));

  proc.on("exit", (code, signal) => {
    outputChannel?.appendLine(`[tokencut service exited: code=${code} signal=${signal}]`);
    proc = undefined;
  });

  // Wait until /health responds or timeout.
  const ready = await waitForReady();
  if (!ready) {
    vscode.window.showWarningMessage(
      "tokencut: Service did not start within 30 s. Caching will be unavailable.",
      "Show Logs"
    ).then((choice) => {
      if (choice === "Show Logs") outputChannel?.show();
    });
  }
}

/** Stop the service process we spawned (called from deactivate). */
export function stopService(): void {
  if (proc) {
    proc.kill();
    proc = undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isPortListening(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function waitForReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    const check = async () => {
      if (await isPortListening()) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };

    check();
  });
}
