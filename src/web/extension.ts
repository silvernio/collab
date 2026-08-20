import * as vscode from 'vscode';
import { SidebarProvider } from './panel';

export function activate(context: vscode.ExtensionContext) {

    const provider = new SidebarProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "collabView",
            provider
        )
    );
  
    context.subscriptions.push(
        vscode.commands.registerCommand("collab.openItem", (item: string) => {
            vscode.window.showInformationMessage(`item: ${item}`);
        })
    );

	const disposable = vscode.commands.registerCommand('collab.helloWorld', () => {
		vscode.window.showInformationMessage('Hi!');
	});

	context.subscriptions.push(disposable);

    //

    context.subscriptions.push(
        vscode.commands.registerCommand('collab.addItem', () => {
            vscode.window.showInformationMessage('Add item');
        })
    );

    //

    //

    console.log('Collab started');
}

export function deactivate() {}
