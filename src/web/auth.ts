import * as vscode from 'vscode';

// AI code
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) { s += String.fromCharCode(b); }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(byteLength = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}
//

interface PendingAuth {
  resolve: (code: string) => void;
}

export class CollabAuth implements vscode.UriHandler {
    private pending = new Map<string, PendingAuth>();
    context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async startAuth() {
        const state = randomString();
        const verifier = randomString();
        const challenge = await sha256b64url(verifier);

        const cb = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${this.context.extension.id}/auth`));

        const url = new URL('/', "https://auth.silverspace.io");
        url.searchParams.set('cb', cb.toString());
        url.searchParams.set('state', state);
        url.searchParams.set('challenge', challenge);

        const codePromise = new Promise<string>((resolve) => this.pending.set(state, { resolve }));

        await vscode.env.openExternal(vscode.Uri.parse(url.toString()));

        if (this.context.extensionMode === vscode.ExtensionMode.Development && false) { this.manualCallback(); }

        try {
            const code = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Authenticating... look at your browser",
                    cancellable: true
                },
                (_progress, token) => new Promise<string>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('timed out')), 1000 * 60 * 5);
                    token.onCancellationRequested(() => reject(new Error('cancelled')));
                    codePromise.then(resolve, reject).finally(() => clearTimeout(timer));
                })
            );
            return {code, verifier};
        } finally {
            this.pending.delete(state);
        }
    }

    handleUri(uri: vscode.Uri) {
        if (!uri.path.startsWith('/auth')) { return; }

        const q = new URLSearchParams(uri.query);
        const state = q.get('state');
        const code = q.get('code');
        const pending = state ? this.pending.get(state) : undefined;

        if (!pending || !code) {
            return;
        }

        if (state !== null) { this.pending.delete(state); }
        pending.resolve(code);
    }

    async manualCallback() {
        const uri = await vscode.window.showInputBox({
            title: 'manual callback',
            prompt: 'link:',
            placeHolder: 'link',
            ignoreFocusOut: true,
        });
        if (uri) { this.handleUri(vscode.Uri.parse(uri.trim())); }
    }
}
