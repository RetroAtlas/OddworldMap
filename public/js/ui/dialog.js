// Shared modal-dialog behavior: while a dialog is open, keyboard input stays
// inside it — Escape closes, Tab cycles the dialog's controls, and the
// map/search shortcuts underneath never fire — and the back button closes it
// the way Escape does.

// the open dialog's close, and the id of the entry standing for it. One of each
// is enough: an open overlay covers every other opener, so two dialogs are
// never open together.
let dialogClose = null,
  entryId = 0;

export function openDialog(overlay, close) {
  overlay.classList.add("open");
  window.dispatchEvent(new Event("dialog-opened"));
  // the open dialog stands on a history entry of its own, so a back press closes
  // it rather than leaving the site. It duplicates the current URL, leaving the
  // traversal nothing to move on the map; an embed's entries are the host page's
  if (document.body.classList.contains("embed")) return;
  // wired on the first push, never at import: bare Node imports this module
  if (!entryId) window.addEventListener("popstate", backOut);
  history.pushState({ dialog: ++entryId }, "", location.href);
  dialogClose = close;
}

export function closeDialog(overlay) {
  overlay.classList.remove("open");
  if (!dialogClose) return;
  dialogClose = null;
  // spent while it is still the entry on top, so the next back press is the
  // visitor's own again
  if (history.state?.dialog === entryId) history.back();
}

// a back press closes the open dialog; the traversal has spent its entry
function backOut() {
  const close = dialogClose;
  if (!close) return;
  dialogClose = null;
  close();
}

export function trapDialogKeys(isOpen, panel, close) {
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") {
        close();
        e.preventDefault();
      } else if (e.key === "Tab") {
        const items = [...panel.querySelectorAll("button, input, a[href]")].filter(
          (el) => el.offsetParent,
        );
        if (items.length) {
          e.preventDefault();
          const i = items.indexOf(document.activeElement);
          items[i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
        }
      }
      // immediate: another dialog's trap also listens here, and one Escape
      // must not close two dialogs at once
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
