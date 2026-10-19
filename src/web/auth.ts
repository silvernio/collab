import * as vscode from "vscode";
import { randomString, sha256b64url } from "./utils";

// the pending auth flow
interface PendingAuth {
	resolve: (code: string) => void;
}

// allows vscode to open the auth website and receive messages back from it naturally
export class CollabAuth implements vscode.UriHandler {
	private pending = new Map<string, PendingAuth>(); // pending auth flows
	context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	// request and trigger an auth flow to login the user in the browser
	async startAuth() {
		const state = randomString();
		const verifier = randomString();
		const challenge = await sha256b64url(verifier);

		// create the url
		const cb = await vscode.env.asExternalUri(
			vscode.Uri.parse(
				`${vscode.env.uriScheme}://${this.context.extension.id}/auth`,
			),
		);

		// add the secrets for checking later on
		const url = new URL("/", "https://auth.silverspace.io");
		url.searchParams.set("cb", cb.toString());
		url.searchParams.set("state", state);
		url.searchParams.set("challenge", challenge);

		const codePromise = new Promise<string>((resolve) =>
			this.pending.set(state, { resolve }),
		);

		// open the auth website
		await vscode.env.openExternal(vscode.Uri.parse(url.toString()));

		try {
			// wait for the auth website to complete
			const code = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Authenticating... look at your browser",
					cancellable: true,
				},
				(_progress, token) =>
					new Promise<string>((resolve, reject) => {
						const timer = setTimeout(
							() => reject(new Error("timed out")),
							1000 * 60 * 5,
						);
						token.onCancellationRequested(() =>
							reject(new Error("cancelled")),
						);
						codePromise
							.then(resolve, reject)
							.finally(() => clearTimeout(timer));
					}),
			);
			return { code, verifier }; // return the auth data
		} finally {
			this.pending.delete(state);
		}
	}

	// runs when the user completes the auth website
	handleUri(uri: vscode.Uri) {
		if (!uri.path.startsWith("/auth")) {
			return;
		}

		// get data from url
		const q = new URLSearchParams(uri.query);
		const state = q.get("state");
		const code = q.get("code");
		const pending = state ? this.pending.get(state) : undefined;

		if (!pending || !code) {
			return;
		}

		if (state !== null) {
			this.pending.delete(state);
		}
		pending.resolve(code); // pass the url data back
	}
}
