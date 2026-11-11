// Help float (hold H). Opens centered while keeping pointer lock (no mouse
// on help — pure readout); the sim pauses behind it via the registry.
// Releasing H hides it again. No buttons, no backdrop click; Enter and
// Escape do nothing on the float — only the release closes it.
import { registerMenu, openFloat, closeModal } from "./menus.js";
export let helpOpen = false;

const el = () => document.getElementById("help");

export function isHelpOpen() {
  return helpOpen;
}

export function openHelp() {
  helpOpen = true;
  openFloat(el());
}

export function closeHelp() {
  helpOpen = false;
  closeModal(el());
}

// Kept as a no-op for callers: floating needs no button wiring (no Close,
// the release closes; the lock was never lost so no re-lock).
export function initHelp() {}

registerMenu({
  key: "help",
  layer: "float",
  isOpen: () => helpOpen,
  onKeydown(e) {
    // Paused like a modal: consume everything while shown (Enter/Escape
    // included, with no effect) so game input freezes with the sim.
    if (!helpOpen) return false;
    e.preventDefault();
    return true;
  },
  onKeyup(e) {
    if (e.code === "KeyH" && helpOpen) {
      closeHelp();
      e.preventDefault();
      return true;
    }
    return false;
  },
});
