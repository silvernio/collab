import * as vscode from 'vscode';
import { SidebarProvider } from './panel';
import { io, Socket } from 'socket.io-client';
import { CollabFs } from './files';
import { createDirectory, deleteFile, getAbsoluteUri, getFileStats, readDirectory, readFile, renameFile, writeFile } from './host';
import { genId, getRelativePath, inviteLink, waitSync } from './utils';
import { SyncedFile } from './sync';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CollabAuth } from './auth';
import { AuthProvider, providerId } from './authProvider';

let socket: Socket;

let hostSocket: Socket;
let chost: string | null = null;
let cid: number | null = null;
let cyjs: string | null = null;
let croom: string | null = null;
let cproject: string | null = null;
let cprojectId: number | null = null;
let isHost = false;

let collabFs: CollabFs | null = null;

// const user = {
//     name: randomName,
//     colour: `hsl(${hue} 70% 55%)`,
//     bandColour: `hsla(${hue}, 70%, 55%, 0.25)`,
//     clientId: Math.random().toString(36).slice(6)
// };

// const accountUser = { name: "", colour: "", uuid: null };
let hostUser: { name: string, colour: string, uuid: string | null } | null = null;

async function onSession(provider: SidebarProvider, session: vscode.AuthenticationSession | undefined) {
    provideUser(provider, session);

    // if (session === undefined) {
    //     if (user.name.startsWith("guest") && user.name.length === 11) { return; }
    //     const randomName = `guest${genId(6)}`;
    //     user.name = randomName;
    //     const hue = Math.floor(Math.random() * 360);
    //     user.colour = `hsl(${hue} 70% 55%)`;
    //     user.bandColour = `hsla(${hue}, 70%, 55%, 0.25)`;

    //     provider.postMsg({ user });

    //     return;
    // }

    // user.name = session.account.label;

    // const res = await fetch("https://auth.silverspace.io/api/account/" + session.account.id + "/");
    // const data = await res.json();

    // if (data.colour) {
    //     user.colour = data.colour;
    //     user.bandColour = data.colour + "40";

    //     provider.postMsg({ colour: user.colour });
    // }
}

async function provideUser(provider: SidebarProvider, csession?: vscode.AuthenticationSession) {
    if (hostUser !== null) {
        provider.postMsg({ user: hostUser });
    } else {
        const session = csession ? csession : await vscode.authentication.getSession(providerId, [], { silent: true });
        if (session !== undefined) {
            const res = await fetch("https://auth.silverspace.io/api/account/" + session.account.id + "/");
            const data = await res.json();
            provider.postMsg({ user: { name: session.account.label, colour: data.colour, uuid: session.account.id } });
        } else {
            provider.postMsg({ user: { name: "", colour: "#ffffff", uuid: null } });
        }
    }
}

async function getSessionToken(cb: (data: object) => void) {
    const session = await vscode.authentication.getSession(providerId, [], { silent: true });

    if (session !== undefined) {
        cb({ token: session.accessToken });
    } else {
        cb({});
    }
}

export const FILE_SYSTEM_SCHEME = 'collab';

