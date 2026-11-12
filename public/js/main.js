// Boot: fetch the map data, then hand over to the modules.

import { GAMES_HOLD_MS } from "./config.js";
import { $, embedded } from "./ui/dom.js";
import { resize } from "./painter/render.js";
import { warmSprites } from "./painter/spriteart.js";
import { addGame, selectGame, applyHash } from "./navigation/navigate.js";
import {
  GAME_IDS,
  bootGame,
  gamesReleased,
  loadEditorData,
  loadFieldSidecars,
  loadGame,
  loadJson,
  releaseGames,
} from "./data/data.js";
import { hasStoredEdits, setEnabled } from "./data/edits.js";
import { setAnnotations } from "./model/annotations.js";
import { setFieldTypes, setEnumLabels } from "./model/fields.js";
import { setGlossary } from "./model/glossary.js";
import { setMessages } from "./model/messages.js";
import { setTypeInfo } from "./model/typeinfo.js";
import { storedLocationHash, clearStoredLocation } from "./data/settings.js";
import { initSettings } from "./chrome/settingsdialog.js";
import { syncNeeds } from "./chrome/sidebar.js";
import { state } from "./data/state.js";
import "./chrome/interaction.js";
import "./panels/search.js";
import "./chrome/export.js";
import { initFieldPanel } from "./panels/fieldpanel.js";
import "./chrome/a11y.js";
import "./ui/anchortip.js";
import "./panels/whatsnew.js";
import "./panels/about.js";
import "./panels/typecard.js";
import { initShuffle } from "./navigation/shuffle.js";
import { initNumbers } from "./panels/numbers.js";
import "./panels/editpanel.js";
import { initMinimap } from "./navigation/minimap.js";
import "./panels/graphview.js";
import { initOffline } from "./chrome/offline.js";

initShuffle();
initNumbers();
initMinimap();
initOffline();
initSettings();
syncNeeds();
initFieldPanel();

// the first view to stand complete lets the rest of the map go
window.addEventListener("view-complete", releaseGames, { once: true });

// ?embed=1: iframe view (wikis, forums) — chrome hides via body.embed, and
// the hash still works, so an embed can point at an exact screen
if (embedded) {
  document.body.classList.add("embed");
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
    releaseGames();
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
  // the rest of the map, behind the first view: once that stands complete, or
  // after a wait where it never does
  setTimeout(releaseGames, GAMES_HOLD_MS);
  await gamesReleased;
  for (const id of GAME_IDS) if (id !== G.id) loadGame(id).then(addGame);
});
