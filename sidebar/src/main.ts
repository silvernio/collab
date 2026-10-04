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
const projectsBtn = document.getElementById("projects-btn") as HTMLButtonElement;

roomsBtn.onpointerup = () => {
    switchPage("rooms");

    vscode.postMessage({ rooms: true });
};

projectsBtn.onpointerup = () => {
    switchPage("projects");

    vscode.postMessage({ projects: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.hosts) {
        hosts.innerHTML = "";

        // const o = document.createElement("option");
        // o.textContent = "--Select a host--";
        // o.value = "";
        // hosts.appendChild(o);

        for (const host of msg.hosts) {
            const o = document.createElement("option");
            o.textContent = host.name;
            o.value = JSON.stringify({ id: host.id, url: host.url, yjs_url: host.yjs_url });
            console.log("v", o.value);

            hosts.appendChild(o);
        }

        // hosts.value = "";

        if (state.host !== null) {
            hosts.value = JSON.stringify(state.host);
        } else {
            hosts.value = JSON.stringify({ id: msg.hosts[0].id, url: msg.hosts[0].url, yjs_url: msg.hosts[0].yjs_url });
            (hosts as any).onchange();
        }
    }

    if (msg.hostConnected) {
        switchPage("main");
    }

    if (msg.state) {
        hosts.value = JSON.stringify(msg.state.host);
    }

    if (msg.user) {
        nameDisplay.textContent = msg.user.name;
        document.getElementById("filter-colour")?.setAttribute("flood-color", msg.user.colour);

        if (msg.user.uuid !== null) {
            authBtn.classList.remove("show");
            logoutBtn.classList.add("show");
        } else {
            authBtn.classList.add("show");
            logoutBtn.classList.remove("show");
        }
    }
});

hosts.onchange = () => {
    if (hosts.value === "") {
        switchPage(null);
        return;
    }
    const host = JSON.parse(hosts.value);
    vscode.postMessage({ selectHost: host });

    state.host = host;
    vscode.setState(state);
};

vscode.postMessage({ hosts: true });

authBtn.classList.add('show');

authBtn.onpointerup = () => {
    vscode.postMessage({ auth: true });
};

logoutBtn.onpointerup = () => {
    console.log("logout now");
    vscode.postMessage({ logout: true });
};

vscode.postMessage({ user: true });