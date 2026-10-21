// The sentence that says where the map is: what the status region announces and
// what the canvas is named. No DOM, so it stays importable in bare Node.

import { pathDisplayName, pathNote } from "./annotations.js";
import { EDITED_NOTE } from "./config.js";
import { pathEdited } from "./edits.js";
import { pathReleased } from "./release.js";

export function placeSummary(data, lvl, path) {
  const n = path.tlvs.length;
  return [
    data.game.replace(/^Oddworld:\s*/, ""),
    data.release?.name,
    lvl.name,
    `path ${path.id}`,
    pathDisplayName(data.id, lvl.short, path),
    `${n} object${n === 1 ? "" : "s"}`,
    pathNote(data.id, lvl.short, path) && "with a note",
    pathEdited(path) && EDITED_NOTE,
    data.release && pathReleased(path) && `changed in the ${data.release.name} release`,
  ]
    .filter(Boolean)
    .join(", ");
}
