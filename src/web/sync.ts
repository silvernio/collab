import * as vscode from "vscode";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { positionIn, toLf, waitSync } from "./utils";
import diff from "fast-diff";
import { Socket } from "socket.io-client";
import { cssColorToRGBA } from "./rgb";

// this stores a local edit to a file from the user
interface LocalEdit {
	version: number; // the version of the file it's for (like the time)
	changes: { offset: number; length: number; text: string }[]; // the list of actual editor changes
}

// this class takes a host socket, vscode file, and the user data,
// and manages a synced state on the yjs server to sync all the content and user cursors
export class SyncedFile implements vscode.Disposable {
	doc: Y.Doc; // the shared object for this file
	provider: WebsocketProvider; // the connection the syncing server
	document: vscode.TextDocument; // the vscode document with the file open
	ytext: Y.Text; // the actual synced content of the file
	hostSocket: Socket; // the connection to the host

	chain = Promise.resolve(); // stores the list of actions to do in the form of promises
	subs: vscode.Disposable[] = []; // subscriptions, just stores a bunch of objects that once this synced file is closed, are disposed (deleted)

	localOrigin: object = {}; // an empty object acts as an id for this user

	mirror: Y.Doc; // a second copy of the shared file, only for the local edits vs remote edits
	mtext: Y.Text; // the content of the mirror synced file

	flushQueued = false; // whether a sync is queued
	inflight: { version: number; update: Uint8Array } | null = null; // the edit currently in progress
	held: LocalEdit[] = []; // stores queued edits
	resetting = false; // whether the file is current resetting

	wasReset = false; // if a reset was done

	eol: vscode.EndOfLine; // this stores the character used for the end of a line in this file

	users = new Map<string, any>(); // stores the fetched user data from the auth server for cursors
	cursorPending: vscode.TextEditor | undefined; // stores the editor that a pending change is in

	carets = new Map<number, vscode.TextEditorDecorationType>(); // stores the cursors of each user
	bands = new Map<number, vscode.TextEditorDecorationType>(); // stores the selections of each user

	disposed = false; // whether or not the synced file is deleted

	// given the host socket, a shared yjs document and connection, with the vscode document, create the synced file
	private constructor(
		hostSocket: Socket,
		doc: Y.Doc,
		provider: WebsocketProvider,
		document: vscode.TextDocument,
	) {
		// set class properties
		this.hostSocket = hostSocket;
		this.doc = doc;
		this.provider = provider;
		this.document = document;
		this.ytext = doc.getText("content"); // get the actual synced text

		// create the mirror
		this.mirror = new Y.Doc();
		this.mtext = this.mirror.getText("content");

		// when a change happens on the mirror, update
		this.mirror.on("update", this.mirrorUpdate);

		// store the character used for the end of line for this file
		this.eol = document.eol;
	}

	// given a host socket, the yjs url, the id of the file, vscode document, and user id, create & return a new synced file
	static async create(
		hostSocket: Socket,
		url: string,
		id: string,
		document: vscode.TextDocument,
		userId: string,
	) {
		const doc = new Y.Doc(); // create the new synced document
		const provider = new WebsocketProvider(url, id, doc); // connect to the yjs server
		const file = new SyncedFile(hostSocket, doc, provider, document); // initialise the synced file

		// when someone else changes the file contents, trigger the remoteChange function
		file.ytext.observe(file.remoteChange);

		// when someone moves their cursor / selection, render cursors
		file.provider.awareness.on("change", file.awarenessChange);

		// when the user switches the file they have visible, render the cursors
		file.subs.push(
			vscode.window.onDidChangeActiveTextEditor(() =>
				file.awarenessChange(),
			),
		);
		// when the user edits the file, trigger the localChange function
		file.subs.push(
			vscode.workspace.onDidChangeTextDocument(file.localChange),
		);

		await waitSync(provider); // wait for the connection to the yjs server

		// add a file reset to the queue of actions
		file.chain = file.chain.then(() => file.reset());
		await file.chain; // wait for it to reset

		file.provider.awareness.setLocalStateField("user", userId); // sync the user id on the yjs server

		// when the user moves their cursor, trigger the selectionChange function
		file.subs.push(
			vscode.window.onDidChangeTextEditorSelection(file.selectionChange),
		);

		file.awarenessChange(); // intially render cursors

		return file; // return the new synced file
	}

	// when the mirror is updated, re render cursors, and push it to the real synced doc
	private mirrorUpdate = (update: Uint8Array, origin: unknown) => {
		this.awarenessChange();
		if (origin === this) {
			return;
		}
		Y.applyUpdate(this.doc, update, this.localOrigin);
	};

