import * as vscode from "vscode";
import * as crypto from "crypto";
import { collectWorkspaceContext } from "../context/collect.js";
import { TokencutClient } from "../tokencut/client.js";
import { callCopilotModel } from "../copilot/model.js";
import type { QueryRequest } from "../tokencut/types.js";

const REPO_QUESTION_PROMPT =
  "What are the commands to build, test, and run this project? Be concise and specific.";

export async function repoQuestion(
  client: TokencutClient,
  forceFresh: boolean
): Promise<void> {
  const ctx = collectWorkspaceContext();

  if (!ctx.workspaceId) {
    vscode.window.showErrorMessage("tokencut: No workspace is open.");
    return;
  }

  const query: QueryRequest = {
    requestId: crypto.randomUUID(),
    requestKind: "repo-question",
    prompt: REPO_QUESTION_PROMPT,
    workspaceId: ctx.workspaceId,
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
        { prompt: query.prompt },
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
