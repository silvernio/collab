import * as vscode from "vscode";
import { SidebarProvider } from "./panel";
import { io, Socket } from "socket.io-client";
import { CollabFs, maxSize } from "./files";
import {
	createDirectory,
	deleteFile,
	getAbsoluteUri,
	getFileStats,
	readDirectory,
	readFile,
	renameFile,
	writeFile,
} from "./host";
import { getRelativePath, inviteLink, toLf, waitSync } from "./utils";
import { SyncedFile } from "./sync";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { CollabAuth } from "./auth";
import { AuthProvider, providerId } from "./authProvider";

let socket: Socket; // the current connection to the main server

let hostSocket: Socket | null = null; // the connection to the host server
let chid: string | null = null; // the id of the currently connected host
let cyjs: string | null = null; // the url to the yjs server of the current host
let croom: string | null = null; // the name of the room currently open
let cproject: string | null = null; // the id of the project currently open
let cprojectName: string | null = null; // the name of the project currently open
let cvisibility: number | null = null; // the visibility of the current project / room
let isHost = false; // whether your the host of the room or not

let collabFs: CollabFs | null = null; // custom file system for rooms and projects

let presence: any[] = []; // the list of users in the room / project

// the name, colour, and uuid given by the host after connecting
let hostUser: { name: string; colour: string; uuid: string | null } | null =
	null;

// when the account state changes, refresh the shown user
async function onSession(
	provider: SidebarProvider,
	session: vscode.AuthenticationSession | undefined,
) {
	provideUser(provider, session);
}

// update the sidebar with the current logged in user / from host
async function provideUser(
	provider: SidebarProvider,
	csession?: vscode.AuthenticationSession,
) {
	if (hostUser !== null) {
		// if connected to a host, use their data
		provider.postMsg({ user: hostUser });
	} else {
		// otherwise, get the currently logged in user
		const session = csession
			? csession
			: await vscode.authentication.getSession(providerId, [], {
					silent: true,
				});
		// if they are logged in, fetch details
		if (session !== undefined) {
			const res = await fetch(
				"https://auth.silverspace.io/api/account/" +
					session.account.id +
					"/",
			);
			const data = await res.json();
			provider.postMsg({
				user: {
					name: session.account.label,
					colour: data.colour,
					uuid: session.account.id,
				},
			});
		} else {
			// otherwise, return blank
			provider.postMsg({
				user: { name: "", colour: "#ffffff", uuid: null },
			});
		}
	}
}

// for connecting to the server, extract the token from the auth session in vscode
async function getSessionToken(cb: (data: object) => void) {
	const session = await vscode.authentication.getSession(providerId, [], {
		silent: true,
	});

	if (session !== undefined) {
		cb({ token: session.accessToken });
	} else {
		cb({});
	}
}

// the namespace all rooms and projects use
export const FILE_SYSTEM_SCHEME = "collab";

