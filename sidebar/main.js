
const hosts = document.getElementById("hosts");
const projects = document.getElementById("projects");

const vscode = acquireVsCodeApi();

const newBtn = document.getElementById("new-project");

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.hosts) {
        hosts.innerHTML = "";

        for (const host of msg.hosts) {
            const o = document.createElement("option");
            o.textContent = host.name;
            o.value = host.url;

            hosts.appendChild(o);
        }

        hosts.value = msg.hosts[0].url;
        vscode.postMessage({selectHost: hosts.value});
    }

    if (msg.projects) {
        projects.innerHTML = "";

        for (const project of msg.projects) {
            const d = document.createElement("div");

            const name = document.createElement("span");
            name.textContent = project.name;

            const open = document.createElement("button");
            open.textContent = "open";

            d.appendChild(name);
            d.appendChild(open);
            
            projects.appendChild(d);

            open.onclick = () => {
                
            };
        }
    }
});

hosts.onchange = () => {
    vscode.postMessage({selectHost: hosts.value});
};

newBtn.onclick = () => {
    vscode.postMessage({newProject: true});
};

vscode.postMessage({hosts: true});