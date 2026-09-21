import { state, switchPage, vscode } from "./global";

import "./rooms";
import "./room";

const authBtn = document.getElementById("auth-btn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLButtonElement;
const nameDisplay = document.getElementById("name") as HTMLSpanElement;

const hosts = document.getElementById("hosts") as HTMLSelectElement;

const roomsBtn = document.getElementById("rooms-btn") as HTMLButtonElement;

roomsBtn.onpointerup = () => {
    switchPage("rooms");

    vscode.postMessage({ rooms: true });
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
            o.value = JSON.stringify({url: host.url, yjs_url: host.yjs_url});
            console.log("v", o.value);

            hosts.appendChild(o);
        }

        // hosts.value = "";

        if (state.host !== null) {
            hosts.value = JSON.stringify(state.host);
        } else {
            hosts.value = JSON.stringify({url: msg.hosts[0].url, yjs_url: msg.hosts[0].yjs_url});
            (hosts as any).onchange();
        }
    }

    if (msg.hostConnected) {
        switchPage("main");
    }

    if (msg.state) {
        hosts.value = JSON.stringify(msg.state.host);
    }

    if (msg.cauth) {
        nameDisplay.textContent = msg.cauth.account.label;

        authBtn.classList.remove("show");
        logoutBtn.classList.add("show");
    }

    if (msg.loggedOut) {
        nameDisplay.textContent = "";

        authBtn.classList.add("show");
        logoutBtn.classList.remove("show");
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
    vscode.postMessage({auth: true});
};

logoutBtn.onpointerup = () => {
    vscode.postMessage({logout: true});
};

vscode.postMessage({ cauth: true });