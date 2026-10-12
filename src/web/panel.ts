import * as vscode from "vscode";

export class SidebarProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;

	// this stores the list of functions to run when the sidebar is ready
	public msgCallbacks: ((msg: any) => void)[];

	constructor(private readonly extensionUri: vscode.Uri) {
		this.msgCallbacks = []; // initially, no callbacks are registered
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): Thenable<void> | void {
		this._view = webviewView;

		// this is used to let the sidebar know which session it is in, for storing state like current rooms & projects
		const sessionId = Math.random().toString(36);

		// get the html for the webview
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		this.getHtml(webviewView.webview, sessionId).then((html) => {
			webviewView.webview.html = html;
		});

		// when it receives a message from the sidebar, it broadcasts it along it's callbacks
		webviewView.webview.onDidReceiveMessage((msg) => {
			for (const callback of this.msgCallbacks) {
				callback(msg);
			}
		});
	}

	// given some data, send it to the sidebar
	public postMsg(msg: any) {
		if (this._view) {
			this._view.webview.postMessage(msg);
		}
	}

	// take the webview, and session id, and get the html page for the sidebar
	private async getHtml(
		webview: vscode.Webview,
		sessionId: string,
	): Promise<string> {
		// first, find the location of the sidebar html
		const sidebarDir = vscode.Uri.joinPath(
			this.extensionUri,
			"sidebar/dist",
		);
		const htmlUri = vscode.Uri.joinPath(sidebarDir, "index.html");

		// read it's contents
		const bytes = await vscode.workspace.fs.readFile(htmlUri);
		let html = new TextDecoder().decode(bytes);

		// format script / asset paths
		const baseUri = webview.asWebviewUri(sidebarDir);
		html = html.replace(
			/(src|href)="([^"]+)"/g,
			(match, attr, assetPath) => {
				if (
					/^([a-z-]+:)?\/\//i.test(assetPath) ||
					assetPath.startsWith("data:")
				) {
					return match;
				}
				const cleanPath = assetPath.replace(/^\.?\//, "");
				return `${attr}="${baseUri}/${cleanPath}"`;
			},
		);

		// add the session id into the script, so the sidebar knows what session it is when it loads
		const injectedScript = `<script>window.__SESSION_ID__ = ${JSON.stringify(sessionId)};</script>`;
		html = html.replace("<head>", `<head>\n    ${injectedScript}`);

		// return it
		return html;
	}
}
