import * as vscode from 'vscode';
import * as fs from 'fs';

// import htmlContent from './sidebar/index.html';

export class SidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    public msgCallbacks: ((msg: any) => void)[];

    constructor(private readonly extensionUri: vscode.Uri) {
        this.msgCallbacks = [];
    }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.getHtml(webviewView.webview).then((html) => {
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

    // private getHtml(webview: vscode.Webview): string {
    //     return `
    //     hi
    //     <button>test</button>`;
    // }
    private async getHtml(webview: vscode.Webview): Promise<string> {
        const sidebarDir = vscode.Uri.joinPath(this.extensionUri, 'sidebar');
        const htmlUri = vscode.Uri.joinPath(sidebarDir, 'index.html');

        const bytes = await vscode.workspace.fs.readFile(htmlUri);
        let html = new TextDecoder().decode(bytes);

        const baseUri = webview.asWebviewUri(sidebarDir);
        html = html.replace(/(src|href)="\.\/(.+?)"/g, (_, attr, path) =>
            `${attr}="${baseUri}/${path}"`
        );

        return html;
    }
}