// runs when the window loads
export function activate(context: vscode.ExtensionContext) {
	// connect to the main server
	socket = io("https://server.silverspace.io", {
		autoConnect: false,
		path: "/collab/socket.io",
		auth: getSessionToken, // pass in the account session token
	});

	// on connecting to the main server, reconnect to the host, or open the current room / project
	let first = true;
	socket.on("connect", () => {
		// reconnect if previously disconnected
		if (!first && chid !== null) {
			selectHost(provider, chid, croom, cproject);
		}

		// open the currently open project / room if its the first load
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (first && folder?.uri.scheme === "collab") {
			const params = new URLSearchParams(folder.uri.query);
			const hid = params.get("hid");
			const projectId = params.get("pid");
			const room = decodeURIComponent(folder.uri.authority);

			if (hid !== null) {
				selectHost(
					provider,
					hid,
					projectId === null ? room : null,
					projectId,
				);
				justLoaded = true;
			}
		}

		first = false;
	});

	// register the custom rooms / projects file system
	collabFs = new CollabFs();
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider("collab", collabFs, {
			isCaseSensitive: true,
		}),
	);
	console.log("collab: fs provider setup");

	// on window close, disconnect from the main server
	context.subscriptions.push({
		dispose: () => socket.disconnect(),
	});

	// setup the auth handler for the account system in vscode
	const auth = new CollabAuth(context);
	context.subscriptions.push(vscode.window.registerUriHandler(auth));
	const authProvider = new AuthProvider(context, auth);
	context.subscriptions.push(
		authProvider,
		vscode.authentication.registerAuthenticationProvider(
			providerId,
			"Live Collab",
			authProvider,
		),
	);

	const provider = new SidebarProvider(context.extensionUri); // setup the sidebar

	let justLoaded = false; // whether a room / project was just opened

	// these trigger when a message is received from the sidebar
	provider.msgCallbacks.push(async (msg) => {
		// when the sidebar requests the state on load, return it
		if (msg.ready && chid && (croom !== null || cprojectName !== null)) {
			provider.postMsg({
				state: {
					host: chid,
					room: croom,
					project: cprojectName,
					visibility: cvisibility,
					page: croom !== null ? "rooms" : "projects",
				},
			});
		}

		// requesting the user list
		if (msg.presence) {
			provider.postMsg({ presence });
		}

		// requesting the hosts list
		if (msg.hosts) {
			// get the host list from the main server
			socket.emit(
				"hosts",
				(
					hosts: {
						id: number;
						name: string;
						url: string;
						yjs_url: string;
					}[],
				) => {
					provider.postMsg({ hosts });
				},
			);
		}

		// if connected to a host, requesting rooms uses the host
		if (msg.rooms && hostSocket) {
			hostSocket.emit("rooms", (rooms: string[]) => {
				provider.postMsg({ rooms });
			});
		}

		// to join a room, just open a folder with the path and connect on the window load
		if (msg.joinRoom && hostSocket) {
			const workspaceUri = vscode.Uri.parse(
				`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(msg.joinRoom)}/${encodeURIComponent(msg.joinRoom)}`,
			).with({
				query: new URLSearchParams({ hid: chid ?? "" }).toString(),
			});
			vscode.commands.executeCommand("vscode.openFolder", workspaceUri, {
				forceNewWindow: false,
			});
		}

		// only join a host if its the second time requesting, since the first time is a duplicate of the window load
		if (msg.selectHost) {
			if (!justLoaded) {
				selectHost(provider, msg.selectHost);
			}
			justLoaded = false;
		}

		// get the new project details, then request its creation and join it
		if (msg.newProject) {
			// get details
			const name = await vscode.window.showInputBox({
				prompt: "What's the project name?",
				placeHolder: "name",
			});

			const visibility = await vscode.window.showQuickPick(
				[
					{
						label: "private",
						description:
							"only those who have the link or have opened the project can join",
					},
					{ label: "public", description: "anyone can join" },
				],
				{ title: "What's its visibility?", placeHolder: "visibility" },
			);

			if (name !== undefined && visibility !== undefined) {
				if (hostSocket) {
					// request creation
					const id: string | null = await hostSocket.emitWithAck(
						"newProject",
						name,
						["private", "public"].indexOf(visibility.label),
					);

					// join it
					if (id !== null && name !== undefined) {
						openProject(id, name);
					}
				}
			}
		}

		// open a project from the sidebar
		if (msg.openProject && hostSocket) {
			openProject(msg.openProject.id, msg.openProject.name);
		}

		// get the projects list from the host connection
		if (msg.projects && hostSocket) {
			provider.postMsg({
				projects: await hostSocket.emitWithAck("projects"),
			});
		}

		// for a new room, get the details, then, create a new room with the current window
		if (msg.newRoom) {
			// get details
			const name = await vscode.window.showInputBox({
				title: "What's the name of the room?",
				placeHolder: "name",
			});

			const visibility = await vscode.window.showQuickPick(
				[
					{
						label: "private",
						description: "only those who have the link can join",
					},
					{ label: "public", description: "anyone can join" },
				],
				{ title: "What's its visibility?", placeHolder: "visibility" },
			);

			if (name !== undefined && visibility !== undefined && hostSocket) {
				// request creation
				const v = ["private", "public"].indexOf(visibility.label);
				hostSocket.emit("newRoom", name, v, (success: boolean) => {
					if (!success) {
						vscode.window.showInformationMessage("new room failed");
						return;
					}
					// update state
					croom = name;
					cvisibility = v;
					provider.postMsg({
						state: {
							host: chid,
							room: croom,
							project: cprojectName,
							visibility: cvisibility,
							page: "rooms",
						},
					});
					isHost = true;

					// connect syncing server files
					openDocuments();
				});
			}
		}

		// request leaving of the current room / project
		if (msg.leaveRoom && hostSocket) {
			// use the leaveRoom event
			hostSocket.emit("leaveRoom", () => {
				provider.postMsg({ leftRoom: true }); // let the sidebar know it left
				if (!isHost) {
					// if a room / project is open, close the window
					vscode.commands.executeCommand(
						"workbench.action.closeFolder",
					);
				}
				// update state
				isHost = false;
				croom = null;
				// close synced files
				for (const s of synced.values()) {
					s.dispose();
				}
				synced.clear();
				opening.clear();
			});
		}

		// when the sidebar requests a login, use the vscode api with the custom provider
		if (msg.auth) {
			try {
				// use vscode api
				const session = await vscode.authentication.getSession(
					providerId,
					[],
					{
						createIfNone: true,
					},
				);
				// update sidebar
				provider.postMsg({ cauth: session });
				onSession(provider, session); // trigger auth updates

				// reconnect with new session
				socket.disconnect().connect();
			} catch {}
		}

		// request the user name and colour
		if (msg.user) {
			provideUser(provider);
		}

		// logout / remove the current session
		if (msg.logout) {
			// get the current session
			const session = await vscode.authentication.getSession(
				providerId,
				[],
				{
					silent: true,
				},
			);

			// remove the current session
			if (session) {
				await authProvider.removeSession(session.id);
				provider.postMsg({ loggedOut: true }); // let the sidebar know
			}
		}

		// copy the invite link for the currently open room / project
		if (msg.invite && chid) {
			// use the inviteLink function
			await vscode.env.clipboard.writeText(
				inviteLink(croom ?? cprojectName ?? "", chid, cproject),
			);
			vscode.window.showInformationMessage("Invite link copied!"); // let the user know it worked
		}
	});

	// when the user logs in / logs out, update state and sidebar
	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions(async (e) => {
			if (e.provider.id !== providerId) {
				// only trigger for the custom account system
				return;
			}

			// get the current session
			const session = await vscode.authentication.getSession(
				providerId,
				[],
				{
					silent: true,
				},
			);

			// update the sidebar
			if (session) {
				provider.postMsg({ cauth: session });
			} else {
				provider.postMsg({ loggedOut: true });
			}

			onSession(provider, session); // trigger other paths

			socket.disconnect().connect(); // reconnect with new session
		}),
	);

	// register the sidebar with vscode
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("collabView", provider),
	);

	// on window load, check the user authentication
	(async () => {
		try {
			// get their session
			const session = await vscode.authentication.getSession(
				providerId,
				[],
				{
					silent: true,
				},
			);
			// update the sidebar
			provider.postMsg({ cauth: session });
			onSession(provider, session);
		} catch {}

		// only connect to the main host after trying to authenticate
		socket.connect();
	})();

	console.log("Collab started");
}

