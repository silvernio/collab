import * as vscode from 'vscode';
import { SidebarProvider } from './panel';
import { io, Socket } from 'socket.io-client';
import { CollabFs, maxSize } from './files';
import { createDirectory, deleteFile, getAbsoluteUri, getFileStats, readDirectory, readFile, renameFile, writeFile } from './host';
import { genId, getRelativePath, inviteLink, toLf, waitSync } from './utils';
import { SyncedFile } from './sync';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CollabAuth } from './auth';
import { AuthProvider, providerId } from './authProvider';

let socket: Socket;

let hostSocket: Socket;
let chid: string | null = null;
let cyjs: string | null = null;
// let chost: string | null = null;
// let cid: number | null = null;
let croom: string | null = null;
let cproject: string | null = null;
let cprojectName: string | null = null;
let cvisibility: number | null = null;
let isHost = false;

let collabFs: CollabFs | null = null;

let presence: any[] = [];

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

    let first = true;
    socket.on("connect", () => {
        if (!first && chid !== null) {
            selectHost(provider, chid, croom, cproject);
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (first && folder?.uri.scheme === 'collab') {
            const params = new URLSearchParams(folder.uri.query);
            const hid = params.get('hid');
            const projectId = params.get('pid');
            const room = decodeURIComponent(folder.uri.authority);

            if (hid !== null) {
                selectHost(provider, hid, projectId === null ? room : null, projectId);
                justLoaded = true;
            }
        }

        first = false;
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

    let justLoaded = false;

    provider.msgCallbacks.push(async (msg) => {
        if (msg.ready && chid && (croom !== null || cprojectName !== null)) {
            provider.postMsg({ state: { host: chid, room: croom, project: cprojectName, visibility: cvisibility, page: croom !== null ? "rooms" : "projects" } });
        }

        if (msg.presence) {
            provider.postMsg({ presence });
            // if (hostSocket) {
            //     hostSocket.emit("presence");
            // }
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
            const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(msg.joinRoom)}/${encodeURIComponent(msg.joinRoom)}`).with({ query: new URLSearchParams({ hid: chid ?? "" }).toString() });
            vscode.commands.executeCommand('vscode.openFolder', workspaceUri, { forceNewWindow: false });
        }

        if (msg.selectHost) {
            if (!justLoaded) {
                selectHost(provider, msg.selectHost);
            }
            justLoaded = false;
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

            const visibility = await vscode.window.showQuickPick(
                [{ label: "private", description: "only those who have the link or have opened the project can join" }, { label: "public", description: "anyone can join" }],
                { title: "What's its visibility?", placeHolder: "visibility" },
            );

            if (name !== undefined && visibility !== undefined) {
                if (hostSocket) {
                    const id: string | null = await hostSocket.emitWithAck("newProject", name, ["private", "public"].indexOf(visibility.label));

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
            provider.postMsg({ projects: await hostSocket.emitWithAck("projects") });
        }

        if (msg.newRoom) {
            // vscode.window.showInformationMessage(`you want a new room!`);

            const name = await vscode.window.showInputBox({
                title: "What's the name of the room?",
                placeHolder: "name",
            });

            const visibility = await vscode.window.showQuickPick(
                [{ label: "private", description: "only those who have the link can join" }, { label: "public", description: "anyone can join" }],
                { title: "What's its visibility?", placeHolder: "visibility" },
            );

            if (name !== undefined && visibility !== undefined && hostSocket) {
                const v = ["private", "public"].indexOf(visibility.label);
                hostSocket.emit("newRoom", name, v, (success: boolean) => {
                    if (!success) {
                        vscode.window.showInformationMessage("new room failed");
                        return;
                    }
                    // vscode.window.showInformationMessage(`new room! ${success}`);
                    croom = name;
                    cvisibility = v;
                    provider.postMsg({ state: { host: chid, room: croom, project: cprojectName, visibility: cvisibility, page: "rooms" } });
                    // provider.postMsg({ newRoom: {name, visibility: v} });
                    isHost = true;

                    openDocuments();
                });
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
                // onSession(provider, undefined);

                // socket.disconnect().connect();
            }
        }

        if (msg.invite && chid) {
            await vscode.env.clipboard.writeText(inviteLink(croom ?? (cprojectName ?? ''), chid, cproject));
            vscode.window.showInformationMessage("Invite link copied!");
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

    // context.subscriptions.push(
    //     vscode.workspace.onDidSaveTextDocument((document) => {
    //         if ((!croom && !cprojectName) || !hostSocket) { return; }
    //         const file = getRelativePath(document.uri);
    //         if (!file) { return; }
    //         hostSocket.emit('saveFile', file);
    //     }),
    // );

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

async function selectHost(provider: SidebarProvider, hid: string, room: string | null = null, project_id: string | null = null) {
    chid = hid;

    if (hostSocket) {
        hostSocket.removeAllListeners();
        hostSocket.disconnect();
        hostUser = null;
        provideUser(provider);
    }

    const { url, yjs_url, token }: { url: string | null, yjs_url: string | null, token: string | null } = await socket.emitWithAck("joinHost", hid);
    cyjs = yjs_url;

    if (!url || !yjs_url) { return; }

    hostSocket = io(url, { path: "/socket.io", auth: token ? { token } : undefined });

    hostSocket.on("connect", async () => {
        provider.postMsg({ hostConnected: true });

        if (room !== null) {
            hostSocket.emit("joinRoom", room, (visibility: number | null) => {
                if (visibility === null) {
                    vscode.commands.executeCommand('workbench.action.closeFolder');
                    return;
                }

                // vscode.window.showInformationMessage(`joined room: ${room}`);
                croom = room;
                cvisibility = visibility;
                provider.postMsg({ state: { host: chid, room: croom, project: cprojectName, visibility: cvisibility, page: "rooms" } });
                // provider.postMsg({ joinedRoom: room });

                if (collabFs !== null) { collabFs.setSocket(hostSocket); }

                openDocuments();
            });
        }

        if (project_id !== null) {
            const { name, visibility }: { name: string | null, visibility: number | null } = await hostSocket.emitWithAck("openProject", project_id);

            if (!name || visibility === null) {
                vscode.commands.executeCommand('workbench.action.closeFolder');
                return;
            }

            cprojectName = name;
            cproject = project_id;
            cvisibility = visibility;
            provider.postMsg({ state: { host: chid, room: croom, project: cprojectName, visibility: cvisibility, page: "rooms" } });

            if (collabFs !== null) { collabFs.setSocket(hostSocket); }

            openDocuments();
        }
    });

    hostSocket.on("data", (name: string, colour: string, uuid: string | null) => {
        console.log(name, colour, uuid);
        hostUser = { name, colour, uuid };
        provideUser(provider);
    });

    hostSocket.on("presence", (users: any[]) => {
        presence = users;
        provider.postMsg({ presence: users });
    });

    hostSocket.on("disconnect", () => {
        if (chid !== null) {
            selectHost(provider, chid, croom, cproject);
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
                const provider = new WebsocketProvider(yjs_url, id, doc);
                initConns.set(id, { p: provider, d: doc });
                const ytext = doc.getText('content');

                await waitSync(provider);

                const meta = doc.getMap('meta');

                if (!meta.get('seeded')) {
                    const bytes = await readFile(uri);
                    doc.transact(() => {
                        ytext.insert(0, toLf(new TextDecoder().decode(bytes)));
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
        const content = await readFile(uri);
        callback(content && content.byteLength > maxSize ? undefined : content);
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

function openProject(id: string, name: string) {
    const workspaceUri = vscode.Uri.parse(`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(name)}/${encodeURIComponent(name)}`).with({ query: new URLSearchParams({ hid: chid ?? "", pid: id }).toString() });
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

const opening = new Set<string>();

function openDocument(document: vscode.TextDocument) {
    const path = document.uri.toString();
    if (synced.has(path) || opening.has(path)) { return; }

    const file = getRelativePath(document.uri);
    if (!file || (!croom && !cprojectName) || !cyjs || !hostSocket) { return; }

    opening.add(path);

    hostSocket.emit('openFile', file, async (id: string, wasInit: boolean) => {
        let s: SyncedFile | undefined;
        try {
            if (!cyjs) { return; }
            if (document.isClosed) {
                hostSocket.emit('closeFile', file, () => { });
                return;
            }
            s = await SyncedFile.create(hostSocket, cyjs, id, document, hostSocket.id ?? "none");
        } finally {
            opening.delete(path);
        }

        if (wasInit) { hostSocket.emit("connectedFile", id); }

        if (document.isClosed) {
            s.dispose();
            hostSocket.emit("closeFile", file, () => {});
            const reopened = vscode.workspace.textDocuments.find((d) => d.uri.toString() === path);
            if (reopened) { openDocument(reopened); }
            return;
        }

        synced.set(path, s);
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
