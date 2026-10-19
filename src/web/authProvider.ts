import * as vscode from "vscode";
import { CollabAuth } from "./auth";

export const providerId = "live-collab";

const AUTH_ORIGIN = "https://auth.silverspace.io"; // the public auth website
const TOKEN_KEY = "live-collab.token"; // the key used for the session token

const isWeb = () => vscode.env.uiKind === vscode.UIKind.Web; // whether the extension is running in the web browser

// the data received back from auth
interface LoginResponse {
	token: string;
	uuid: string;
	name: string;
}

// integrates the account system with vscode
export class AuthProvider
	implements vscode.AuthenticationProvider, vscode.Disposable
{
	// other parts of the code can trigger code when the user logs in or out
	private _onDidChangeSessions =
		new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	// the current auth flow
	private cookieExchange:
		Promise<vscode.AuthenticationSession | undefined> | undefined;

	// use the auth website handler
	constructor(
		private context: vscode.ExtensionContext,
		private auth: CollabAuth,
	) {
		this.auth = auth;
	}

	// get the current auth session
	async getSessions(): Promise<vscode.AuthenticationSession[]> {
		const raw = await this.context.secrets.get(TOKEN_KEY); // get the login token
		if (raw) {
			return [JSON.parse(raw)];
		}

		// if in the web browser
		if (isWeb()) {
			const session = await this.sessionFromCookie(); // extract the session from the token cookie
			if (session) {
				return [session];
			}
		}
		return [];
	}

	// trigger a login flow
	async createSession(): Promise<vscode.AuthenticationSession> {
		const session = isWeb()
			? await this.createSessionWeb()
			: await this.createSessionDesktop();
		this._onDidChangeSessions.fire({
			added: [session],
			removed: [],
			changed: [],
		});
		return session;
	}

	// logout the user, remove it's session
	async removeSession(sessionId: string): Promise<void> {
		const [session] = await this.getSessions(); // get the current session
		if (!session || session.id !== sessionId) {
			return;
		}

		try {
			await fetch(`${AUTH_ORIGIN}/api/logout/`, {
				// remove the session on the server and in browser
				headers: { Authorization: `Bearer ${session.accessToken}` },
				credentials: isWeb() ? "include" : "omit",
			});
		} catch {}

		await this.context.secrets.delete(TOKEN_KEY); // remove the token from secret storage
		this._onDidChangeSessions.fire({
			added: [],
			removed: [session],
			changed: [],
		});
	}

	dispose() {
		this._onDidChangeSessions.dispose();
	}

	// on desktop, use the web auth provider, which open the website in the browser, and receives the token back
	private async createSessionDesktop(): Promise<vscode.AuthenticationSession> {
		const { code, verifier } = await this.auth.startAuth(); // get the transfer token

		// exchange it for a session token
		const res = await fetch(`${AUTH_ORIGIN}/api/token/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ transfer: code, verifier }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.token) {
			throw new Error(data.error ?? "failed");
		}

		// login with the session token
		const res2 = await fetch(`${AUTH_ORIGIN}/api/login`, {
			headers: { Authorization: `Bearer ${data.token}` },
		});

		const data2 = await res2.json().catch(() => ({}));
		if (!res2.ok || !data2.token) {
			throw new Error(data2.error ?? "failed");
		}

		// save the session token
		return this.storeSession(data2);
	}

	// in the web browser, just open the auth website, and it'll save its session token as a cookie
	private async createSessionWeb(): Promise<vscode.AuthenticationSession> {
		const existing = await this.sessionFromCookie();
		if (existing) {
			return existing;
		}

		// open the auth webstie
		await vscode.env.openExternal(vscode.Uri.parse(`${AUTH_ORIGIN}/`));

		// wait for the auth website to complete
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Authenticating.. look at the new tab",
				cancellable: true,
			},
			(_progress, token) =>
				new Promise<vscode.AuthenticationSession>((resolve, reject) => {
					const deadline = Date.now() + 1000 * 60 * 5;
					const tick = async () => {
						if (token.isCancellationRequested) {
							return reject(new Error("cancelled"));
						}
						if (Date.now() > deadline) {
							return reject(new Error("timed out"));
						}
						const session = await this.sessionFromCookie(); // update the session
						if (session) {
							return resolve(session);
						}
						setTimeout(tick, 2000);
					};
					tick();
				}),
		);
	}

	// given a token, generate a new one
	private sessionFromCookie(): Promise<
		vscode.AuthenticationSession | undefined
	> {
		this.cookieExchange ??= (async () => {
			try {
				// use the auth api
				const res = await fetch(`${AUTH_ORIGIN}/api/newToken/`, {
					credentials: "include",
				});
				if (!res.ok) {
					return undefined;
				}
				const data = await res.json().catch(() => ({}));
				if (!data.token) {
					return undefined;
				}
				return await this.storeSession(data); // store the new token
			} catch {
				return undefined;
			} finally {
				this.cookieExchange = undefined;
			}
		})();
		return this.cookieExchange;
	}

	// store a token and its account data
	private async storeSession(
		data: LoginResponse,
	): Promise<vscode.AuthenticationSession> {
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
