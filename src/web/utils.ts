import * as vscode from "vscode";

import { WebsocketProvider } from "y-websocket";

// given a yjs websocket provider, wait for it to connect, using promises
export function waitSync(provider: WebsocketProvider): Promise<void> {
	return new Promise((resolve) => {
		// if it's connected, just return early
		if (provider.synced) {
			return resolve();
		}
		// a little function that resolves the promise on the sync event, which runs when it connects
		const handler = (synced: boolean) => {
			if (!synced) {
				return;
			}
			provider.off("sync", handler);
			resolve();
		};
		// links the function to the sync event
		provider.on("sync", handler);
	});
}

// given the room / project name, the host id, and project id if it exists, return a url that will open it in the browser
export function inviteLink(
	name: string,
	hid: string,
	projectId: string | null,
) {
	// initially, just put the host id in the url params
	const params = new URLSearchParams({ hid });
	// if there is a project id, put it in there too
	if (projectId !== null) {
		params.set("pid", String(projectId));
	}

	// put the room / project name in the url
	const folder = `collab://${encodeURIComponent(name.toLowerCase())}/${encodeURIComponent(name)}?${params}`;
	// put it on the end of the live domain
	return `https://collab.silverspace.io/?folder=${encodeURIComponent(folder)}`;
}

// the rest of this file is ai code that handles path conversions and editor specific line endings / positions
// path conversions (with the vscode api), and behaviour of the vscode editor is quite specific knowledge
// ai works well for this case

export function getRelativePath(uri: vscode.Uri): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		return undefined;
	}
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
	const fromParts = from.split("/").filter(Boolean);
	const toParts = to.split("/").filter(Boolean);

	let i = 0;
	while (
		i < fromParts.length &&
		i < toParts.length &&
		fromParts[i] === toParts[i]
	) {
		i++;
	}

	const upCount = fromParts.length - i;
	const downParts = toParts.slice(i);

	return [...Array(upCount).fill(".."), ...downParts].join("/");
}

export function toLf(text: string) {
	return text.replace(/\r\n?/g, "\n");
}

export function positionIn(text: string, offset: number) {
	let line = 0;
	let lineStart = 0;
	for (
		let i = text.indexOf("\n");
		i !== -1 && i < offset;
		i = text.indexOf("\n", i + 1)
	) {
		line++;
		lineStart = i + 1;
	}
	return new vscode.Position(line, offset - lineStart);
}

function b64url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) {
		s += String.fromCharCode(b);
	}
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomString(byteLength = 32): string {
	return b64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
export async function sha256b64url(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return b64url(new Uint8Array(digest));
}
