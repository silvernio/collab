import { state, switchPage, vscode } from "./global";

const rooms = document.getElementById("rooms-list") as HTMLDivElement;

const backBtn = document.getElementById("rooms-back-btn") as HTMLButtonElement;

backBtn.onpointerup = () => {
    switchPage("main");
};

const newBtn = document.getElementById("new-room-btn") as HTMLButtonElement;

newBtn.onpointerup = () => {
    vscode.postMessage({ newRoom: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.rooms) {
        rooms.innerHTML = "";

        for (const room of msg.rooms) {
            const div = document.createElement("div");

            const name = document.createElement("span");
            name.textContent = room;

            const joinBtn = document.createElement("button");
            joinBtn.textContent = "join";

            joinBtn.onpointerup = () => {
                vscode.postMessage({ joinRoom: room });
            };

            div.appendChild(name);
            div.appendChild(joinBtn);

            rooms.appendChild(div);
        }
    }

    if (msg.newRoom) {
        openRoom(msg.newRoom);
    }

    if (msg.joinedRoom) {
        openRoom(msg.joinedRoom);
    }

    if (msg.state) {
        openRoom(msg.state.room);
    }
});

if (state.page === "rooms") {
    vscode.postMessage({ rooms: true });
}

function openRoom(name: string) {
    const title = document.getElementById("room-title") as HTMLSpanElement;
    title.textContent = name;
    state.room = name;
    switchPage("room");
}