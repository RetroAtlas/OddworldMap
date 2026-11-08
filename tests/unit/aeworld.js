import { state } from "../../public/js/state.js";
import { setEnumLabels, setFieldTypes } from "../../public/js/fields.js";
import { deriveExtra } from "../../public/js/extra.js";
import { setLevelShort } from "../../public/js/edits.js";
import { AE_GEOMETRY } from "./fixtures.js";

export const SHORT = { 0: "ST", 1: "MI", 2: "NE" };
setLevelShort("AE", SHORT);
// one typed field, so the label guard has something to refuse
setFieldTypes({ AE: { Door: { door_type: "DoorTypes" } } });
setEnumLabels({ AE: { DoorTypes: { 0: "normal", 1: "hub" } } });

export const DOOR = {
  level: 1,
  path: 1,
  camera: 17,
  scale: 0,
  door_number: 1,
  switch_id: 0,
  target_door_id: 0,
  door_type: 0,
};
export const door = (x1, y1, f = {}) => {
  const t = { t: 5, name: "Door", x1, y1, x2: x1 + 24, y2: y1 + 24, fields: { ...DOOR, ...f } };
  return { ...t, extra: deriveExtra("AE", t, SHORT) };
};
export const plain = (name, x1, y1) => ({
  t: 1,
  name,
  x1,
  y1,
  x2: x1 + 10,
  y2: y1 + 10,
  extra: {},
});

// a two-path Exoddus level shaped like the map data, the second path a demo copy
export function world() {
  const p1 = {
    id: 1,
    w: 2,
    h: 1,
    cams: [],
    tlvs: [door(10, 10), door(400, 10, { door_number: 2 }), plain("Hoist", 50, 50)],
    lines: [],
  };
  const p2 = {
    id: 2,
    w: 1,
    h: 1,
    cams: [],
    tlvs: [plain("DemoSpawnPoint", 0, 0), door(20, 20)],
    lines: [],
  };
  return {
    id: "AE",
    game: "Abe's Exoddus",
    geometry: AE_GEOMETRY,
    levels: [{ id: 1, short: "MI", name: "Mines", paths: [p1, p2] }],
  };
}
export function stand(G, pa = 1) {
  state.games = [G];
  state.data = G;
  state.lvl = G.levels[0];
  state.path = G.levels[0].paths.find((P) => P.id === pa);
  state.sel = null;
}
