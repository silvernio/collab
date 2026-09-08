import { state, switchPage, vscode } from "./global";

import "./rooms";
import "./room";

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

        const o = document.createElement("option");
        o.textContent = "--Select a host--";
        o.value = "";
        hosts.appendChild(o);

        for (const host of msg.hosts) {
            const o = document.createElement("option");
            o.textContent = host.name;
            o.value = host.url;

            hosts.appendChild(o);
        }

        hosts.value = "";
        if (state.host !== null) {
            hosts.value = state.host;
        }
    }

    if (msg.hostConnected) {
        switchPage("main");
    }

    if (msg.state) {
        hosts.value = msg.state.host;
    }
});

hosts.onchange = () => {
    if (hosts.value === "") {
        switchPage(null);
        return;
    }
    vscode.postMessage({ selectHost: hosts.value });

    state.host = hosts.value;
    vscode.setState(state);
};

vscode.postMessage({ hosts: true });