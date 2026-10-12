// @ts-ignore
export const vscode = acquireVsCodeApi() as {
	postMessage: (msg: any) => void;
	setState: (state: any) => void;
	getState: () => any;
};

// all the pages in the sidebar and their html elements
export const pages: Record<string, { e: HTMLDivElement }> = {
	main: { e: document.getElementById("main") as HTMLDivElement },
	rooms: { e: document.getElementById("rooms") as HTMLDivElement },
	room: { e: document.getElementById("room") as HTMLDivElement },
	projects: { e: document.getElementById("projects") as HTMLDivElement },
	project: { e: document.getElementById("project") as HTMLDivElement },
};

export const page: { v: string | null } = { v: null }; // the currently open page

// the general state, including the sidebar page, host, room, project, and it's visbility
export const state: {
	host: string | null;
	page: string | null;
	room: string | null;
	project: string | null;
	visibility: number | null;
	session: string;
} = vscode.getState() || {
	host: null,
	page: null,
	room: null,
	project: null,
	session: (window as any).__SESSION_ID__,
};

// the session id is passed in the html, and the sidebar uses it to detect which window the sidebar is in, to determine whether it should reset it's state
if ((window as any).__SESSION_ID__ !== state.session) {
	state.session = (window as any).__SESSION_ID__;
	state.host = null;
	state.page = null;
	state.room = null;
	state.project = null;
	state.visibility = null;
}

// switch pages
export function switchPage(npage: string | null) {
	if (page.v !== null) {
		// hide the last page
		pages[page.v].e.classList.remove("show");
	}
	page.v = npage;
	if (page.v !== null) {
		// show the new page
		pages[page.v].e.classList.add("show");
	}

	// update state
	state.page = page.v;
	vscode.setState(state);
}

// load whichever page the state has
switchPage(state.page);

window.addEventListener("message", (event) => {
	const msg = event.data;
	// when a state is received from the main extension, update the sidebar state and save it
	if (msg.state) {
		state.host = msg.state.host;
		state.page = msg.state.page;
		state.room = msg.state.room;
		state.project = msg.state.project;
		state.visibility = msg.state.visibility;
		vscode.setState(state);
	}
});

// if there's no host in the state, request it
if (state.host === null) {
	vscode.postMessage({ ready: true });
}
