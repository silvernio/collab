import { state, switchPage, vscode } from "./global";

const usersList = document.getElementById("room-users") as HTMLDivElement;

const leaveBtn = document.getElementById("leave-room-btn") as HTMLButtonElement;

leaveBtn.onpointerup = () => {
    vscode.postMessage({ leaveRoom: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.leftRoom) {
        state.room = null;
        switchPage("rooms");
        vscode.postMessage({ rooms: true });
    }

    if (msg.state) {
        const title = document.getElementById("room-title") as HTMLSpanElement;
        title.textContent = msg.state.room;

        if (msg.state.visibility !== null) {
            const visibility = document.getElementById("room-visibility") as HTMLDivElement;
            visibility.innerHTML = document.getElementById(["private", "public"][msg.state.visibility] + "-img")?.outerHTML ?? "";
        }
    }

    if (msg.presence) {
        usersList.innerHTML = "";

        for (const user of msg.presence) {
            const div = document.createElement("div");
            const name = document.createElement("span");
            name.textContent = user.name;

            div.style.setProperty("--colour", user.colour);

            div.appendChild(name);

            usersList.appendChild(div);
        }
    }
});

if (state.room !== null) {
    const title = document.getElementById("room-title") as HTMLSpanElement;
    title.textContent = state.room;

    vscode.postMessage({ presence: true });

    if (state.visibility !== null) {
        const visibility = document.getElementById("room-visibility") as HTMLDivElement;
        visibility.innerHTML = document.getElementById(["private", "public"][state.visibility] + "-img")?.outerHTML ?? "";
    }
}

const inviteBtn = document.getElementById("room-invite-btn") as HTMLButtonElement;

inviteBtn.onpointerup = () => {
    vscode.postMessage({ invite: true });
};