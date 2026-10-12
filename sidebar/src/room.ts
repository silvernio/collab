import { state, switchPage, vscode } from "./global";

const usersList = document.getElementById("room-users") as HTMLDivElement;

const leaveBtn = document.getElementById("leave-room-btn") as HTMLButtonElement;

leaveBtn.onpointerup = () => {
	vscode.postMessage({ leaveRoom: true }); // request to leave the room
};
window.addEventListener("message", (event) => {
	const msg = event.data;

	// if you left a room, switch back to the rooms page and update state
	if (msg.leftRoom) {
		state.room = null;
		switchPage("rooms");
		vscode.postMessage({ rooms: true });
	}

	// on receiving state, update the room title & visibility
	if (msg.state) {
		const title = document.getElementById("room-title") as HTMLSpanElement;
		title.textContent = msg.state.room;

		if (msg.state.visibility !== null) {
			const visibility = document.getElementById(
				"room-visibility",
			) as HTMLDivElement;
			visibility.innerHTML =
				document.getElementById(
					["private", "public"][msg.state.visibility] + "-img",
				)?.outerHTML ?? "";
		}
	}

	// when receiving the user list, update the list
	if (msg.presence) {
		usersList.innerHTML = ""; // clear the list

		// add html for each user
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

// if a room is open when the sidebar is loaded, show it
if (state.room !== null) {
	// update title
	const title = document.getElementById("room-title") as HTMLSpanElement;
	title.textContent = state.room;

	// request user list
	vscode.postMessage({ presence: true });

	// update visibiliy
	if (state.visibility !== null) {
		const visibility = document.getElementById(
			"room-visibility",
		) as HTMLDivElement;
		visibility.innerHTML =
			document.getElementById(
				["private", "public"][state.visibility] + "-img",
			)?.outerHTML ?? "";
	}
}

const inviteBtn = document.getElementById(
	"room-invite-btn",
) as HTMLButtonElement;

inviteBtn.onpointerup = () => {
	vscode.postMessage({ invite: true }); // request to copy the invite link
};
