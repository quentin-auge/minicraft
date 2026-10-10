// Help overlay. Pauses the sim while open; closing re-locks pointer.
export let helpOpen = false;
let closeTime = 0;

const el = () => document.getElementById("help");

export function isHelpOpen() {
  return helpOpen;
}

export function openHelp() {
  helpOpen = true;
  el().style.display = "flex";
  if (document.pointerLockElement) document.exitPointerLock();
}

export function closeHelp() {
  helpOpen = false;
  el().style.display = "none";
  closeTime = Date.now();
}

export function helpJustClosed() {
  return Date.now() - closeTime < 2000;
}

export function initHelp(requestLock) {
  document.getElementById("btnHelpClose").addEventListener("click", () => {
    closeHelp();
    requestLock();
  });
  el().addEventListener("click", (e) => {
    if (e.target === el()) {
      closeHelp();
      requestLock();
    }
  });
}
