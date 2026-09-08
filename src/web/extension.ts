import * as vscode from 'vscode';
import { SidebarProvider } from './panel';
import { io, Socket } from 'socket.io-client';
import { CollabFs } from './files';
import { createDirectory, deleteFile, getAbsoluteUri, getFileStats, readDirectory, readFile, renameFile, writeFile } from './host';
import { getRelativePath } from './utils';

let socket: Socket;

let hostSocket: Socket;
let chost: string | null = null;
let croom: string | null = null;
let isHost = false;

let collabFs: CollabFs | null = null;

export const FILE_SYSTEM_SCHEME = 'collab';

export function activate(context: vscode.ExtensionContext) {
    socket = io("https://server.silverspace.io", { path: "/collab/socket.io" });

    socket.on("connect", () => {
        // console.log("connected!");
        // vscode.window.showInformationMessage("connected!!!");
    });

    collabFs = new CollabFs();

    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('collab', collabFs, {
            isCaseSensitive: true,
        })
    );

    context.subscriptions.push({
        dispose: () => socket.disconnect(),
    });

    const provider = new SidebarProvider(context.extensionUri);

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme === 'collab') {
        const params = new URLSearchParams(folder.uri.query);
        const whost = params.get('host');
        const room = decodeURIComponent(folder.uri.authority);

        if (whost !== null) {
            selectHost(context, provider, whost, room);
        }
    }

    provider.msgCallbacks.push(async (msg) => {
        if (msg.ready) {
            if (chost !== null && croom !== null) {
                provider.postMsg({ state: { host: chost, room: croom, page: "rooms" } });
            }
        }

        if (msg.hosts) {
            socket.emit("hosts", (hosts: { id: number, name: string, url: string }[]) => {
                provider.postMsg({ hosts });
            });
        }

        if (msg.rooms && hostSocket) {
            hostSocket.emit("rooms", (rooms: string[]) => {
                provider.postMsg({ rooms });
            });
        }

        if (msg.joinRoom && hostSocket) {
            context.globalState.update("host", chost);
            context.globalState.update("room", msg.joinRoom);
            const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(msg.joinRoom)}/${encodeURIComponent(msg.joinRoom)}`).with({ query: new URLSearchParams({ host: chost ?? "" }).toString() });
            vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
        }

        if (msg.selectHost) {
            selectHost(context, provider, msg.selectHost);
            // chost = msg.selectHost;

            // hostSocket = io(msg.selectHost, { path: "/socket.io" });

            // hostSocket.on("connect", () => {
            //     vscode.window.showInformationMessage(`connected to host!: ${msg.selectHost}`);

            //     provider.postMsg({ hostConnected: true });

            //     hostSocket.emit("projects", (projects: any[]) => {
            //         vscode.window.showInformationMessage(`all projects: ${JSON.stringify(projects)}`);
            //         provider.postMsg({ projects });
            //     });
            // });
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

        if (msg.newRoom) {
            vscode.window.showInformationMessage(`you want a new room!`);

            const name = await vscode.window.showInputBox({
                prompt: "What's the name of the room?",
                placeHolder: "name",
            });

            if (name !== undefined) {
                // context.globalState.update("host", chost);
                // context.globalState.update("room", name);
                // const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://collab/${name}/`);
                // vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
                if (hostSocket) {
                    hostSocket.emit("newRoom", name, (success: boolean) => {
                        vscode.window.showInformationMessage(`new room! ${success}`);
                        croom = name;
                        provider.postMsg({ newRoom: name });
                        isHost = true;
                    });
                }
            }
        }

        if (msg.leaveRoom && hostSocket) {
            hostSocket.emit("leaveRoom", () => {
                provider.postMsg({ leftRoom: true });
                if (!isHost) {
                    vscode.commands.executeCommand('workbench.action.closeFolder');
                }
                isHost = false;
                croom = null;
                cfile = null;
            });
        }
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "collabView",
            provider
        )
    );

    //

    vscode.window.onDidChangeActiveTextEditor((event) => {
        if (!event) { return; }

        const file = getRelativePath(event.document.uri);
        if (!file || !croom) { return; }
        openFile(file, event);
    });

    //

    //

    //

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

function selectHost(context: vscode.ExtensionContext, provider: SidebarProvider, host: string, room: string | null = null) {
    chost = host;

    hostSocket = io(host, { path: "/socket.io" });

    hostSocket.on("connect", () => {
        // vscode.window.showInformationMessage(`connected to host!: ${host}`);

        provider.postMsg({ hostConnected: true });

        hostSocket.emit("projects", (projects: any[]) => {
            // vscode.window.showInformationMessage(`all projects: ${JSON.stringify(projects)}`);
            provider.postMsg({ projects });
        });

        if (room !== null) {
            hostSocket.emit("joinRoom", room, (success: boolean) => {
                if (success === false) {
                    vscode.commands.executeCommand('workbench.action.closeFolder');
                    return;
                }

                vscode.window.showInformationMessage(`joined room: ${room}`);
                croom = room;
                provider.postMsg({ joinedRoom: room });

                if (collabFs !== null) { collabFs.setSocket(hostSocket); }
            });
        }
    });

    // these series of callbacks take in requests from other users to read and write data to the host's system.
    hostSocket.on('statFile', async (uri: string, callback) => {
        callback(await getFileStats(uri));
    });
    hostSocket.on('readDirectory', async (uri: string, callback) => {
        callback(await readDirectory(uri));
    });
    hostSocket.on('readFile', async (uri: string, callback) => {
        callback(await readFile(uri));
    });

    hostSocket.on('createDirectory', async (uri: string, callback) => {
        callback(await createDirectory(uri));
    });
    hostSocket.on('writeFile', async (uri: string, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }, callback) => {

        await writeFile(uri, content, options);

        ///////////
        // AI code
        // If the host has this file open, save it to clear the dirty indicator
        const absoluteUri = getAbsoluteUri(uri);
        if (absoluteUri) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === absoluteUri.toString());
            if (doc && doc.isDirty) {
                await doc.save();
            }
        }
        ///////////

        callback();
    });
    hostSocket.on('deleteFile', async (uri: string, options: { readonly recursive: boolean; }, callback) => {
        callback(await deleteFile(uri, options));
    });
    hostSocket.on('renameFile', async (uri: string, newuri: string, options: { readonly overwrite: boolean; }, callback) => {
        callback(await renameFile(uri, newuri, options));
    });
}

let cfile: string | null = null;

function openFile(file: string, editor: vscode.TextEditor) {
    if (cfile !== null) {
        hostSocket.emit("closeFile", file, () => {
            openFile(file, editor);
        });
        cfile = null;
        return;
    }

    cfile = file;

    hostSocket.emit("openFile", file, (content: string) => {
        const current = editor.document.getText();
        if (current === content) { return; }
        editor.edit((editBuilder) => {
            editBuilder.replace(
                new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(current.length)
                ),
                content
            );
        });
    });
}

export function deactivate() { }