// given the id of a host, and the room / project to open, setup the connection and open it
async function selectHost(
	provider: SidebarProvider,
	hid: string,
	room: string | null = null,
	project_id: string | null = null,
) {
	chid = hid; // update the current host

	// disconnect the previous host
	if (hostSocket !== null) {
		hostSocket.removeAllListeners();
		hostSocket.disconnect();
		hostSocket = null;
		hostUser = null;
		provideUser(provider);
	}

	// let the main server know you are joining a host, it returns an auth token and the host details
	const {
		url,
		yjs_url,
		token,
	}: { url: string | null; yjs_url: string | null; token: string | null } =
		await socket.emitWithAck("joinHost", hid);
	cyjs = yjs_url;

	if (!url || !yjs_url || hostSocket !== null) {
		return;
	}

	// use the host details to connect
	let first = true;
	hostSocket = io(url, {
		path: "/socket.io",
		// register an auth callback that checks the current session and passes it through the main server before connecting
		auth: (cb) => {
			let ifirst = first;
			first = false;
			if (ifirst) {
				cb({ token: token ? token : undefined });
			} else {
				socket
					.timeout(5000)
					.emitWithAck("joinHost", hid)
					.then((data) => {
						cb({ token: data.token ? data.token : undefined });
					})
					.catch(() => cb({}));
			}
		},
	});

	// on connecting to the host, let the sidebar know
	hostSocket.on("connect", async () => {
		provider.postMsg({ hostConnected: true });

		if (hostSocket === null) {
			return;
		}

		// if opening a room
		if (room !== null) {
			// open with the room name
			hostSocket.emit("joinRoom", room, (visibility: number | null) => {
				if (visibility === null) {
					// if there was no room, or it failed, close the window
					vscode.commands.executeCommand(
						"workbench.action.closeFolder",
					);
					return;
				}

				// update state
				croom = room;
				cvisibility = visibility;
				provider.postMsg({
					state: {
						host: chid,
						room: croom,
						project: cprojectName,
						visibility: cvisibility,
						page: "rooms",
					},
				});

				// set the connection for the custom file system
				if (collabFs !== null && hostSocket !== null) {
					collabFs.setSocket(hostSocket);
				}

				openDocuments(); // connect & sync currently open files
			});
		}

		// if opening a project
		if (project_id !== null) {
			// open the project
			const {
				name,
				visibility,
			}: { name: string | null; visibility: number | null } =
				await hostSocket.emitWithAck("openProject", project_id);

			if (!name || visibility === null) {
				// if failed, close the window
				vscode.commands.executeCommand("workbench.action.closeFolder");
				return;
			}

			// update state
			cprojectName = name;
			cproject = project_id;
			cvisibility = visibility;
			provider.postMsg({
				state: {
					host: chid,
					room: croom,
					project: cprojectName,
					visibility: cvisibility,
					page: "rooms",
				},
			});

			// register connection with file system
			if (collabFs !== null) {
				collabFs.setSocket(hostSocket);
			}

			openDocuments(); // sync currently open files
		}
	});

	// when receiving your name and colour, update state
	hostSocket.on(
		"data",
		(name: string, colour: string, uuid: string | null) => {
			hostUser = { name, colour, uuid };
			provideUser(provider); // provide the new data
		},
	);

	// on a new user list, update the sidebar
	hostSocket.on("presence", (users: any[]) => {
		presence = users;
		provider.postMsg({ presence: users });
	});

	// for the host, stores currently initialising files
	const initing = new Map<string, Promise<void>>();
	const initConns = new Map<string, { p: WebsocketProvider; d: Y.Doc }>();

	// when the room is deleted close the window and clear state
	hostSocket.on("roomDeleted", () => {
		provider.postMsg({ leftRoom: true });
		if (!isHost) {
			vscode.commands.executeCommand("workbench.action.closeFolder");
		}
		isHost = false;
		croom = null;
	});

	// when the host requests to initialise a file, the host inits it
	hostSocket.on("initFile", async (uri: string, id: string, callback) => {
		let pending = initing.get(id); // check if its already initing
		if (!pending) {
			// if it isn't
			pending = (async () => {
				// connect to the syncing server
				const doc = new Y.Doc();
				const provider = new WebsocketProvider(yjs_url, id, doc);
				initConns.set(id, { p: provider, d: doc });
				const ytext = doc.getText("content");
				await waitSync(provider);

				// if its not initialised, set its contents
				const meta = doc.getMap("meta");

				if (!meta.get("seeded")) {
					const bytes = await readFile(uri);
					doc.transact(() => {
						ytext.insert(0, toLf(new TextDecoder().decode(bytes)));
						meta.set("seeded", true);
					}, {});
				}
			})();
			initing.set(id, pending);
		}
		await pending;

		callback(); // once done, return
	});

	// once someone else in the room has connected, the init connection can be deleted
	hostSocket.on("connectedFile", (id: string) => {
		initing.delete(id);
		const conn = initConns.get(id);
		if (conn) {
			conn.p.destroy();
			conn.d.destroy();
		}
		initConns.delete(id);
	});

	// when a user saves a file, broadcast to the other users to also save their versions
	hostSocket.on("saveFile", async (file: string) => {
		const uri = getAbsoluteUri(file);
		if (!uri) {
			return;
		}
		const document = vscode.workspace.textDocuments.find(
			(d) => d.uri.toString() === uri.toString(),
		);
		if (!document || !document.isDirty) {
			return;
		}
		await document.save();
	});

	// these series of callbacks take in requests from other users to read and write data to the host's system.
	hostSocket.on("statFile", async (uri: string, callback) => {
		callback(await getFileStats(uri));
	});
	hostSocket.on("readDirectory", async (uri: string, callback) => {
		callback(await readDirectory(uri));
	});
	hostSocket.on("readFile", async (uri: string, callback) => {
		const content = await readFile(uri);
		callback(content && content.byteLength > maxSize ? undefined : content);
	});

	hostSocket.on("createDirectory", async (uri: string, callback) => {
		callback(await createDirectory(uri));
	});
	hostSocket.on(
		"writeFile",
		async (
			uri: string,
			content: Uint8Array,
			options: { readonly create: boolean; readonly overwrite: boolean },
			callback,
		) => {
			await writeFile(uri, content, options);

			// If the host has this file open, save it to clear the dirty indicator
			const absoluteUri = getAbsoluteUri(uri);
			if (absoluteUri) {
				const doc = vscode.workspace.textDocuments.find(
					(d) => d.uri.toString() === absoluteUri.toString(),
				);
				if (doc && doc.isDirty) {
					await doc.save();
				}
			}

			callback();
		},
	);
	hostSocket.on(
		"deleteFile",
		async (
			uri: string,
			options: { readonly recursive: boolean },
			callback,
		) => {
			callback(await deleteFile(uri, options));
		},
	);
	hostSocket.on(
		"renameFile",
		async (
			uri: string,
			newuri: string,
			options: { readonly overwrite: boolean },
			callback,
		) => {
			callback(await renameFile(uri, newuri, options));
		},
	);
}