	// when the user edits the file, extract their edit and applyLocal with it
	private localChange = (event: vscode.TextDocumentChangeEvent) => {
		// if the file is deleted or resetting ignore it
		if (this.disposed || this.resetting) {
			return;
		}
		// if the change wasn't in this document, don't sync it
		if (event.document.uri.toString() !== this.document.uri.toString()) {
			return;
		}
		// if no changes, don't sync it
		if (event.contentChanges.length === 0) {
			return;
		}

		// find their end of line character
		const crlf = this.eol === vscode.EndOfLine.CRLF;
		this.eol = event.document.eol;

		// create a new LocalEdit with their changes
		const edit = {
			version: event.document.version,
			changes: event.contentChanges.map((c) => ({
				offset: c.rangeOffset - (crlf ? c.range.start.line : 0),
				length:
					c.rangeLength -
					(crlf ? c.range.end.line - c.range.start.line : 0),
				text: toLf(c.text),
			})),
		};

		if (this.inflight) {
			this.held.push(edit);
			return;
		}

		this.applyLocal(edit); // apply the edit
	};

	// given a local edit, apply the changes to the mirror
	private applyLocal(edit: LocalEdit) {
		// first sort the changes ascending down the document
		const changes = [...edit.changes].sort((a, b) => b.offset - a.offset);

		// apply the change to the mirror
		this.mirror.transact(() => {
			// for each local change, calculate the text change and positioning
			for (const c of changes) {
				if (
					c.length > 0 &&
					c.length === c.text.length &&
					this.mtext
						.toString()
						.slice(c.offset, c.offset + c.length) === c.text
				) {
					continue;
				}
				if (c.length > 0) {
					this.mtext.delete(c.offset, c.length);
				}
				if (c.text.length > 0) {
					this.mtext.insert(c.offset, c.text);
				}
			}
		});
	}

	// on receiving a change from other users, schedule a sync
	private remoteChange = (event: Y.YTextEvent) => {
		if (this.disposed) {
			// if the synced file is deleted, ignore it
			return;
		}
		// if it's actually your change, don't sync it
		if (event.transaction.origin === this.localOrigin) {
			return;
		}

		this.scheduleFlush(); // schedule the sync
	};

	// queue a full sync of the file
	private scheduleFlush() {
		// if a sync is already queued, don't bother
		if (this.flushQueued) {
			return;
		}
		this.flushQueued = true; // a sync is running now
		// add the flush onto the even chain
		this.chain = this.chain
			.then(() => {
				this.flushQueued = false;
				return this.flush();
			})
			.catch(() => console.error("flush failed"));
	}

	// given the text of an update, convert it to a vscode edit
	private editUpdate(update: Uint8Array) {
		const text = this.mtext.toString();
		const prev = new Y.Doc();
		Y.applyUpdate(prev, Y.encodeStateAsUpdate(this.mirror));
		let delta: Y.YTextEvent["delta"] = [];
		prev.getText("content").observe((e) => {
			delta = e.delta;
		});
		Y.applyUpdate(prev, update);
		prev.destroy();

		const edit = new vscode.WorkspaceEdit();
		let offset = 0;
		for (const op of delta) {
			if (op.retain !== undefined) {
				offset += op.retain;
			} else if (typeof op.insert === "string") {
				edit.insert(
					this.document.uri,
					positionIn(text, offset),
					op.insert,
				);
			} else if (op.delete !== undefined) {
				edit.delete(
					this.document.uri,
					new vscode.Range(
						positionIn(text, offset),
						positionIn(text, offset + op.delete),
					),
				);
				offset += op.delete;
			}
		}
		return edit;
	}

	// sync the contents of the file with the server
	private async flush() {
		if (!this.wasReset) {
			// if the contents of a file were reset, don't bother syncing
			return;
		}

		// 5 tries to sync the file
		for (let fails = 0; fails < 5;) {
			// if the file is deleted or closed, don't try to sync
			if (this.disposed || this.document.isClosed) {
				return;
			}

			// if the text in vscode doesn't match the mirror's synced text, reset the document
			if (toLf(this.document.getText()) !== this.mtext.toString()) {
				await this.reset();
				return;
			}

			// get the difference between the mirror and synced server document
			const update = Y.encodeStateAsUpdate(
				this.doc,
				Y.encodeStateVector(this.mirror),
			);

			// if they are equal, sync the mirror
			if (this.mtext.toString() === this.ytext.toString()) {
				Y.applyUpdate(this.mirror, update, this);
				return;
			}

			const edit = this.editUpdate(update); // convert the update to a vscode edit

			// store the currently applying edit
			this.inflight = { version: this.document.version, update };
			let ok = false;
			try {
				ok = await vscode.workspace.applyEdit(edit);
			} catch {
				console.error("edit didn't work");
			}
			const inflight = this.inflight;
			this.inflight = null; // clear it
			const held = this.held;
			this.held = []; // clear the edit

			// apply all other edits
			for (const e of held) {
				if (ok && e.version === inflight.version + 1) {
					Y.applyUpdate(this.mirror, inflight.update, this);
				} else {
					this.applyLocal(e);
				}
			}

			// if the edit had a editor, apply it and clear the stored editor
			if (this.cursorPending) {
				const editor = this.cursorPending;
				this.cursorPending = undefined;
				this.selectionChange({
					textEditor: editor,
					selections: editor.selections,
					kind: undefined,
				});
			}

			// if the didn't apply and nothing is queued, count it as a fail
			if (!ok && held.length === 0) {
				fails++;
			}
		}

		// if a sync fails, reset the file
		console.log("edit failed");
		await this.reset();
	}

