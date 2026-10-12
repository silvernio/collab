import { page, state, vscode } from "./global";

const usersList = document.getElementById("project-users") as HTMLDivElement;

const leaveBtn = document.getElementById(
	"leave-project-btn",
) as HTMLButtonElement;

leaveBtn.onpointerup = () => {
	vscode.postMessage({ leaveRoom: true });
};

window.addEventListener("message", (event) => {
	const msg = event.data;

	// when state is received, update the project title & visibility if there is one
	if (msg.state) {
		const title = document.getElementById(
			"project-title",
		) as HTMLSpanElement;
		title.textContent = msg.state.project;

		if (msg.state.visibility !== null) {
			const visibility = document.getElementById(
				"project-visibility",
			) as HTMLDivElement;
			visibility.innerHTML =
				document.getElementById(
					["private", "public"][msg.state.visibility] + "-img",
				)?.outerHTML ?? "";
		}
	}

	// on receiving the user list, update the html for it
	if (msg.presence && page.v === "project") {
		usersList.innerHTML = ""; // clear the list

		// add html for each user
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

// if a project is open when the sidebar loads, update the title & visibility
if (state.project !== null) {
	const title = document.getElementById("project-title") as HTMLSpanElement;
	title.textContent = state.project;

	vscode.postMessage({ presence: true }); // and request the user list

	if (state.visibility !== null) {
		const visibility = document.getElementById(
			"project-visibility",
		) as HTMLDivElement;
		visibility.innerHTML =
			document.getElementById(
				["private", "public"][state.visibility] + "-img",
			)?.outerHTML ?? "";
	}
}

const inviteBtn = document.getElementById(
	"project-invite-btn",
) as HTMLButtonElement;

inviteBtn.onpointerup = () => {
	vscode.postMessage({ invite: true });
};
