import * as vscode from 'vscode';
import * as fs from 'fs';

// import htmlContent from './sidebar/index.html';

export class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly extensionUri: vscode.Uri) {}

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.getHtml(webviewView.webview).then((html) => {
            webviewView.webview.html = html; 
        });
        webviewView.webview.onDidReceiveMessage((message) => {
            console.log(message);
        });
    }

    // private getHtml(webview: vscode.Webview): string {
    //     return `
    //     hi
    //     <button>test</button>`;
    // }
    private async getHtml(webview: vscode.Webview): Promise<string> {
       const sidebarDir = vscode.Uri.joinPath(this.extensionUri, 'sidebar');
    const htmlUri = vscode.Uri.joinPath(sidebarDir, 'index.html');

    // read the file via the VS Code FS API (works on desktop AND web)
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    let html = new TextDecoder().decode(bytes);

    // rewrite relative asset paths to webview-safe URIs
    const baseUri = webview.asWebviewUri(sidebarDir);
    html = html.replace(/(src|href)="\.\/(.+?)"/g, (_, attr, path) =>
      `${attr}="${baseUri}/${path}"`
    );

    return html;
}
}

