import * as vscode from 'vscode';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { positionIn, toLf, User, waitSync } from './utils';
import diff from 'fast-diff';
import { Socket } from 'socket.io-client';
import { cssColorToRGBA } from './rgb';

interface LocalEdit {
    version: number;
    changes: { offset: number, length: number, text: string }[]
}

export class SyncedFile implements vscode.Disposable {
    doc: Y.Doc;
    provider: WebsocketProvider;
    document: vscode.TextDocument;
    ytext: Y.Text;
    hostSocket: Socket;

    chain = Promise.resolve();
    subs: vscode.Disposable[] = [];

    localOrigin: object = {};

    mirror: Y.Doc;
    mtext: Y.Text;

    flushQueued = false;
    inflight: { version: number, update: Uint8Array } | null = null;
    held: LocalEdit[] = [];
    resetting = false;

    // whileReset = false;
    wasReset = false;
    // editing = false;
    // pendingRemote = 0;

    eol: vscode.EndOfLine;

    users = new Map<string, any>();
    cursorPending: vscode.TextEditor | undefined;

    carets = new Map<number, vscode.TextEditorDecorationType>();
    bands = new Map<number, vscode.TextEditorDecorationType>();

    disposed = false;

    private constructor(hostSocket: Socket, doc: Y.Doc, provider: WebsocketProvider, document: vscode.TextDocument) {
        this.hostSocket = hostSocket;
        this.doc = doc;
        this.provider = provider;
        this.document = document;
        this.ytext = doc.getText('content');

        this.mirror = new Y.Doc();
        this.mtext = this.mirror.getText('content');

        this.mirror.on('update', this.mirrorUpdate);

        this.eol = document.eol;
    }

    static async create(hostSocket: Socket, url: string, id: string, document: vscode.TextDocument, userId: string) {
        const doc = new Y.Doc();
        const provider = new WebsocketProvider(url, id, doc);
        const file = new SyncedFile(hostSocket, doc, provider, document);

        file.ytext.observe(file.remoteChange);

        file.provider.awareness.on('change', file.awarenessChange);

        file.subs.push(vscode.window.onDidChangeActiveTextEditor(() => file.awarenessChange()));
        file.subs.push(vscode.workspace.onDidChangeTextDocument(file.localChange));

        await waitSync(provider);

        file.chain = file.chain.then(() => file.reset());
        await file.chain;

        // await file.check();

        file.provider.awareness.setLocalStateField('user', userId);

        file.subs.push(vscode.window.onDidChangeTextEditorSelection(file.selectionChange));

        file.awarenessChange();

        return file;
    }

    private mirrorUpdate = (update: Uint8Array, origin: unknown) => {
        this.awarenessChange();
        if (origin === this) { return; }
        Y.applyUpdate(this.doc, update, this.localOrigin);
    };

    private localChange = (event: vscode.TextDocumentChangeEvent) => {
        if (this.disposed || this.resetting) { return; }
        if (event.document.uri.toString() !== this.document.uri.toString()) { return; }
        if (event.contentChanges.length === 0) { return; }

        const crlf = this.eol === vscode.EndOfLine.CRLF;
        this.eol = event.document.eol;

        const edit = {
            version: event.document.version,
            changes: event.contentChanges.map((c) => ({
                offset: c.rangeOffset - (crlf ? c.range.start.line : 0),
                length: c.rangeLength - (crlf ? c.range.end.line - c.range.start.line : 0),
                text: toLf(c.text)
            }))
        };

        if (this.inflight) {
            this.held.push(edit);
            return;
        }

        this.applyLocal(edit);
    };

    private applyLocal(edit: LocalEdit) {
        const changes = [...edit.changes].sort((a, b) => b.offset - a.offset);

        this.mirror.transact(() => {
            for (const c of changes) {
                if (c.length > 0 && c.length === c.text.length && this.mtext.toString().slice(c.offset, c.offset + c.length) === c.text) { continue; }
                if (c.length > 0) {
                    this.mtext.delete(c.offset, c.length);
                }
                if (c.text.length > 0) {
                    this.mtext.insert(c.offset, c.text);
                }
            }
        });
    }

    private remoteChange = (event: Y.YTextEvent) => {
        if (this.disposed) { return; }

        if (event.transaction.origin === this.localOrigin) { return; }

        this.scheduleFlush();
    };

