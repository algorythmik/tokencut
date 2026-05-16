import * as vscode from "vscode";
import * as crypto from "crypto";
import * as cp from "child_process";

export interface EditorContext {
  workspaceId?: string;
  activeFile?: string;
  selectionText?: string;
  selectionHash?: string;
  languageId?: string;
  gitRevision?: string;
}

export function collectEditorContext(
  editor: vscode.TextEditor
): EditorContext {
  const selectionText = editor.document.getText(editor.selection).trim();

  return {
    workspaceId: vscode.workspace.name,
    activeFile: editor.document.uri.fsPath,
    selectionText: selectionText || undefined,
    selectionHash: selectionText ? sha256(selectionText) : undefined,
    languageId: editor.document.languageId,
    gitRevision: getGitRevision(editor.document.uri),
  };
}

export function collectWorkspaceContext(): EditorContext {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const folder = workspaceFolders?.[0];

  return {
    workspaceId: vscode.workspace.name,
    gitRevision: folder
      ? getGitRevision(folder.uri)
      : undefined,
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getGitRevision(uri: vscode.Uri): string | undefined {
  try {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return undefined;
    }

    const result = cp.execSync("git rev-parse --short HEAD", {
      cwd: folder.uri.fsPath,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    return result.toString().trim();
  } catch {
    return undefined;
  }
}
