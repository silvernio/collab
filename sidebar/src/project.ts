import { state, vscode } from "./global";

const leaveBtn = document.getElementById("leave-project-btn") as HTMLButtonElement;

leaveBtn.onpointerup = () => {
    vscode.postMessage({ leaveRoom: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.state) {
        const title = document.getElementById("project-title") as HTMLSpanElement;
        title.textContent = msg.state.project;
    }
});

if (state.project !== null) {
    const title = document.getElementById("project-title") as HTMLSpanElement;
    title.textContent = state.project;
}

const inviteBtn = document.getElementById("project-invite-btn") as HTMLButtonElement;

inviteBtn.onpointerup = () => {
    vscode.postMessage({ invite: true });
};