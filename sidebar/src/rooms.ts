import { state, switchPage, vscode } from "./global";

// public rooms list html
const publicRoomsDiv = document.getElementById(
	"public-rooms",
) as HTMLDivElement;
const publicRooms = document.getElementById(
	"public-rooms-list",
) as HTMLDivElement;

const backBtn = document.getElementById("rooms-back-btn") as HTMLButtonElement;

backBtn.onpointerup = () => {
	switchPage("main");
};

const newBtn = document.getElementById("new-room-btn") as HTMLButtonElement;

newBtn.onpointerup = () => {
	vscode.postMessage({ newRoom: true }); // request a new room creation from the main extension
};

window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg.rooms) {
		// clear the list
		publicRooms.innerHTML = "";
		publicRoomsDiv.classList.remove("show");

		// for each room, construct html and add it
		for (const room of msg.rooms) {
			publicRoomsDiv.classList.add("show");
			const div = document.createElement("div");

			const name = document.createElement("span");
			name.textContent = room;

			const right = document.createElement("div");
			right.classList.add("right");

			const visibility = document
				.getElementById("public-img")!
				.cloneNode();

			const joinBtn = document.createElement("button");
			joinBtn.textContent = "join";

			right.appendChild(visibility);
			right.appendChild(joinBtn);

			joinBtn.onpointerup = () => {
				vscode.postMessage({ joinRoom: room });
			};

			div.appendChild(name);
			div.appendChild(right);

			publicRooms.appendChild(div);
		}
	}

	// on receiving state, open the room and request the user list if a room is open
	if (msg.state && msg.state.room !== null) {
		openRoom(msg.state.room);
		vscode.postMessage({ presence: true });
	}
});

// if the sidebar is opened to the rooms page, request the rooms list
if (state.page === "rooms") {
	vscode.postMessage({ rooms: true });
}

// switch state to a room and open the page for it
function openRoom(name: string) {
	const title = document.getElementById("room-title") as HTMLSpanElement;
	title.textContent = name;
	state.room = name;
	switchPage("room");
}
