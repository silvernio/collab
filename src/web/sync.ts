import * as vscode from 'vscode';

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { User, waitSync } from './utils';
import diff from 'fast-diff';

export class SyncedFile implements vscode.Disposable {
    doc: Y.Doc;
    provider: WebsocketProvider;
    document: vscode.TextDocument;
    ytext: Y.Text;

    chain = Promise.resolve();
    subs: vscode.Disposable[] = [];

    localOrigin: object = {};

    whileReset = false;
    wasReset = false;
    editing = false;
    // pendingRemote = 0;

    carets = new Map<number, vscode.TextEditorDecorationType>();
    bands = new Map<number, vscode.TextEditorDecorationType>();

    disposed = false;

    private constructor(doc: Y.Doc, provider: WebsocketProvider, document: vscode.TextDocument) {
        this.doc = doc;
        this.provider = provider;
        this.document = document;
        this.ytext = doc.getText('content');
    }

    static async create(url: string, id: string, document: vscode.TextDocument, user: User) {
        const doc = new Y.Doc();
        const provider = new WebsocketProvider(url, id, doc);
        const file = new SyncedFile(doc, provider, document);

        file.ytext.observe(file.remoteChange);

        file.provider.awareness.on('change', file.awarenessChange);

        file.subs.push(vscode.window.onDidChangeActiveTextEditor(() => file.awarenessChange()));

        await waitSync(provider);

        // vscode.window.showInformationMessage("hopefully");

        // const meta = doc.getMap('meta');

        // if (!meta.get('seeded')) {
        //     doc.transact(() => {
        //         file.ytext.insert(0, content);
        //         meta.set('seeded', true);
        //     }, file.localOrigin);
        // } else {
        //     const existing = file.ytext.toString();

        //     if (document.getText() !== existing) {
        //         const fullRange = new vscode.Range(
        //             document.positionAt(0),
        //             document.positionAt(document.getText().length),
        //         );

        //         const edit = new vscode.WorkspaceEdit();
        //         edit.replace(document.uri, fullRange, existing);

        //         await vscode.workspace.applyEdit(edit);
        //     }
        // }

        file.chain = file.chain.then(() => file.reset());
        await file.chain;

        file.subs.push(vscode.workspace.onDidChangeTextDocument(file.localChange));

        await file.check();

        file.provider.awareness.setLocalStateField('user', user);

        file.subs.push(vscode.window.onDidChangeTextEditorSelection(file.selectionChange));

        file.awarenessChange();

        return file;
    }

    private localChange = (event: vscode.TextDocumentChangeEvent) => {
        if (this.disposed) { return; }
        if (event.document.uri.toString() !== this.document.uri.toString()) { return; }
        if (event.contentChanges.length === 0) { return; }

        if (this.editing && event.document.getText() === this.ytext.toString()) {
            return;
        }

        const changes = [...event.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);

        this.doc.transact(() => {
            for (const c of changes) {
                if (c.rangeLength > 0) { this.ytext.delete(c.rangeOffset, c.rangeLength); }
                if (c.text.length > 0) { this.ytext.insert(c.rangeOffset, c.text); }
            }
        }, this.localOrigin);

        console.log('LOCAL', {
            changes: event.contentChanges.map(c => [c.rangeOffset, c.rangeLength, c.text]),
            ylen: this.ytext.length,
            doclen: event.document.getText().length,
        });
    };

    private remoteChange = (event: Y.YTextEvent) => {
        if (this.disposed) { return; }

        console.log('REMOTE', {
            origin: event.transaction.origin === this.localOrigin ? 'self' : 'peer',
            delta: event.delta,
            wasReset: this.wasReset,
        });

        if (event.transaction.origin === this.localOrigin) { return; }

        // const delta = event.delta;

        // if (!this.wasReset) {
        //     this.whileReset = true;
        //     return;
        // }

        this.chain = this.chain.then(() => this.syncDocument()).catch(() => this.syncDocument());
    };

    private async syncDocument() {
        if (this.disposed || this.document.isClosed) { return; }

        const target = this.ytext.toString();
        const current = this.document.getText();
        if (target === current) { return; }

        const edit = new vscode.WorkspaceEdit();
        let offset = 0;

        for (const [op, text] of diff(current, target)) {
            if (op === diff.EQUAL) {
                offset += text.length;
            } else if (op === diff.INSERT) {
                edit.insert(this.document.uri, this.document.positionAt(offset), text);
            } else {
                edit.delete(this.document.uri, new vscode.Range(
                    this.document.positionAt(offset),
                    this.document.positionAt(offset + text.length)
                ));
            }
        }

        this.editing = true;
        try {
            const ok = await vscode.workspace.applyEdit(edit);
            if (!ok) { throw new Error('failed'); }
        } finally {
            this.editing = false;
        }
    }

