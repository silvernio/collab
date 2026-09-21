import * as vscode from 'vscode';
import { CollabAuth } from './auth';

export const providerId = 'live-collab';

// Mostly AI code

export class AuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private _onDidChangeSessions =
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    constructor(private context: vscode.ExtensionContext, private auth: CollabAuth) {
        this.auth = auth;
    }

    async getSessions(): Promise<vscode.AuthenticationSession[]> {
        const raw = await this.context.secrets.get("live-collab.token");
        return raw ? [JSON.parse(raw)] : [];
    };

    async createSession(): Promise<vscode.AuthenticationSession> {
        const { code, verifier } = await this.auth.startAuth();

        const res = await fetch(`https://auth.silverspace.io/api/token/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transfer: code, verifier }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) { throw new Error(data.error ?? 'failed'); }

        const res2 = await fetch("https://auth.silverspace.io/api/login", {
            headers: { Authorization: `Bearer ${data.token}` }
        });

        const data2 = await res2.json().catch(() => {});
        if (!res2.ok || !data2.token) { throw new Error(data.error ?? 'failed'); }

        const session: vscode.AuthenticationSession = {
            id: data2.uuid,
            accessToken: data2.token,
            account: { id: data2.uuid, label: data2.name },
            scopes: [],
        };

        await this.context.secrets.store("live-collab.token", JSON.stringify(session));
        this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const [session] = await this.getSessions();
        if (!session || session.id !== sessionId) { return; }

        try {
            await fetch(`https://auth.silverspace.io/api/logout/`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.accessToken}` },
            });
        } catch { }

        await this.context.secrets.delete("live-collab.token");
        this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
    }

    dispose() {
        this._onDidChangeSessions.dispose();
    }
}