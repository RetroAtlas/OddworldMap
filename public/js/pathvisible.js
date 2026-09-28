// Which paths the map lists: every gameplay path, the demo copies when the
// setting asks for them, and any path the visitor has arrived at this session.
// Importable in bare Node: no DOM.

import { isDemoPath } from "./demo.js";
import { getSettings } from "./settings.js";

// held on the path object itself, so whatever stands a new object in for a path
// has to carry its reveal across
const revealed = new WeakSet();

// the path in hand is always listed: a hidden path arrived at is revealed for the
// session rather than stranding the visitor on a screen no button names
export function pathVisible(P) {
  return !isDemoPath(P) || getSettings().showDemoPaths || revealed.has(P);
}

// true when this reveals the path, so the caller knows to rebuild its buttons
export function revealPath(P) {
  if (pathVisible(P)) return false;
  revealed.add(P);
  return true;
}
