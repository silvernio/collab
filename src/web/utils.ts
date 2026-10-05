import * as vscode from 'vscode';

import { WebsocketProvider } from 'y-websocket';

export interface User {
    name: string,
    colour: string,
    clientId: string
}

export function waitSync(provider: WebsocketProvider): Promise<void> {
    return new Promise((resolve) => {
        if (provider.synced) { return resolve(); }
        const handler = (synced: boolean) => {
            if (!synced) { return; }
            provider.off('sync', handler);
            resolve();
        };
        provider.on('sync', handler);
    });
}

const letters = "0123456789".split("");

export function genId(n: number) {
    let id = "";
    for (let i = 0; i < n; i++) {
        id += letters[Math.floor(Math.random() * letters.length)];
    }
    return id;
}

export function inviteLink(name: string, hostId: number, host: string, yjsHost: string, projectId: number | null) {
    const params = new URLSearchParams({ id: String(hostId), host, yjs_host: yjsHost });
    if (projectId !== null) { params.set('project_id', String(projectId)); }

    const folder = `collab://${encodeURIComponent(name.toLowerCase())}/${encodeURIComponent(name)}?${params}`;
    return `https://collab.silverspace.io/?folder=${encodeURIComponent(folder)}`;
}

///////////////////
// AI code
export function getRelativePath(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) { return undefined; }
    return relative(folder.uri.path, uri.path);
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