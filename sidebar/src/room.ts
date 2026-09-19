import { state, switchPage, vscode } from "./global";

const leaveBtn = document.getElementById("leave-room-btn") as HTMLButtonElement;

leaveBtn.onpointerup = () => {
    vscode.postMessage({ leaveRoom: true });
};

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.leftRoom) {
        vscode.postMessage({ rooms: true });
        state.room = null;
        switchPage("rooms");
    }

    if (msg.state) {
        console.log(msg.state);
        const title = document.getElementById("room-title") as HTMLSpanElement;
        title.textContent = msg.state.room;
    }
});

if (state.room !== null) {
    const title = document.getElementById("room-title") as HTMLSpanElement;
    title.textContent = state.room;
}