	// scan the file for line endings and correct them to all be \n
	private normaliseShare() {
		const text = this.ytext.toString();
		this.doc.transact(() => {
			for (let i = text.length - 1; i >= 0; i--) {
				if (text[i] !== "\r") {
					continue;
				}
				this.ytext.delete(i, 1);
				if (text[i + 1] !== "\n") {
					this.ytext.insert(i, "\n");
				}
			}
		}, this.localOrigin);
	}

	// reset the file in the vscode editor to match the yjs syncing server
	private async reset() {
		if (this.disposed) {
			// don't do it if the file is deleted
			return;
		}
		// find the open editor
		const editor = vscode.window.visibleTextEditors.find(
			(e) => e.document.uri.toString() === this.document.uri.toString(),
		);
		const selections = editor?.selections; // cursor selections

		let ok = false;
		this.resetting = true;
		// try 10 times to reset the contents
		try {
			for (let i = 0; i < 10; i++) {
				if (this.disposed || this.document.isClosed) {
					// don't reset if the file is closed or deleted
					return;
				}
				if (this.ytext.toString().includes("\r")) {
					// if it contains weird line ending characters, correct it
					this.normaliseShare();
				}

				const target = this.ytext.toString(); // the synced up to date contents
				const current = toLf(this.document.getText()); // what's in the vscode editor

				// if they are the same, just reset the mirror
				if (target === current) {
					this.mirror.off("update", this.mirrorUpdate);
					this.mirror.destroy();
					this.mirror = new Y.Doc();
					this.eol = this.document.eol;
					this.mtext = this.mirror.getText("content");
					Y.applyUpdate(this.mirror, Y.encodeStateAsUpdate(this.doc));
					this.mirror.on("update", this.mirrorUpdate);
					this.wasReset = true;
					ok = true;
					break;
				}

				// else, get the difference between the yjs synced version and the vscode editor, and apply it
				const edit = new vscode.WorkspaceEdit();
				let offset = 0;
				for (const [op, text] of diff(current, target)) {
					if (op === diff.INSERT) {
						edit.insert(
							this.document.uri,
							positionIn(current, offset),
							text,
						);
					} else {
						if (op === diff.DELETE) {
							edit.delete(
								this.document.uri,
								new vscode.Range(
									positionIn(current, offset),
									positionIn(current, offset + text.length),
								),
							);
						}
						offset += text.length;
					}
				}

				try {
					await vscode.workspace.applyEdit(edit);
				} catch {}
			}
		} finally {
			this.resetting = false;
		}

		// reapply cursor selections
		if (editor && selections) {
			editor.selections = selections;
		}

		// if it's still not synced, sync again
		if (ok && this.mtext.toString() !== this.ytext.toString()) {
			this.scheduleFlush();
		}
	}

	// correct an offset with the weird line endings
	private shareOffset(pos: vscode.Position) {
		return (
			this.document.offsetAt(pos) -
			(this.document.eol === vscode.EndOfLine.CRLF ? pos.line : 0)
		);
	}

	// when the user changes their cursor selection, sync it
	private selectionChange = (e: vscode.TextEditorSelectionChangeEvent) => {
		if (this.disposed) {
			// don't do it if the file is deleted
			return;
		}
		if (
			e.textEditor.document.uri.toString() !==
			this.document.uri.toString()
		) {
			// don't do it if this file isn't the one being edited
			return;
		}
		if (this.inflight) {
			// if a change is occuring, just put the cursor in queue
			this.cursorPending = e.textEditor;
			return;
		}

		// sync the cursor selection
		const sel = e.selections[0];
		this.provider.awareness.setLocalStateField("cursor", {
			anchor: this.encodePos(this.shareOffset(sel.anchor)),
			head: this.encodePos(this.shareOffset(sel.active)),
		});
	};

