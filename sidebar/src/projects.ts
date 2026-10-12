import { state, switchPage, vscode } from "./global";

// recent projects list html
const recentProjectsDiv = document.getElementById(
	"recent-projects",
) as HTMLDivElement;
const recentProjects = document.getElementById(
	"recent-projects-list",
) as HTMLDivElement;

// public projects list html
const publicProjectsDiv = document.getElementById(
	"public-projects",
) as HTMLDivElement;
const publicProjects = document.getElementById(
	"public-projects-list",
) as HTMLDivElement;

const backBtn = document.getElementById(
	"projects-back-btn",
) as HTMLButtonElement;

backBtn.onpointerup = () => {
	switchPage("main");
};

const newBtn = document.getElementById("new-project-btn") as HTMLButtonElement;
const guestText = document.getElementById(
	"new-project-guest",
) as HTMLParagraphElement;

newBtn.onpointerup = () => {
	vscode.postMessage({ newProject: true }); // request a new project from the main extension
};

window.addEventListener("message", (event) => {
	const msg = event.data;
	if (msg.projects) {
		// clear both lists
		recentProjects.innerHTML = "";
		recentProjectsDiv.classList.remove("show");

		publicProjects.innerHTML = "";
		publicProjectsDiv.classList.remove("show");

		for (const project of msg.projects) {
			const div = document.createElement("div");

			const name = document.createElement("span");
			name.textContent = project.name;

			const right = document.createElement("div");
			right.classList.add("right");

			const visibility = document
				.getElementById(
					["private", "public"][project.visibility] + "-img",
				)!
				.cloneNode();

			const openBtn = document.createElement("button");
			openBtn.textContent = "open";

			right.appendChild(visibility);
			right.appendChild(openBtn);

			openBtn.onpointerup = () => {
				vscode.postMessage({ openProject: project });
			};

			div.appendChild(name);
			div.appendChild(right);
			// div.appendChild(openBtn);

			// if it's a private project, add it to the recent list, otherwise the public list
			switch (project.visibility) {
				case 0:
					recentProjectsDiv.classList.add("show");
					recentProjects.appendChild(div);
					break;

				case 1:
					publicProjectsDiv.classList.add("show");
					publicProjects.appendChild(div);
					break;

				default:
					break;
			}
			// cool switch statement trust
		}
	}
	// when receiving state, if a project is open, reflect that on the sidebar
	if (msg.state && msg.state.project !== null) {
		openProject(msg.state.project);
		vscode.postMessage({ presence: true });
	}

	// update ui corresponding to whether a user is logged in
	if (msg.user) {
		newBtn.style.display = msg.user.uuid === null ? "none" : "block";
		guestText.style.display = msg.user.uuid === null ? "inline" : "none";
	}
});

// if the projects page is open when the sidebar opens, request the projects list
if (state.page === "projects") {
	vscode.postMessage({ projects: true });
}

// update state and open a project page
function openProject(name: string) {
	const title = document.getElementById("project-title") as HTMLSpanElement;
	title.textContent = name;
	state.project = name;
	switchPage("project");
}
