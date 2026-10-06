// Boot: fetch the map data, then hand over to the modules.

import { $ } from "./dom.js";
import { resize, warmSprites } from "./render.js";
import { addGame, selectGame, applyHash } from "./navigate.js";
import {
  GAME_IDS,
  bootGame,
  loadEditorData,
  loadFieldSidecars,
  loadGame,
  loadJson,
} from "./data.js";
import { hasStoredEdits, setEnabled } from "./edits.js";
import { setAnnotations } from "./annotations.js";
import { setFieldTypes, setEnumLabels } from "./fields.js";
import { setGlossary } from "./glossary.js";
import { setMessages } from "./messages.js";
import { setTypeInfo } from "./typeinfo.js";
import { initSettings, storedLocationHash, clearStoredLocation } from "./settings.js";
import { syncNeeds } from "./sidebar.js";
import { state } from "./state.js";
import "./search.js";
import "./export.js";
import { toggleMenu } from "./interaction.js";
import { initFieldPanel } from "./fieldpanel.js";
import "./a11y.js";
import "./anchortip.js";
import "./whatsnew.js";
import "./about.js";
import "./typecard.js";
import "./shuffle.js";
import "./numbers.js";
import "./editpanel.js";
import "./minimap.js";
import "./graphview.js";
import "./offline.js";

initSettings();
syncNeeds();
initFieldPanel();

// ?embed=1: iframe view (wikis, forums) — chrome hides via body.embed, and
// the hash still works, so an embed can point at an exact screen
const embedded = new URLSearchParams(location.search).get("embed") === "1";
if (embedded) {
  document.body.classList.add("embed");
  toggleMenu(false);
  setEnabled(false); // someone else's page shows the shipped map
}

// the game this visit is looking at, in flight while the sidecars come down:
// awaiting both games would spend the whole download budget of the one on
// screen before a line of it is drawn. A boot that will apply saved edits needs
// the editor data too, and one that opens with the objects shown the sprite
// table, so those fetches start beside the dataset's
const bootId = bootGame(location.hash, embedded ? null : storedLocationHash());
if (hasStoredEdits(bootId)) loadEditorData(bootId);
const booting = loadGame(bootId);
if (state.show.objects) warmSprites(bootId);

Promise.all([
  loadJson("annotations.json"),
  loadFieldSidecars("AO"),
  loadFieldSidecars("AE"),
  loadJson("glossary_fields.json"),
  loadJson("glossary_types.json"),
  loadJson("messages_ao.json"),
  loadJson("messages_ae.json"),
]).then(async ([annotations, fdAo, fdAe, glossary, types, msgAo, msgAe]) => {
  setAnnotations(annotations); // before the path buttons build their labels
  // before any tooltip/search prettifies
  setFieldTypes({ AO: fdAo.fieldTypes || {}, AE: fdAe.fieldTypes || {} });
  setEnumLabels({ AO: fdAo.enumLabels || {}, AE: fdAe.enumLabels || {} });
  setGlossary(glossary);
  setTypeInfo(types);
  setMessages({ AO: msgAo, AE: msgAe });
  // a dataset that fails still leaves the other game a map to draw
  let G = await booting;
  for (const id of GAME_IDS) if (!G) G = await loadGame(id);
  if (!G) {
    $("gameName").textContent = "Map data failed to load.";
    $("help").textContent =
      "map data failed to load — check that map_data_ao.json / map_data_ae.json are served";
    return;
  }
  addGame(G);
  resize();
  if (!(await applyHash())) {
    // no usable permalink in the URL: fall back to the remembered location
    // (never in an embed, which gets the default view). It may name the game
    // this boot did not fetch, which applyHash waits for rather than rejects
    const stored = embedded ? null : storedLocationHash();
    if (stored) history.replaceState(null, "", stored); // silent: no history entry, no hashchange
    if (!stored || !(await applyHash())) {
      if (stored) clearStoredLocation(); // its level or path no longer exists
      selectGame(G);
    }
  }
  // the rest of the map, behind the first paint
  for (const id of GAME_IDS) if (id !== G.id) loadGame(id, true).then(addGame);
});
