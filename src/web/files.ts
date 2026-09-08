import { Socket } from 'socket.io-client';
import * as vscode from 'vscode';

export class CollabFs implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;
    socket!: Socket;

    private resolveReady!: () => void;
    private ready = new Promise<void>(resolve => {
        this.resolveReady = resolve;
    });

    setSocket(socket: Socket) {
        this.socket = socket;
        this.resolveReady();
    }

    private toRoomPath(uri: vscode.Uri): string {
        const parts = uri.path.split('/').filter(p => p.length > 0);
        parts.shift();
        return '/' + parts.join('/');
    }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    requestStat(path: string): Promise<vscode.FileStat> {
        return new Promise((resolve, reject) => {
            this.socket.emit('statFile', path, (stat?: vscode.FileStat) => {
                if (!stat) { return reject('server error'); }
                resolve(stat);
            });
        });
    }
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        await this.ready;

        try {
            const fileStat = await this.requestStat(this.toRoomPath(uri));
            return fileStat;
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    // async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    //     const path = this.toRoomPath(uri);
    //     if (path === '/') {
    //         return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    //     }
    //     throw vscode.FileSystemError.FileNotFound(uri);
    // }

    requestDirectory(path: string): Promise<[string, vscode.FileType][]> {
        return new Promise((resolve, reject) => {
            this.socket.emit('readDirectory', path, (files?: [string, vscode.FileType][]) => {
                if (!files) { return reject('server error'); }
                resolve(files);
            });
        });
    }
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        await this.ready;

        const path = this.toRoomPath(uri);
        // vscode.window.showInformationMessage("read dir " + path);
        try {
            const files = await this.requestDirectory(path);
            return files;
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    // async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    //     const path = this.toRoomPath(uri);
    //     if (path === '/') {
    //         return [];
    //     }
    //     throw vscode.FileSystemError.FileNotFound(uri);
    // }

    requestFile(path: string): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            this.socket.emit('readFile', path, (file?: any) => {
                const toBytes = (d: any): Uint8Array =>
                    ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
                        : new Uint8Array(d);
                if (!file) { return reject('server error'); }
                resolve(toBytes(file));
            });

        });
    }
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        await this.ready;

        try {
            const file = await this.requestFile(this.toRoomPath(uri));
            return file;
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    requestWriteFile(path: string, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.socket.emit('writeFile', path, content, options, () => {
                resolve();
            });
        });
    }
    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        await this.ready;
        await this.requestWriteFile(this.toRoomPath(uri), content, options);
        return;
    }

    requestCreateDirectory(path: string): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.socket.emit('createDirectory', path, () => {
                resolve();
            });
        });
    }
    async createDirectory(uri: vscode.Uri): Promise<void> {
        await this.ready;
        await this.requestCreateDirectory(this.toRoomPath(uri));
        return;
    }

    requestDeleteFile(path: string, options: { readonly recursive: boolean; }): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.socket.emit('deleteFile', path, options, () => {
                resolve();
            });
        });
    }
    async delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): Promise<void> {
        await this.ready;
        await this.requestDeleteFile(this.toRoomPath(uri), options);
        return;
    }

    requestRenameFile(path: string, newPath: string, options: { readonly overwrite: boolean; }): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.socket.emit('renameFile', path, newPath, options, () => {
                resolve();
            });
        });
    }
    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): Promise<void> {
        await this.ready;
        await this.requestRenameFile(this.toRoomPath(oldUri), this.toRoomPath(newUri), options);
        return;
    }
}