export function activate(context: vscode.ExtensionContext) {
    socket = io("https://server.silverspace.io", { autoConnect: false, path: "/collab/socket.io", auth: getSessionToken });

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

    const auth = new CollabAuth(context);

    context.subscriptions.push(vscode.window.registerUriHandler(auth));

    const authProvider = new AuthProvider(context, auth);

    context.subscriptions.push(authProvider, vscode.authentication.registerAuthenticationProvider(providerId, 'Live Collab', authProvider));

    const provider = new SidebarProvider(context.extensionUri);

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme === 'collab') {
        const params = new URLSearchParams(folder.uri.query);
        const wid = params.get('id');
        const whost = params.get('host');
        const wyjs = params.get('yjs_host');
        const projectId = params.get('project_id');
        const room = decodeURIComponent(folder.uri.authority);

        // vscode.window.showInformationMessage(`loading room: ${whost}, ${wyjs}, ${room}`);

        if (whost !== null && wyjs !== null && wid !== null) {
            selectHost(provider, parseInt(wid), whost, wyjs, projectId === null ? room : null, projectId);
        }
    }

    provider.msgCallbacks.push(async (msg) => {
        if (msg.ready) {
            if (chost !== null && croom !== null && cid !== null) {
                provider.postMsg({ state: { host: { id: cid, url: chost, yjs_url: cyjs }, room: croom, page: "rooms" } });
            }
            if (chost !== null && cproject !== null && cid !== null) {
                provider.postMsg({ state: { host: { id: cid, url: chost, yjs_url: cyjs }, project: cproject, page: "projects" } });
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
            const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(msg.joinRoom)}/${encodeURIComponent(msg.joinRoom)}`).with({ query: new URLSearchParams({ id: cid?.toString() ?? "", host: chost ?? "", yjs_host: cyjs ?? "" }).toString() });
            vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
        }

        if (msg.selectHost) {
            selectHost(provider, msg.selectHost.id, msg.selectHost.url, msg.selectHost.yjs_url);
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

            const name = await vscode.window.showInputBox({
                prompt: "What's the project name?",
                placeHolder: "name",
            });

            if (name !== undefined) {
                if (hostSocket) {
                    const id: number | null = await hostSocket.emitWithAck("newProject", name);

                    if (id !== null && name !== undefined) {
                        openProject(id, name);
                    }

                    // provider.postMsg({newProject: {name, path, id}});

                    // hostSocket.emit("newProject", "", path, name, (id: number) => {
                    //     // vscode.window.showInformationMessage(`new project! ${id}`);
                    // });
                }
            }
        }

        if (msg.openProject && hostSocket) {
            openProject(msg.openProject.id, msg.openProject.name);
        }

        if (msg.projects && hostSocket) {
            provider.postMsg({projects: await hostSocket.emitWithAck("projects")});
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
                    hostSocket.emit("newRoom", name, (_success: boolean) => {
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

        if (msg.auth) {
            try {
                const session = await vscode.authentication.getSession(providerId, [], { createIfNone: true });
                // vscode.window.showInformationMessage(`signed in: ${session.account.label}`);
                provider.postMsg({ cauth: session });
                onSession(provider, session);

                socket.disconnect().connect();
            } catch { }
        }

        if (msg.user) {
            provideUser(provider);
            // try {
            //     const session = await vscode.authentication.getSession(providerId, [], { silent: true });
            //     provider.postMsg({ cauth: session });
            //     onSession(provider, session);
            // } catch { }
        }

        if (msg.logout) {
            const session = await vscode.authentication.getSession(providerId, [], { silent: true });

            if (session) {
                await authProvider.removeSession(session.id);
                provider.postMsg({ loggedOut: true });
                onSession(provider, undefined);

                socket.disconnect().connect();
            }
        }

        if (msg.invite && cid && chost && cyjs) {
            await vscode.env.clipboard.writeText(inviteLink(croom ?? (cproject ?? ''), cid, chost, cyjs, cprojectId));
            vscode.window.showInformationMessage("Invite link copied");
        }
    });

    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id !== providerId) { return; }

            const session = await vscode.authentication.getSession(providerId, [], { silent: true });

            if (session) {
                provider.postMsg({ cauth: session });
            } else {
                provider.postMsg({ loggedOut: true });
            }

            onSession(provider, session);

            socket.disconnect().connect();
        })
    );

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
            if ((!croom && !cproject) || !hostSocket) { return; }
            const file = getRelativePath(document.uri);
            if (!file) { return; }
            hostSocket.emit('saveFile', file);
        }),
    );

    //

    (async () => {
        try {
            const session = await vscode.authentication.getSession(providerId, [], { silent: true });
            provider.postMsg({ cauth: session });
            onSession(provider, session);
        } catch { }

        socket.connect();
    })();

    console.log('Collab started');
}

async function selectHost(provider: SidebarProvider, hosti: number, host: string, yjs_host: string, room: string | null = null, project_id: string | null = null) {
    chost = host;
    cyjs = yjs_host;
    cid = hosti;

    if (hostSocket) {
        hostSocket.disconnect();
        hostUser = null;
        provideUser(provider);
    }

    const token: string | null = await socket.emitWithAck("joinHost", hosti);

    hostSocket = io(host, { path: "/socket.io", auth: token ? { token } : undefined });

    hostSocket.on("connect", async () => {
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
                provider.postMsg({ state: { host: { id: cid, url: chost, yjs_url: cyjs }, room: croom, project: cproject, page: "rooms" } });
                // provider.postMsg({ joinedRoom: room });

                if (collabFs !== null) { collabFs.setSocket(hostSocket); }

                openDocuments();
            });
        }

        if (project_id !== null) {
            const name = await hostSocket.emitWithAck("openProject", project_id, null);
            
            if (!name) {
                vscode.commands.executeCommand('workbench.action.closeFolder');
                return;
            }

            cproject = name;
            cprojectId = parseInt(project_id);
            provider.postMsg({ state: { host: { id: cid, url: chost, yjs_url: cyjs }, room: croom, project: cproject, page: "rooms" } });

            if (collabFs !== null) { collabFs.setSocket(hostSocket); }

            openDocuments();
        }
    });

    hostSocket.on("data", (name: string, colour: string, uuid: string | null) => {
        console.log(name, colour, uuid);
        hostUser = {name, colour, uuid};
        provideUser(provider);
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

function openProject(id: number, name: string) {
    const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(name)}/${encodeURIComponent(name)}`).with({ query: new URLSearchParams({ id: cid?.toString() ?? "", host: chost ?? "", yjs_host: cyjs ?? "", project_id: id + "" }).toString() });
    vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
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
    if (!file || (!croom && !cproject) || !cyjs || !hostSocket) { return; }

    hostSocket.emit('openFile', file, async (id: string, wasInit: boolean) => {
        if (!cyjs) { return; }
        if (document.isClosed) {
            hostSocket.emit('closeFile', file, () => { });
            return;
        }

        synced.set(path, await SyncedFile.create(hostSocket, cyjs, id, document, hostSocket.id ?? "none"));

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
