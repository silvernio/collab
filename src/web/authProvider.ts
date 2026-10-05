import * as vscode from 'vscode';
import { CollabAuth } from './auth';

export const providerId = 'live-collab';

const AUTH_ORIGIN = 'https://auth.silverspace.io';
const TOKEN_KEY = 'live-collab.token';

const isWeb = () => vscode.env.uiKind === vscode.UIKind.Web;

interface LoginResponse { token: string; uuid: string; name: string }

// Mostly AI code

export class AuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private _onDidChangeSessions =
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private cookieExchange: Promise<vscode.AuthenticationSession | undefined> | undefined;

    constructor(private context: vscode.ExtensionContext, private auth: CollabAuth) {
        this.auth = auth;
    }

    async getSessions(): Promise<vscode.AuthenticationSession[]> {
        const raw = await this.context.secrets.get(TOKEN_KEY);
        if (raw) { return [JSON.parse(raw)]; }

        if (isWeb()) {
            const session = await this.sessionFromCookie();
            if (session) { return [session]; }
        }
        return [];
    };

    async createSession(): Promise<vscode.AuthenticationSession> {
        const session = isWeb() ? await this.createSessionWeb() : await this.createSessionDesktop();
        this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const [session] = await this.getSessions();
        if (!session || session.id !== sessionId) { return; }

        try {
            await fetch(`${AUTH_ORIGIN}/api/logout/`, {
                headers: { Authorization: `Bearer ${session.accessToken}` },
                credentials: isWeb() ? 'include' : 'omit',
            });
        } catch { }

        await this.context.secrets.delete(TOKEN_KEY);
        this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
    }

    dispose() {
        this._onDidChangeSessions.dispose();
    }

    private async createSessionDesktop(): Promise<vscode.AuthenticationSession> {
        const { code, verifier } = await this.auth.startAuth();

        const res = await fetch(`${AUTH_ORIGIN}/api/token/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transfer: code, verifier }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) { throw new Error(data.error ?? 'failed'); }

        const res2 = await fetch(`${AUTH_ORIGIN}/api/login`, {
            headers: { Authorization: `Bearer ${data.token}` }
        });

        const data2 = await res2.json().catch(() => ({}));
        if (!res2.ok || !data2.token) { throw new Error(data2.error ?? 'failed'); }

        return this.storeSession(data2);
    }

    private async createSessionWeb(): Promise<vscode.AuthenticationSession> {
        const existing = await this.sessionFromCookie();
        if (existing) { return existing; }

        await vscode.env.openExternal(vscode.Uri.parse(`${AUTH_ORIGIN}/`));

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Authenticating.. look at the new tab',
                cancellable: true,
            },
            (_progress, token) => new Promise<vscode.AuthenticationSession>((resolve, reject) => {
                const deadline = Date.now() + 1000 * 60 * 5;
                const tick = async () => {
                    if (token.isCancellationRequested) { return reject(new Error('cancelled')); }
                    if (Date.now() > deadline) { return reject(new Error('timed out')); }
                    const session = await this.sessionFromCookie();
                    if (session) { return resolve(session); }
                    setTimeout(tick, 2000);
                };
                tick();
            })
        );
    }

    private sessionFromCookie(): Promise<vscode.AuthenticationSession | undefined> {
        this.cookieExchange ??= (async () => {
            try {
                const res = await fetch(`${AUTH_ORIGIN}/api/newToken/`, { credentials: 'include' });
                if (!res.ok) { return undefined; }
                const data = await res.json().catch(() => ({}));
                if (!data.token) { return undefined; }
                return await this.storeSession(data);
            } catch {
                return undefined;
            } finally {
                this.cookieExchange = undefined;
            }
        })();
        return this.cookieExchange;
    }

    private async storeSession(data: LoginResponse): Promise<vscode.AuthenticationSession> {
        const session: vscode.AuthenticationSession = {
            id: data.uuid,
            accessToken: data.token,
            account: { id: data.uuid, label: data.name },
            scopes: [],
        };
        await this.context.secrets.store(TOKEN_KEY, JSON.stringify(session));
        return session;
    }
}