	// given a synced user id, and their colour, add them to the cursor object
	private getCaret(clientId: number, colour: string) {
		let d = this.carets.get(clientId);
		if (!d) {
			d = vscode.window.createTextEditorDecorationType({
				borderWidth: "0 0 0 2px",
				borderStyle: "solid",
				borderColor: colour,
			});
			this.carets.set(clientId, d);
		}
		return d;
	}

	// given a synced user id, and their colour, add them to the selection object
	private getBand(clientId: number, colour: string) {
		let d = this.bands.get(clientId);
		if (!d) {
			d = vscode.window.createTextEditorDecorationType({
				backgroundColor: colour,
			});
			this.bands.set(clientId, d);
		}
		return d;
	}

	// when someone else in the room moves their cursor, render all cursors again
	private awarenessChange = async () => {
		if (this.disposed) {
			// don't render if the document is deleted
			return;
		}

		// find the editor
		const editor = vscode.window.visibleTextEditors.find(
			(e) => e.document.uri.toString() === this.document.uri.toString(),
		);
		if (!editor) {
			// don't render if the editor doesn't exist
			return;
		}

		const text = this.mtext.toString();
		const clamp = (i: number) =>
			positionIn(text, Math.min(Math.max(i, 0), text.length));

		// get user data for cursors
		const states = this.provider.awareness.getStates();
		const seen = new Set<number>(); // the rendered cursors

		// for each set of user data, fetch it's data, and render it
		for (const [clientId, state] of states) {
			// if the cursor is yours, don't render it
			if (clientId === this.doc.clientID) {
				continue;
			}
			// if there's no data attached, don't bother
			if (!state.cursor || !state.user) {
				continue;
			}

			// get their cached user data
			let data = this.users.get(state.user);
			if (!data) {
				data = await this.hostSocket.emitWithAck("user", state.user); // otherwise, fetch from the host
				this.users.set(state.user, data);
			}

			// convert their css string colour to rgba
			const dc = cssColorToRGBA(data.colour);
			// transprent same colour
			const bandColour = dc
				? `rgba(${dc[0] * 255}, ${dc[1] * 255}, ${dc[2] * 255}, ${dc[3] / 4})`
				: `00000000`;

			seen.add(clientId); // mark it as rendered

			// position it
			const head = this.decodePos(state.cursor.head);
			const anchor = this.decodePos(state.cursor.anchor);
			if (head === null) {
				continue;
			}

			// render the cursor
			const headPos = clamp(head);
			editor.setDecorations(this.getCaret(clientId, data.colour), [
				{
					range: new vscode.Range(headPos, headPos),
					hoverMessage: data.name,
				},
			]);

			// render the selection
			const band = this.getBand(clientId, bandColour);
			if (anchor !== null && anchor !== head) {
				editor.setDecorations(band, [
					{
						range: new vscode.Range(clamp(anchor), headPos),
						hoverMessage: data.name,
					},
				]);
			} else {
				editor.setDecorations(band, []);
			}
		}

		// clear previous cursors
		for (const [clientId, d] of this.carets) {
			if (!seen.has(clientId)) {
				editor.setDecorations(d, []);
				d.dispose();
				this.carets.delete(clientId);
			}
		}

		// clear previous selections
		for (const [clientId, d] of this.bands) {
			if (!seen.has(clientId)) {
				editor.setDecorations(d, []);
				d.dispose();
				this.bands.delete(clientId);
			}
		}
	};

	// given a document position in the file, find where it is on the synced file
	private encodePos(offset: number) {
		const rel = Y.createRelativePositionFromTypeIndex(
			this.mtext,
			offset,
			0,
		);
		return Array.from(Y.encodeRelativePosition(rel));
	}

	// do the opposite of encodePos
	private decodePos(encoded: number[] | undefined): number | null {
		if (!encoded) {
			return null;
		}
		try {
			const rel = Y.decodeRelativePosition(new Uint8Array(encoded));
			const abs = Y.createAbsolutePositionFromRelativePosition(
				rel,
				this.mirror,
			);
			if (!abs || abs.type !== this.mtext) {
				return null;
			}
			return abs.index;
		} catch {
			return null;
		}
	}

	// delete the synced file
	dispose() {
		if (this.disposed) {
			return;
		}
		this.disposed = true;

		this.ytext.unobserve(this.remoteChange);
		for (const s of this.subs) {
			s.dispose();
		}
		this.subs = [];

		this.provider.awareness.off("change", this.awarenessChange);

		for (const d of this.carets.values()) {
			d.dispose();
		}
		this.carets.clear();

		for (const d of this.bands.values()) {
			d.dispose();
		}
		this.bands.clear();

		this.provider.destroy();
		this.doc.destroy();

		this.mirror.destroy();
	}
}
