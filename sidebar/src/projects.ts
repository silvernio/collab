import { state, switchPage, vscode } from "./global";

const projects = document.getElementById("projects-list") as HTMLDivElement;

const backBtn = document.getElementById("projects-back-btn") as HTMLButtonElement;

backBtn.onpointerup = () => {
    switchPage("main");
};

const newBtn = document.getElementById("new-project-btn") as HTMLButtonElement;

newBtn.onpointerup = () => {
    vscode.postMessage({ newProject: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.projects) {
        projects.innerHTML = "";
        projects.style.display = "none";

        for (const project of msg.projects) {
            projects.style.display = "flex";
            const div = document.createElement("div");

            const name = document.createElement("span");
            name.textContent = project.name;

            const openBtn = document.createElement("button");
            openBtn.textContent = "open";

            openBtn.onpointerup = () => {
                vscode.postMessage({ openProject: project });
            };

            div.appendChild(name);
            div.appendChild(openBtn);

            projects.appendChild(div);
        }
    }
    if (msg.state && msg.state.project !== null) {
        openProject(msg.state.project);
        vscode.postMessage({presence: true});
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