
// @ts-ignore
export const vscode = acquireVsCodeApi() as { postMessage: (any) => void, setState: (any) => void, getState: () => any };

export const pages: Record<string, { e: HTMLDivElement }> = {
    main: {
        e: document.getElementById("main") as HTMLDivElement
    },
    rooms: {
        e: document.getElementById("rooms") as HTMLDivElement
    },
    room: {
        e: document.getElementById("room") as HTMLDivElement
    }
};

export const page: { v: string | null } = { v: null };

export const state: { host: {url: string | null, yjs_url: string | null} | null, page: string | null, room: string | null, session: string } = vscode.getState() || { host: null, page: null, room: null, session: (window as any).__SESSION_ID__ };
if ((window as any).__SESSION_ID__ !== state.session) {
    state.session = (window as any).__SESSION_ID__;
    state.host = null;
    state.page = null;
    state.room = null;
}

export function switchPage(npage: string | null) {
    if (page.v !== null) { pages[page.v].e.classList.remove("show"); }
    page.v = npage;
    if (page.v !== null) { pages[page.v].e.classList.add("show"); }

    state.page = page.v;
    vscode.setState(state);
}

switchPage(state.page);

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.state) {
        state.host = msg.state.host;
        state.page = msg.state.page;
        state.room = msg.state.room;
        vscode.setState(state);
    }
});

if (state.host === null) { vscode.postMessage({ ready: true }); }