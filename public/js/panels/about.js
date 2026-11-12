// "About this map": what the project is, whose trademarks it uses, and where
// its source lives. The prose is static markup, so the notice is in the page
// source with scripting off.

import { $ } from "../ui/dom.js";
import { closeDialog, openDialog, trapDialogKeys } from "../ui/dialog.js";

const btn = $("aboutBtn"),
  overlay = $("aboutOverlay"),
  closeBtn = $("aboutClose");

const open = () => {
  openDialog(overlay, close);
  closeBtn.focus();
};
const close = () => {
  closeDialog(overlay);
  btn.focus();
};

export function initAbout() {
  btn.onclick = open;
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  trapDialogKeys(() => overlay.classList.contains("open"), $("about"), close);
}
