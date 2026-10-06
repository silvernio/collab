import { page, state, vscode } from "./global";

const usersList = document.getElementById("project-users") as HTMLDivElement;

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

    if (msg.presence && page.v === "project") {
        usersList.innerHTML = "";

        console.log(msg.presence, "worked");

        for (const user of msg.presence) {
            const div = document.createElement("div");
            const name = document.createElement("span");
            name.textContent = user.name;

            if (!user.online) {
                div.classList.add("offline");
            }

            div.style.setProperty("--colour", user.colour);

            div.appendChild(name);

            usersList.appendChild(div);
        }
    }
});

if (state.project !== null) {
    const title = document.getElementById("project-title") as HTMLSpanElement;
    title.textContent = state.project;

    vscode.postMessage({presence: true});
}

const inviteBtn = document.getElementById("project-invite-btn") as HTMLButtonElement;

inviteBtn.onpointerup = () => {
    vscode.postMessage({ invite: true });
};