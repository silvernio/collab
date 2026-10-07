import { state, switchPage, vscode } from "./global";

const recentProjectsDiv = document.getElementById("recent-projects") as HTMLDivElement;
const recentProjects = document.getElementById("recent-projects-list") as HTMLDivElement;

const publicProjectsDiv = document.getElementById("public-projects") as HTMLDivElement;
const publicProjects = document.getElementById("public-projects-list") as HTMLDivElement;

const backBtn = document.getElementById("projects-back-btn") as HTMLButtonElement;

backBtn.onpointerup = () => {
    switchPage("main");
};

const newBtn = document.getElementById("new-project-btn") as HTMLButtonElement;
const guestText = document.getElementById("new-project-guest") as HTMLParagraphElement;

newBtn.onpointerup = () => {
    vscode.postMessage({ newProject: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.projects) {
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

            const visibility = document.getElementById(["private", "public"][project.visibility] + "-img")!.cloneNode();

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
        }
    }
    if (msg.state && msg.state.project !== null) {
        openProject(msg.state.project);
        vscode.postMessage({ presence: true });
    }
    if (msg.user) {
        newBtn.style.display = msg.user.uuid === null ? "none" : "block";
        guestText.style.display = msg.user.uuid === null ? "inline" : "none";
    }
});

if (state.page === "projects") {
    vscode.postMessage({ projects: true });
}

function openProject(name: string) {
    const title = document.getElementById("project-title") as HTMLSpanElement;
    title.textContent = name;
    state.project = name;
    switchPage("project");
}