// given a project id and name, open the window for it
function openProject(id: string, name: string) {
	const workspaceUri = vscode.Uri.parse(
		`${FILE_SYSTEM_SCHEME}://${encodeURIComponent(name)}/${encodeURIComponent(name)}`,
	).with({
		query: new URLSearchParams({ hid: chid ?? "", pid: id }).toString(),
	});
	vscode.commands.executeCommand("vscode.openFolder", workspaceUri, {
		forceNewWindow: false,
	});
}

const synced = new Map<string, SyncedFile>(); // stores all currently synced open files

// route opened files into the connection function
vscode.workspace.onDidOpenTextDocument(async (document) => {
	openDocument(document);
});

// sync all currently open files
function openDocuments() {
	// disconnect all currently synced files
	for (const s of synced.values()) {
		s.dispose();
	}
	synced.clear();
	opening.clear();

	// connect the current ones
	for (const document of vscode.workspace.textDocuments) {
		if (document.isUntitled) {
			continue;
		}
		openDocument(document);
	}
}

// stores all the currently opening files
const opening = new Set<string>();

// given a vscode file, sync it
function openDocument(document: vscode.TextDocument) {
	const path = document.uri.toString(); // get its path
	if (synced.has(path) || opening.has(path)) {
		return;
	}

	const file = getRelativePath(document.uri); // get its relative path
	if (!file || (!croom && !cprojectName) || !cyjs || !hostSocket) {
		return;
	}

	opening.add(path); // mark it as opening

	// request to open it from the host
	hostSocket.emit("openFile", file, async (id: string, wasInit: boolean) => {
		let s: SyncedFile | undefined;
		try {
			if (!cyjs || hostSocket === null) {
				return;
			}
			if (document.isClosed) {
				hostSocket.emit("closeFile", file, () => {});
				return;
			}
			// start a new synced file with the file
			s = await SyncedFile.create(
				hostSocket,
				cyjs,
				id,
				document,
				hostSocket.id ?? "none",
			);
		} finally {
			opening.delete(path); // finish opening
		}

		// if a host was initialising the file, let them know they can remove their connection
		if (wasInit) {
			hostSocket.emit("connectedFile", id);
		}

		// if the file was closed while opening, close the sync connection
		if (document.isClosed) {
			s.dispose();
			hostSocket.emit("closeFile", file, () => {});
			const reopened = vscode.workspace.textDocuments.find(
				(d) => d.uri.toString() === path,
			);
			if (reopened) {
				openDocument(reopened);
			}
			return;
		}

		synced.set(path, s); // store the connection
	});
}

// when closing a file, close the syncing connection
vscode.workspace.onDidCloseTextDocument((document) => {
	const path = document.uri.toString();
	const s = synced.get(path);
	if (!s) {
		return;
	}
	synced.delete(path);
	s.dispose();
	const file = getRelativePath(document.uri);
	if (file && hostSocket !== null) {
		hostSocket.emit("closeFile", file, () => {});
	}
});

export function deactivate() {}