    private scheduleFlush() {
        if (this.flushQueued) { return; }
        this.flushQueued = true;
        this.chain = this.chain.then(() => {
            this.flushQueued = false;
            return this.flush();
        }).catch(() => console.error("flush failed"));
    }

    private editUpdate(update: Uint8Array) {
        const text = this.mtext.toString();
        const prev = new Y.Doc();
        Y.applyUpdate(prev, Y.encodeStateAsUpdate(this.mirror));
        let delta: Y.YTextEvent["delta"] = [];
        prev.getText("content").observe((e) => { delta = e.delta; });
        Y.applyUpdate(prev, update);
        prev.destroy();

        const edit = new vscode.WorkspaceEdit();
        let offset = 0;
        for (const op of delta) {
            if (op.retain !== undefined) {
                offset += op.retain;
            } else if (typeof op.insert === "string") {
                edit.insert(this.document.uri, positionIn(text, offset), op.insert);
            } else if (op.delete !== undefined) {
                edit.delete(this.document.uri, new vscode.Range(
                    positionIn(text, offset),
                    positionIn(text, offset + op.delete)
                ));
                offset += op.delete;
            }
        }
        return edit;
    }

    private async flush() {
        if (!this.wasReset) { return; }

        for (let fails = 0; fails < 5;) {
            if (this.disposed || this.document.isClosed) { return; }

            if (toLf(this.document.getText()) !== this.mtext.toString()) {
                await this.reset();
                return;
            }

            const update = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.mirror));

            if (this.mtext.toString() === this.ytext.toString()) {
                Y.applyUpdate(this.mirror, update, this);
                return;
            }

            const edit = this.editUpdate(update);

            this.inflight = { version: this.document.version, update };
            let ok = false;
            try {
                ok = await vscode.workspace.applyEdit(edit);
            } catch {
                console.error("edit didn't work");
            }
            const inflight = this.inflight;
            this.inflight = null;
            const held = this.held;
            this.held = [];

            for (const e of held) {
                if (ok && e.version === inflight.version + 1) {
                    Y.applyUpdate(this.mirror, inflight.update, this);
                } else {
                    this.applyLocal(e);
                }
            }

            if (this.cursorPending) {
                const editor = this.cursorPending;
                this.cursorPending = undefined;
                this.selectionChange({ textEditor: editor, selections: editor.selections, kind: undefined});
            }