    // private async applyDelta(delta: Y.YTextEvent['delta']) {
    //     if (this.disposed) { return; }

    //     const before = this.document.getText();

    //     const edit = new vscode.WorkspaceEdit();
    //     let offset = 0;

    //     for (const op of delta) {
    //         if (op.retain !== undefined) {
    //             offset += op.retain;
    //         } else if (typeof op.insert === 'string') {
    //             edit.insert(this.document.uri, this.document.positionAt(offset), op.insert);
    //         } else if (op.delete !== undefined) {
    //             edit.delete(this.document.uri, new vscode.Range(this.document.positionAt(offset), this.document.positionAt(offset + op.delete)));
    //             offset += op.delete;
    //         }
    //     }

    //     await this.editSafe(edit);

    //     const after = this.document.getText();
    //     const target = this.ytext.toString();
    //     if (after !== target) {
    //         console.log('DIVERGED', {
    //             delta: JSON.stringify(delta),
    //             beforeLen: before.length,
    //             afterLen: after.length,
    //             targetLen: target.length,
    //             after: after.slice(0, 120),
    //             target: target.slice(0, 120),
    //         });
    //     }
    // }

    // private async reset() {
    //     if (this.disposed) { return; }

    //     const incoming = this.ytext.toString();
    //     const current = this.document.getText();

    //     this.wasReset = true;

    //     if (current === incoming) { return; }

    //     const edit = new vscode.WorkspaceEdit();
    //     edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(0), this.document.positionAt(current.length)), incoming);

    //     const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.document.uri.toString());
    //     const selections = editor?.selections;

    //     await this.editSafe(edit);

    //     if (editor && selections) { editor.selections = selections; }
    // }

    private async reset() {
        if (this.disposed) { return; }
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.document.uri.toString());
        const selections = editor?.selections;

        await this.syncDocument();
        this.wasReset = true;

        if (editor && selections) { editor.selections = selections; }
    }

    // private async editSafe(edit: vscode.WorkspaceEdit) {
    //     this.pendingRemote++;
    //     try {
    //         const ok = await vscode.workspace.applyEdit(edit);
    //         if (!ok) { throw new Error('failed'); }
    //     } finally {
    //         this.pendingRemote = Math.max(0, this.pendingRemote - 1);
    //     }
    // }

    private async check() {
        if (this.disposed) { return; }

        await this.chain;

        if (this.whileReset || this.document.getText() !== this.ytext.toString()) {
            this.whileReset = false;
            this.chain = this.chain.then(() => this.reset());
            await this.chain;
        }
    }

    private selectionChange = (e: vscode.TextEditorSelectionChangeEvent) => {
        if (this.disposed) { return; }
        if (e.textEditor.document.uri.toString() !== this.document.uri.toString()) { return; }

        const sel = e.selections[0];
        this.provider.awareness.setLocalStateField('cursor', {
            anchor: this.encodePos(this.document.offsetAt(sel.anchor)),
            head: this.encodePos(this.document.offsetAt(sel.active))
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

    private awarenessChange = () => {
        if (this.disposed) { return; }

        const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.toString() === this.document.uri.toString()
        );
        if (!editor) { return; }

        const length = this.document.getText().length;
        const clamp = (i: number) => this.document.positionAt(Math.min(Math.max(i, 0), length));

        const states = this.provider.awareness.getStates();
        const seen = new Set<number>();

        for (const [clientId, state] of states) {
            if (clientId === this.doc.clientID) { continue; }
            if (!state.cursor || !state.user) { continue; }
            seen.add(clientId);

            const head = this.decodePos(state.cursor.head);
            const anchor = this.decodePos(state.cursor.anchor);
            if (head === null) { continue; }

            const headPos = clamp(head);
            editor.setDecorations(this.getCaret(clientId, state.user.colour), [
                { range: new vscode.Range(headPos, headPos), hoverMessage: state.user.name }
            ]);

            const band = this.getBand(clientId, state.user.bandColour);
            if (anchor !== null && anchor !== head) {
                editor.setDecorations(band, [new vscode.Range(clamp(anchor), headPos)]);
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
        const rel = Y.createRelativePositionFromTypeIndex(this.ytext, offset, 0);
        return Array.from(Y.encodeRelativePosition(rel));
    }

    private decodePos(encoded: number[] | undefined): number | null {
        if (!encoded) { return null; }
        try {
            const rel = Y.decodeRelativePosition(new Uint8Array(encoded));
            const abs = Y.createAbsolutePositionFromRelativePosition(rel, this.doc);
            if (!abs || abs.type !== this.ytext) { return null; }
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
    }
}