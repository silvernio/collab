import * as vscode from 'vscode';

// import htmlContent from './sidebar/index.html';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    public msgCallbacks: ((msg: any) => void)[];

    constructor(private readonly extensionUri: vscode.Uri) {
        this.msgCallbacks = [];
    }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        // vscode.window.showInformationMessage("opened sidebar");

        const sessionId = Math.random().toString(36);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.getHtml(webviewView.webview, sessionId).then((html) => {
            webviewView.webview.html = html;
        });
        webviewView.webview.onDidReceiveMessage((msg) => {
            for (const callback of this.msgCallbacks) {
                callback(msg);
            }
        });
    }

    public postMsg(msg: any) {
        if (this._view) {
            this._view.webview.postMessage(msg);
        }
    }

    private async getHtml(webview: vscode.Webview, sessionId: string): Promise<string> {
        const sidebarDir = vscode.Uri.joinPath(this.extensionUri, 'sidebar/dist');
        const htmlUri = vscode.Uri.joinPath(sidebarDir, 'index.html');

        const bytes = await vscode.workspace.fs.readFile(htmlUri);
        let html = new TextDecoder().decode(bytes);

        const baseUri = webview.asWebviewUri(sidebarDir);
        html = html.replace(/(src|href)="([^"]+)"/g, (match, attr, assetPath) => {
            if (/^([a-z-]+:)?\/\//i.test(assetPath) || assetPath.startsWith('data:')) {
                return match;
            }
            const cleanPath = assetPath.replace(/^\.?\//, '');
            return `${attr}="${baseUri}/${cleanPath}"`;
        });

        const injectedScript = `<script>window.__SESSION_ID__ = ${JSON.stringify(sessionId)};</script>`;
        html = html.replace('<head>', `<head>\n    ${injectedScript}`);

        return html;
    }
}

