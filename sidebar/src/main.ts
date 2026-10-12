import { state, switchPage, vscode } from "./global";

import "./rooms";
import "./room";
import "./projects";
import "./project";

const authBtn = document.getElementById("auth-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const nameDisplay = document.getElementById("name") as HTMLSpanElement;

const hosts = document.getElementById("hosts") as HTMLSelectElement;

const roomsBtn = document.getElementById("rooms-btn") as HTMLButtonElement;
const projectsBtn = document.getElementById(
	"projects-btn",
) as HTMLButtonElement;

roomsBtn.onpointerup = () => {
	switchPage("rooms");

	vscode.postMessage({ rooms: true }); // request the rooms list when loading the rooms page
};

projectsBtn.onpointerup = () => {
	switchPage("projects");

	vscode.postMessage({ projects: true }); // same for projects
};

window.addEventListener("message", (event) => {
	const msg = event.data;
	// when recieivng the host list, update html and select the first one
	if (msg.hosts) {
		hosts.innerHTML = ""; // clear the select

		// add each option
		for (const host of msg.hosts) {
			const o = document.createElement("option");
			o.textContent = host.name;
			o.value = host.id;

			hosts.appendChild(o);
		}

		// if a host is selected, select that one. Otherwise, select the first one
		if (state.host !== null) {
			hosts.value = state.host;
		} else {
			hosts.value = msg.hosts[0].id;
			(hosts as any).onchange();
		}
	}

	// once connected to a host after selecting, load the main page
	if (msg.hostConnected) {
		switchPage("main");
	}

	// update the selected host when receiving state
	if (msg.state) {
		hosts.value = msg.state.host;
	}

	// when receiving user details, update the account html
	if (msg.user) {
		nameDisplay.textContent = msg.user.name;
		document
			.getElementById("filter-colour")
			?.setAttribute("flood-color", msg.user.colour);

		if (msg.user.uuid !== null) {
			authBtn.classList.remove("show");
			logoutBtn.classList.add("show");
		} else {
			authBtn.classList.add("show");
			logoutBtn.classList.remove("show");
		}
	}
});

// when a user selects a host, request to select it and update state
hosts.onchange = () => {
	if (hosts.value === "") {
		// if it's an empty selection, don't do anything
		switchPage(null);
		return;
	}
	vscode.postMessage({ selectHost: hosts.value }); // request to select it

	state.host = hosts.value;
	vscode.setState(state);
};

// request the hosts list
vscode.postMessage({ hosts: true });

authBtn.classList.add("show"); // show the login button

authBtn.onpointerup = () => {
	vscode.postMessage({ auth: true });
};

logoutBtn.onpointerup = () => {
	vscode.postMessage({ logout: true });
};

// request the user details
vscode.postMessage({ user: true });
