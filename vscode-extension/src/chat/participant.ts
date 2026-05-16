import * as vscode from "vscode";
import * as crypto from "crypto";
import { collectEditorContext, collectWorkspaceContext } from "../context/collect.js";
import { TokencutClient } from "../tokencut/client.js";
import { callCopilotModel } from "../copilot/model.js";
import type { QueryRequest, RequestKind } from "../tokencut/types.js";

const PARTICIPANT_ID = "tokencut.assistant";

type Intent = {
  requestKind: RequestKind;
  prompt: string;
};

function detectIntent(userMessage: string): Intent {
  const lower = userMessage.toLowerCase();

  if (
    lower.includes("build") ||
    lower.includes("run") ||
    lower.includes("test") ||
    lower.includes("start") ||
    lower.includes("install") ||
    lower.includes("how do i")
  ) {
    return {
      requestKind: "repo-question",
      prompt: userMessage,
    };
  }

  if (
    lower.includes("summarize") ||
    lower.includes("summary") ||
    lower.includes("overview") ||
    lower.includes("what does this file")
  ) {
    return {
      requestKind: "summarize-file",
      prompt: userMessage,
    };
  }

  return {
    requestKind: "explain-selection",
    prompt: userMessage,
  };
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  getClient: () => TokencutClient
): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (
      request: vscode.ChatRequest,
      _chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const cfg = vscode.workspace.getConfiguration("tokencut");
      const forceFresh = cfg.get<boolean>("forceFresh", false);

      const editor = vscode.window.activeTextEditor;
      const editorCtx = editor
        ? collectEditorContext(editor)
        : collectWorkspaceContext();

      const { requestKind, prompt } = detectIntent(request.prompt);

      const query: QueryRequest = {
        requestId: crypto.randomUUID(),
        requestKind,
        prompt,
        workspaceId: editorCtx.workspaceId,
        activeFile: editorCtx.activeFile,
        selectionText: editorCtx.selectionText,
        selectionHash: editorCtx.selectionHash,
        languageId: editorCtx.languageId,
        gitRevision: editorCtx.gitRevision,
        modelId: "copilot",
        forceFresh,
      };

      if (!forceFresh) {
        let decision;
        try {
          decision = await getClient().query(query);
        } catch {
          // service unreachable — fall through to live model
        }

        if (decision?.decision === "reused") {
          const label =
            decision.reason === "exact_match"
              ? "exact match"
              : `semantic match · ${Math.round(decision.confidence * 100)}% confidence`;

          stream.markdown(decision.answer);
          stream.markdown(`\n\n---\n*tokencut reused a prior answer (${label})*`);
          return;
        }
      }

      const start = Date.now();

      try {
        const result = await callCopilotModel(
          {
            prompt: query.prompt,
            activeFile: query.activeFile,
            selectionText: query.selectionText,
            languageId: query.languageId,
          },
          token
        );

        stream.markdown(result.answer);

        try {
          await getClient().store({
            query,
            answer: result.answer,
            modelId: result.modelId,
            latencyMs: Date.now() - start,
            source: "live",
          });
        } catch {
          // store failure is non-fatal
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stream.markdown(`**tokencut error:** ${message}`);
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon("zap");

  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      return [
        {
          prompt: "how do I build, test, and run this repo?",
          label: "How do I build / test / run?",
          command: undefined,
        },
      ];
    },
  };

  context.subscriptions.push(participant);
}
