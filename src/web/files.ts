import { Socket } from "socket.io-client";
import * as vscode from "vscode";

// the max size of a file that can be sent over the network / stored in a project
export const maxSize = 50 * 1024 * 1024 - 4096;

// this class essentially acts a file system when you have a window open under the collab namespace,
// all file commands are routed into here
export class CollabFs implements vscode.FileSystemProvider {
	// this emitter would be used to support file watching, but i couldn't find a use for actually implmementing it
	// so it's just empty for now
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	readonly onDidChangeFile = this._emitter.event;

	// this stores the connection to the host, for requesting files and that
	socket!: Socket;

	// this promise function waits until resolveReady is called on the class, using the resolve property of promises
	private resolveReady!: () => void;
	private ready = new Promise<void>((resolve) => {
		this.resolveReady = resolve;
	});

	// given the host socket, store a reference and release all awaits
	setSocket(socket: Socket) {
		this.socket = socket;
		this.resolveReady();
	}

	// given a requested path, convert it to a relative path
	private toRoomPath(uri: vscode.Uri): string {
		// remove empty paths
		const parts = uri.path.split("/").filter((p) => p.length > 0);
		// remove the starting /
		parts.shift();
		// add it again, and join the paths
		return "/" + parts.join("/");
	}

	// this would be used for file watching, but doesn't do anything rn
	watch(): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	// given a path of a file, request it's properties from the host
	requestStat(path: string): Promise<vscode.FileStat> {
		return new Promise((resolve, reject) => {
			// uses the statFile event from the host socket
			this.socket.emit("statFile", path, (stat?: vscode.FileStat) => {
				if (!stat) {
					// if it fails, just return and error
					return reject("server error");
				}
				resolve(stat); // otherwise, return it
			});
		});
	}
	// given the path of a file, get it's properties
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		await this.ready; // wait for the host socket to connect

		// try to get the stats, if any errors happen, just return not found
		try {
			const fileStat = await this.requestStat(this.toRoomPath(uri));
			return fileStat;
		} catch {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	// given a path of a folder, get the list of files
	requestDirectory(path: string): Promise<[string, vscode.FileType][]> {
		return new Promise((resolve, reject) => {
			// use the readDirectory event on the host socket
			this.socket.emit(
				"readDirectory",
				path,
				(files?: [string, vscode.FileType][]) => {
					// same flow as requestStat
					if (!files) {
						return reject("server error");
					}
					resolve(files);
				},
			);
		});
	}
	// given a path of a folder, return it's list of files
	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		await this.ready; // wait for the host socket to connect

		const path = this.toRoomPath(uri); // format path
		// same flow as stat
		try {
			const files = await this.requestDirectory(path);
			return files;
		} catch {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	// given the path of a file, request it's content bytes
	requestFile(path: string): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			// use the readFile event
			this.socket.emit("readFile", path, (file?: any) => {
				// convert the byte data to a Uint8Array because that's what vscode wants
				const toBytes = (d: any): Uint8Array =>
					ArrayBuffer.isView(d)
						? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
						: new Uint8Array(d);
				// same flow as stat
				if (!file) {
					return reject("server error");
				}
				resolve(toBytes(file));
			});
		});
	}
	// given the path of a file, return it's contents
	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		await this.ready; // wait for the host socket to connect

		// same flow as stat
		try {
			const file = await this.requestFile(this.toRoomPath(uri));
			return file;
		} catch {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	// given a path and the content bytes, request to write the file
	requestWriteFile(
		path: string,
		content: Uint8Array,
		options: { readonly create: boolean; readonly overwrite: boolean },
	): Promise<void> {
		return new Promise((resolve, _reject) => {
			// use the writeFile event on the host socket
			this.socket.emit("writeFile", path, content, options, () => {
				resolve(); // whether it worked or not doesn't really matter
			});
		});
	}
	// given a path and byte contents, write the file
	async writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		options: { readonly create: boolean; readonly overwrite: boolean },
	): Promise<void> {
		// if the file is too large, just reject it
		if (content.byteLength > maxSize) {
			throw vscode.FileSystemError.NoPermissions("file too large");
		}
		await this.ready; // wait for the host socket to connect
		await this.requestWriteFile(this.toRoomPath(uri), content, options); // this should always work
		return; // it doesn't return anything
	}

	// given a path name, request to create the directory
	requestCreateDirectory(path: string): Promise<void> {
		return new Promise((resolve, _reject) => {
			// use the createDirectory event on the host socket
			this.socket.emit("createDirectory", path, () => {
				resolve(); // the results don't matter
			});
		});
	}
	// given a path name, create the directory
	async createDirectory(uri: vscode.Uri): Promise<void> {
		await this.ready; // wait for the host socket to connect
		await this.requestCreateDirectory(this.toRoomPath(uri)); // this should always work
		return; // this doesn't return anything
	}

	// given a file path, request to delete it
	requestDeleteFile(
		path: string,
		options: { readonly recursive: boolean },
	): Promise<void> {
		return new Promise((resolve, _reject) => {
			// use the deleteFile event on the host socket
			this.socket.emit("deleteFile", path, options, () => {
				resolve(); // the results don't matter
			});
		});
	}
	// given a file path, delete it
	async delete(
		uri: vscode.Uri,
		options: { readonly recursive: boolean },
	): Promise<void> {
		await this.ready; // wait for the host socket to connect
		await this.requestDeleteFile(this.toRoomPath(uri), options); // this should always work
		return; // it doesn't return anything
	}

	// given a file path, and it's new file path, request to move it there
	requestRenameFile(
		path: string,
		newPath: string,
		options: { readonly overwrite: boolean },
	): Promise<void> {
		return new Promise((resolve, _reject) => {
			// use the renameFile event on the host socket
			this.socket.emit("renameFile", path, newPath, options, () => {
				resolve(); // results don't matter
			});
		});
	}
	// given a file, and it's new and old path, move it
	async rename(
		oldUri: vscode.Uri,
		newUri: vscode.Uri,
		options: { readonly overwrite: boolean },
	): Promise<void> {
		await this.ready; // wait for the host socket to connect
		// this should always work
		await this.requestRenameFile(
			this.toRoomPath(oldUri),
			this.toRoomPath(newUri),
			options,
		);
		return; // it doesn't return anything
	}
}
