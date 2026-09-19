import * as vscode from 'vscode';
import { SidebarProvider } from './panel';
import { io, Socket } from 'socket.io-client';
import { CollabFs } from './files';
import { createDirectory, deleteFile, getAbsoluteUri, getFileStats, readDirectory, readFile, renameFile, writeFile } from './host';
import { getRelativePath, waitSync } from './utils';
import { SyncedFile } from './sync';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

let socket: Socket;

let hostSocket: Socket;
let chost: string | null = null;
let cyjs: string | null = null;
let croom: string | null = null;
let isHost = false;

let collabFs: CollabFs | null = null;

const hue = Math.floor(Math.random() * 360);
const user = {
    name: '',
    colour: `hsl(${hue} 70% 55%)`,
    bandColour: `hsla(${hue}, 70%, 55%, 0.25)`,
    clientId: Math.random().toString(36).slice(6)
};

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
    console.log('collab: FS provider registered', Date.now());

    context.subscriptions.push({
        dispose: () => socket.disconnect(),
    });

    const provider = new SidebarProvider(context.extensionUri);

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme === 'collab') {
        const params = new URLSearchParams(folder.uri.query);
        const whost = params.get('host');
        const wyjs = params.get('yjs_host');
        const room = decodeURIComponent(folder.uri.authority);

        // vscode.window.showInformationMessage(`loading room: ${whost}, ${wyjs}, ${room}`);

        if (whost !== null && wyjs !== null) {
            selectHost(provider, whost, wyjs, room);
        }
    }

    provider.msgCallbacks.push(async (msg) => {
        if (msg.ready) {
            if (chost !== null && croom !== null) {
                provider.postMsg({ state: { host: {url: chost, yjs_url: cyjs}, room: croom, page: "rooms" } });
            }
        }

        if (msg.hosts) {
            socket.emit("hosts", (hosts: { id: number, name: string, url: string, yjs_url: string }[]) => {
                provider.postMsg({ hosts });
            });
        }

        if (msg.rooms && hostSocket) {
            hostSocket.emit("rooms", (rooms: string[]) => {
                provider.postMsg({ rooms });
            });
        }

        if (msg.joinRoom && hostSocket) {
            // context.globalState.update("host", chost);
            // context.globalState.update("yjs_host", cyjs);
            // context.globalState.update("room", msg.joinRoom);
            const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(msg.joinRoom)}/${encodeURIComponent(msg.joinRoom)}`).with({ query: new URLSearchParams({ host: chost ?? "", yjs_host: cyjs ?? "" }).toString() });
            vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
        }

        if (msg.selectHost) {
            selectHost(provider, msg.selectHost.url, msg.selectHost.yjs_url);
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
            // vscode.window.showInformationMessage(`you want a new project!`);

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
                        // vscode.window.showInformationMessage(`new project! ${id}`);
                    });
                }
            }
        }

        if (msg.newRoom) {
            // vscode.window.showInformationMessage(`you want a new room!`);

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
                        // vscode.window.showInformationMessage(`new room! ${success}`);
                        croom = name;
                        provider.postMsg({ newRoom: name });
                        isHost = true;
                        openDocuments();
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
                for (const s of synced.values()) {
                    s.dispose();
                }
                synced.clear();
                // cfile = null;
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

    //

    //

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (!croom || !hostSocket) { return; }
            const file = getRelativePath(document.uri);
            if (!file) { return; }
            hostSocket.emit('saveFile', file);
        }),
    );

    //

    console.log('Collab started');
}

function selectHost(provider: SidebarProvider, host: string, yjs_host: string, room: string | null = null) {
    chost = host;
    cyjs = yjs_host;

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

                // vscode.window.showInformationMessage(`joined room: ${room}`);
                croom = room;
                provider.postMsg({ state: { host: {url: chost, yjs_url: cyjs}, room: croom, page: "rooms" } });
                provider.postMsg({ joinedRoom: room });

                if (collabFs !== null) { collabFs.setSocket(hostSocket); }

                openDocuments();
            });
        }
    });

    const initing = new Map<string, Promise<void>>();
    const initConns = new Map<string, { p: WebsocketProvider, d: Y.Doc }>();

    hostSocket.on('roomDeleted', () => {
        // vscode.window.showInformationMessage("room deleted?");
        provider.postMsg({ leftRoom: true });
        if (!isHost) {
            vscode.commands.executeCommand('workbench.action.closeFolder');
        }
        isHost = false;
        croom = null;
    });

    hostSocket.on('initFile', async (uri: string, id: string, callback) => {
        let pending = initing.get(id);
        if (!pending) {
            pending = (async () => {
                const doc = new Y.Doc();
                const provider = new WebsocketProvider(yjs_host, id, doc);
                initConns.set(id, { p: provider, d: doc });
                const ytext = doc.getText('content');

                await waitSync(provider);

                const meta = doc.getMap('meta');

                if (!meta.get('seeded')) {
                    const bytes = await readFile(uri);
                    doc.transact(() => {
                        ytext.insert(0, new TextDecoder().decode(bytes));
                        meta.set('seeded', true);
                    }, {});
                }
            })();
            initing.set(id, pending);
        }
        await pending;

        callback();
    });

    hostSocket.on('connectedFile', (id: string) => {
        initing.delete(id);
        const conn = initConns.get(id);
        if (conn) {
            conn.p.destroy();
            conn.d.destroy();
        }
        initConns.delete(id);
    });

    //

    hostSocket.on('saveFile', async (file: string) => {
        const uri = getAbsoluteUri(file);
        if (!uri) { return; }
        const document = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === uri.toString(),
        );
        if (!document || !document.isDirty) { return; }
        await document.save();
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

//

//

//

const synced = new Map<string, SyncedFile>();

vscode.workspace.onDidOpenTextDocument(async (document) => {
    openDocument(document);
});

function openDocuments() {
    for (const document of vscode.workspace.textDocuments) {
        if (document.isUntitled) { continue; }
        openDocument(document);
    }
}

function openDocument(document: vscode.TextDocument) {
    const path = document.uri.toString();
    if (synced.has(path)) { return; }

    const file = getRelativePath(document.uri);
    if (!file || !croom || !cyjs) { return; }

    hostSocket.emit('openFile', file, async (id: string, wasInit: boolean) => {
        if (!cyjs) { return; }
        if (document.isClosed) {
            hostSocket.emit('closeFile', file, () => { });
            return;
        }

        synced.set(path, await SyncedFile.create(cyjs, id, document, user));

        if (wasInit) { hostSocket.emit("connectedFile", id); }
    });
}

vscode.workspace.onDidCloseTextDocument((document) => {
    const path = document.uri.toString();
    const s = synced.get(path);
    if (!s) { return; }
    synced.delete(path);
    s.dispose();
    const file = getRelativePath(document.uri);
    if (file) { hostSocket.emit('closeFile', file, () => { }); }
});

// let cfile: string | null = null;
// let csyncedFile: SyncedFile | null = null;

//   vscode.window.onDidChangeActiveTextEditor((editor) => {
//         if (!editor) { return; }

//         const text = editor.document.getText();

//         const file = getRelativePath(editor.document.uri);
//         if (!file || !croom) { return; }
//         openFile(context, file, text, editor);
//     });

// function openFile(context: vscode.ExtensionContext, file: string, content: string, editor: vscode.TextEditor) {
//     if (cfile !== null) {
//         hostSocket.emit("closeFile", cfile, () => {
//             openFile(context, file, content, editor);
//         });
//         csyncedFile?.dispose();
//         cfile = null;
//         return;
//     }

//     cfile = file;

//     hostSocket.emit("openFile", file, async (id: string) => {
//         if (!cyjs) { return; }

//         csyncedFile = await SyncedFile.create(cyjs, id, editor.document, content);
//         context.subscriptions.push(csyncedFile);
//     });
// }

export function deactivate() { }
