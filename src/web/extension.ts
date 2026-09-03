import * as vscode from 'vscode';
import { SidebarProvider } from './panel';
import { io, Socket } from 'socket.io-client';

let socket: Socket;

let hostSocket: Socket;

export function activate(context: vscode.ExtensionContext) {
    socket = io("https://server.silverspace.io", { path: "/collab/socket.io" });

    socket.on("connect", () => {
        console.log("connected!");
        vscode.window.showInformationMessage("connected!!!");
    });

    context.subscriptions.push({
        dispose: () => socket.disconnect(),
    });

    const provider = new SidebarProvider(context.extensionUri);

    provider.msgCallbacks.push(async (msg) => {
        if (msg.hosts) {
            socket.emit("hosts", (hosts: { id: number, name: string, url: string }[]) => {
                provider.postMsg({ hosts });
            });
        }

        if (msg.selectHost) {
            hostSocket = io(msg.selectHost, { path: "/socket.io" });

            hostSocket.on("connect", () => {
                vscode.window.showInformationMessage(`connected to host!: ${msg.selectHost}`);

                hostSocket.emit("projects", (projects: any[]) => {
                    vscode.window.showInformationMessage(`all projects: ${JSON.stringify(projects)}`);
                    provider.postMsg({projects});
                });
            });
        }

        if (msg.newProject) {
            vscode.window.showInformationMessage(`you want a new project!`);

            const path = await vscode.window.showInputBox({
                prompt: "Where's the project gonna be?",
                placeHolder: "path",
            });

            const name = await vscode.window.showInputBox({
                prompt: "What's the project name?",
                placeHolder: "name",
            });

            if (path !== undefined || name !== undefined) {
                if (hostSocket) {
                    hostSocket.emit("newProject", "", path, name, (id: number) => {
                        vscode.window.showInformationMessage(`new project! ${id}`);
                    });
                }
            }
        }
    });

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

export function deactivate() { }
