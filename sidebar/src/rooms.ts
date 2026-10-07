import { state, switchPage, vscode } from "./global";

const publicRoomsDiv = document.getElementById("public-rooms") as HTMLDivElement;
const publicRooms = document.getElementById("public-rooms-list") as HTMLDivElement;

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
        publicRooms.innerHTML = "";
        publicRoomsDiv.classList.remove("show");

        for (const room of msg.rooms) {
            publicRoomsDiv.classList.add("show");
            const div = document.createElement("div");

            const name = document.createElement("span");
            name.textContent = room;

            const right = document.createElement("div");
            right.classList.add("right");

            const visibility = document.getElementById("public-img")!.cloneNode();

            const joinBtn = document.createElement("button");
            joinBtn.textContent = "join";

            right.appendChild(visibility);
            right.appendChild(joinBtn);

            joinBtn.onpointerup = () => {
                vscode.postMessage({ joinRoom: room });
            };

            div.appendChild(name);
            div.appendChild(right);
            // div.appendChild(joinBtn);

            publicRooms.appendChild(div);
        }
    }

    // if (msg.newRoom) {
    //     openRoom(msg.newRoom.name);
    //     vscode.postMessage({ presence: true });
    // }

    // if (msg.joinedRoom) {
    //     openRoom(msg.joinedRoom);
    // }

    if (msg.state && msg.state.room !== null) {
        openRoom(msg.state.room);
        vscode.postMessage({ presence: true });
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