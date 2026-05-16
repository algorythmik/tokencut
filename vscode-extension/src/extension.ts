import * as vscode from "vscode";
import { TokencutClient } from "./tokencut/client.js";
import { explainSelection } from "./commands/explainSelection.js";
import { repoQuestion } from "./commands/repoQuestion.js";
import { registerChatParticipant } from "./chat/participant.js";
import { startService, stopService } from "./service/manager.js";

let client: TokencutClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Start the bundled service (no-op if something is already on port 8787).
  void startService(context);
  function getClient(): TokencutClient {
    const cfg = vscode.workspace.getConfiguration("tokencut");
    const serviceUrl = cfg.get<string>("serviceUrl", "http://127.0.0.1:8787");

    if (!client) {
      client = new TokencutClient(serviceUrl);
      void warnIfUnreachable(client);
    }

    return client;
  }

  registerChatParticipant(context, getClient);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tokencut.serviceUrl")) {
        client = undefined;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencut.explainSelection", async () => {
      const cfg = vscode.workspace.getConfiguration("tokencut");
      const forceFresh = cfg.get<boolean>("forceFresh", false);

      try {
        await explainSelection(getClient(), forceFresh);
      } catch (err) {
        handleError(err);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tokencut.repoQuestion", async () => {
      const cfg = vscode.workspace.getConfiguration("tokencut");
      const forceFresh = cfg.get<boolean>("forceFresh", false);

      try {
        await repoQuestion(getClient(), forceFresh);
      } catch (err) {
        handleError(err);
      }
    })
  );
}

export function deactivate(): void {
  stopService();
  client = undefined;
}

async function warnIfUnreachable(c: TokencutClient): Promise<void> {
  const reachable = await c.isReachable();

  if (!reachable) {
    vscode.window.showWarningMessage(
      "tokencut: Local service is not running. Start the tokencut service to enable caching.",
      "Dismiss"
    );
  }
}

function handleError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`tokencut: ${message}`);
}
