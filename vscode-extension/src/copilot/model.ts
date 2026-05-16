import * as vscode from "vscode";

export interface CopilotCallOptions {
  prompt: string;
  activeFile?: string;
  selectionText?: string;
  languageId?: string;
}

export async function callCopilotModel(
  options: CopilotCallOptions,
  token: vscode.CancellationToken
): Promise<{ answer: string; modelId: string }> {
  const models = await vscode.lm.selectChatModels({ vendor: "copilot" });

  if (!models.length) {
    throw new Error(
      "No Copilot-backed model is available. Ensure GitHub Copilot is installed and you are signed in."
    );
  }

  const model = models[0];

  const contextLines: string[] = [options.prompt];

  if (options.languageId) {
    contextLines.push("", `Language: ${options.languageId}`);
  }

  if (options.activeFile) {
    contextLines.push(`File: ${options.activeFile}`);
  }

  if (options.selectionText) {
    contextLines.push("", "Selected code:", options.selectionText);
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(contextLines.join("\n")),
  ];

  const chatResponse = await model.sendRequest(messages, {}, token);

  let answer = "";
  for await (const part of chatResponse.text) {
    answer += part;
  }

  return { answer, modelId: model.id };
}
