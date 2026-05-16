import * as vscode from "vscode";
import * as crypto from "crypto";
import { collectEditorContext } from "../context/collect.js";
import { TokencutClient } from "../tokencut/client.js";
import { callCopilotModel } from "../copilot/model.js";
import type { QueryRequest } from "../tokencut/types.js";

export async function explainSelection(
  client: TokencutClient,
  forceFresh: boolean
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage("tokencut: No active editor.");
    return;
  }

  const ctx = collectEditorContext(editor);

  if (!ctx.selectionText) {
    vscode.window.showErrorMessage("tokencut: Select some code first.");
    return;
  }

  const query: QueryRequest = {
    requestId: crypto.randomUUID(),
    requestKind: "explain-selection",
    prompt: "Explain this selected code clearly and concisely.",
    workspaceId: ctx.workspaceId,
    activeFile: ctx.activeFile,
    selectionText: ctx.selectionText,
    selectionHash: ctx.selectionHash,
    languageId: ctx.languageId,
    gitRevision: ctx.gitRevision,
    modelId: "copilot",
    forceFresh,
  };

  const cancel = new vscode.CancellationTokenSource();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, cancellable: true, title: "tokencut" },
    async (progress, progressToken) => {
      progressToken.onCancellationRequested(() => cancel.cancel());

      const start = Date.now();

      let answer: string;
      let label: string;
      let usedModelId = query.modelId;

      if (!forceFresh) {
        progress.report({ message: "Checking cache…" });
        const decision = await client.query(query);

        if (decision.decision === "reused") {
          answer = decision.answer;
          label = `tokencut reused (${decision.reason}, ${Math.round(decision.confidence * 100)}% confidence)`;
          await showAnswer(label, answer);
          return;
        }
      }

      progress.report({ message: "Calling Copilot…" });
      const result = await callCopilotModel(
        {
          prompt: query.prompt,
          activeFile: query.activeFile,
          selectionText: query.selectionText,
          languageId: query.languageId,
        },
        cancel.token
      );

      answer = result.answer;
      usedModelId = result.modelId;
      label = "tokencut — live answer";

      await client.store({
        query,
        answer,
        modelId: usedModelId,
        latencyMs: Date.now() - start,
        source: "live",
      });

      await showAnswer(label, answer);
    }
  );

  cancel.dispose();
}

async function showAnswer(label: string, answer: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: `<!-- ${label} -->\n\n${answer}`,
    language: "markdown",
  });

  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}
