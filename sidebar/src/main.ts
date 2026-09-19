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
            o.value = JSON.stringify({url: host.url, yjs_url: host.yjs_url});
            console.log("v", o.value);

            hosts.appendChild(o);
        }

        hosts.value = "";
        if (state.host !== null) {
            hosts.value = JSON.stringify(state.host);
        }
    }

    if (msg.hostConnected) {
        switchPage("main");
    }

    if (msg.state) {
        console.log(msg.state);
        hosts.value = JSON.stringify(msg.state.host);
        console.log(hosts.options);
        console.log(hosts.value);
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