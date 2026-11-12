const lit = new Map();
// Shift can change a key's text between its press and its release, but not its code.
const place = (e) => e.code || e.key;

/** Light the cap in `scope` that shows the key pressed in `e`, until the key is let go. */
export function lightCap(scope, e) {
  const cap = [...scope.querySelectorAll("kbd")].find((k) => k.textContent === e.key);
  if (!cap) return;
  listen();
  cap.classList.add("held");
  lit.set(place(e), cap);
}

function letGo(places) {
  for (const at of places) {
    lit.get(at)?.classList.remove("held");
    lit.delete(at);
  }
}

// Wired on the first cap lit, never at import.
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  // A Mac sends no keyup for a key let go under Cmd, nor a window for one let go outside it.
  addEventListener("keyup", (e) => letGo(e.key === "Meta" ? [...lit.keys()] : [place(e)]));
  addEventListener("blur", () => letGo([...lit.keys()]));
}
