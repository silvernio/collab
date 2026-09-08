import * as vscode from 'vscode';
import * as path from 'path';

///////////////////
// AI code
export function getRelativePath(uri: vscode.Uri): string | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return undefined;
    }

    return relative(workspaceFolder.uri.fsPath, uri.fsPath);
}

export function getRelativePathUri(uri: vscode.Uri): string | undefined {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return undefined;
    }

    // Get the relative path from the workspace root
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return relativePath;
}

function relative(from: string, to: string): string {
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);

  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++;
  }

  const upCount = fromParts.length - i;
  const downParts = toParts.slice(i);

  return [...Array(upCount).fill('..'), ...downParts].join('/');
}
///////////////////