            if (!ok && held.length === 0) { fails++; }
        }

        console.log("edit failed");
        await this.reset();
    }

    private normaliseShare() {
        const text = this.ytext.toString();
        this.doc.transact(() => {
            for (let i = text.length - 1; i >= 0; i--) {
                if (text[i] !== '\r') { continue; }
                this.ytext.delete(i, 1);
                if (text[i + 1] !== '\n') { this.ytext.insert(i, '\n'); }
            }
        }, this.localOrigin);
    }

    private async reset() {
        if (this.disposed) { return; }
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.document.uri.toString());
        const selections = editor?.selections;

        let ok = false;
        this.resetting = true;
        try {
            for (let i = 0; i < 10; i++) {
                if (this.disposed || this.document.isClosed) { return; }
                if (this.ytext.toString().includes('\r')) {this.normaliseShare();}

                const target = this.ytext.toString();
                const current = toLf(this.document.getText());

                if (target === current) {
                    this.mirror.off('update', this.mirrorUpdate);
                    this.mirror.destroy();
                    this.mirror = new Y.Doc();
                    this.eol = this.document.eol;
                    this.mtext = this.mirror.getText('content');
                    Y.applyUpdate(this.mirror, Y.encodeStateAsUpdate(this.doc));
                    this.mirror.on('update', this.mirrorUpdate);
                    this.wasReset = true;
                    ok = true;
                    break;
                }

                const edit = new vscode.WorkspaceEdit();
                let offset = 0;
                for (const [op, text] of diff(current, target)) {
                    if (op === diff.INSERT) {
                        edit.insert(this.document.uri, positionIn(current, offset), text);
                    } else {
                        if (op === diff.DELETE) {
                            edit.delete(this.document.uri, new vscode.Range(
                                positionIn(current, offset),
                                positionIn(current, offset + text.length)
                            ));
                        }
                        offset += text.length;
                    }
                }

                try { await vscode.workspace.applyEdit(edit); } catch { };
            }
        } finally {
            this.resetting = false;
        }

        if (editor && selections) { editor.selections = selections; }

        if (ok && this.mtext.toString() !== this.ytext.toString()) { this.scheduleFlush(); }
    }

    private shareOffset(pos: vscode.Position) {
        return this.document.offsetAt(pos) - (this.document.eol === vscode.EndOfLine.CRLF ? pos.line : 0);
    }

    private selectionChange = (e: vscode.TextEditorSelectionChangeEvent) => {
        if (this.disposed) { return; }
        if (e.textEditor.document.uri.toString() !== this.document.uri.toString()) { return; }
        if (this.inflight) {
            this.cursorPending = e.textEditor;
            return;
        }

        const sel = e.selections[0];
        this.provider.awareness.setLocalStateField('cursor', {
            anchor: this.encodePos(this.shareOffset(sel.anchor)),
            head: this.encodePos(this.shareOffset(sel.active))
        });
    };

    private getCaret(clientId: number, colour: string) {
        let d = this.carets.get(clientId);
        if (!d) {
            d = vscode.window.createTextEditorDecorationType({
                borderWidth: '0 0 0 2px',
                borderStyle: 'solid',
                borderColor: colour,
            });
            this.carets.set(clientId, d);
        }
        return d;
    }

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

    private awarenessChange = async () => {
        if (this.disposed) { return; }

        const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.toString() === this.document.uri.toString()
        );
        if (!editor) { return; }

        // const length = this.document.getText().length;
        // const clamp = (i: number) => this.document.positionAt(Math.min(Math.max(i, 0), length));
        const text = this.mtext.toString();
        const clamp = (i: number) => positionIn(text, Math.min(Math.max(i, 0), text.length));

        const states = this.provider.awareness.getStates();
        const seen = new Set<number>();

        for (const [clientId, state] of states) {
            if (clientId === this.doc.clientID) { continue; }
            if (!state.cursor || !state.user) { continue; }

            let data = this.users.get(state.user);
            if (!data) {
                data = await this.hostSocket.emitWithAck("user", state.user);
                this.users.set(state.user, data);
            }

            const dc = cssColorToRGBA(data.colour);
            const bandColour = dc ? `rgba(${dc[0] * 255}, ${dc[1] * 255}, ${dc[2] * 255}, ${dc[3] / 4})` : `00000000`;

            seen.add(clientId);

            const head = this.decodePos(state.cursor.head);
            const anchor = this.decodePos(state.cursor.anchor);
            if (head === null) { continue; }

            const headPos = clamp(head);
            editor.setDecorations(this.getCaret(clientId, data.colour), [
                { range: new vscode.Range(headPos, headPos), hoverMessage: data.name }
            ]);

            const band = this.getBand(clientId, bandColour);
            if (anchor !== null && anchor !== head) {
                editor.setDecorations(band, [{ range: new vscode.Range(clamp(anchor), headPos), hoverMessage: data.name }]);
            } else {
                editor.setDecorations(band, []);
            }
        }

        for (const [clientId, d] of this.carets) {
            if (!seen.has(clientId)) {
                editor.setDecorations(d, []);
                d.dispose();
                this.carets.delete(clientId);
            }
        }

        for (const [clientId, d] of this.bands) {
            if (!seen.has(clientId)) {
                editor.setDecorations(d, []);
                d.dispose();
                this.bands.delete(clientId);
            }
        }
    };

    private encodePos(offset: number) {
        const rel = Y.createRelativePositionFromTypeIndex(this.mtext, offset, 0);
        return Array.from(Y.encodeRelativePosition(rel));
    }

    private decodePos(encoded: number[] | undefined): number | null {
        if (!encoded) { return null; }
        try {
            const rel = Y.decodeRelativePosition(new Uint8Array(encoded));
            const abs = Y.createAbsolutePositionFromRelativePosition(rel, this.mirror);
            if (!abs || abs.type !== this.mtext) { return null; }
            return abs.index;
        } catch {
            return null;
        }
    }

    dispose() {
        if (this.disposed) { return; }
        this.disposed = true;

        this.ytext.unobserve(this.remoteChange);
        for (const s of this.subs) { s.dispose(); }
        this.subs = [];

        this.provider.awareness.off('change', this.awarenessChange);

        for (const d of this.carets.values()) { d.dispose(); }
        this.carets.clear();

        for (const d of this.bands.values()) { d.dispose(); }
        this.bands.clear();

        this.provider.destroy();
        this.doc.destroy();

        this.mirror.destroy();
    }
}