// Shared fixtures for the unit tests.

// the two shipped geometries; map-data.test.js pins the real data files to these
export const AO_GEOMETRY = {
  cellW: 368,
  cellH: 240,
  worldW: 1024,
  worldH: 480,
  winX: 256,
  winY: 120,
  visW: 368,
  visH: 240,
};
export const AE_GEOMETRY = {
  cellW: 368,
  cellH: 240,
  worldW: 375,
  worldH: 260,
  winX: 0,
  winY: 0,
  visW: 368,
  visH: 240,
};

// unlike either game: a window offset, and screens spaced wider apart than the
// window they show, so neither a live-binding bug nor a pitch mistaken for a
// scale can hide behind real values
export const SYNTH_GEOMETRY = {
  cellW: 300,
  cellH: 150,
  worldW: 400,
  worldH: 200,
  winX: 40,
  winY: 20,
  visW: 200,
  visH: 100,
};

// a geometry at both layouts: as the data ships it, and at the cell's own
// pitch, where the slack between windows is canvas rather than folded away
export const pitches = (g) => [g, { ...g, cellW: g.worldW, cellH: g.worldH }];

// the follows that leave their level, pinned whole: a test that derives its own
// oracle passes whatever the shipped code does, so this literal is the oracle
export const CROSS_LEVEL_FOLLOWS = {
  AO: [
    "D1 P9 -> D2 P1",
    "D2 P10 -> D7 P11",
    "D7 P11 -> D2 P10",
    "D7 P11 -> L1 P5",
    "E1 P4 -> L1 P1",
    "E1 P6 -> R1 P20",
    "E2 P2 -> R2 P19",
    "F1 P9 -> F2 P1",
    "F2 P8 -> F4 P9",
    "F4 P9 -> F2 P8",
    "F4 P9 -> L1 P5",
    "L1 P1 -> S1 P1",
    "L1 P6 -> D1 P1",
    "L1 P6 -> E2 P4",
    "L1 P6 -> F1 P1",
    "R1 P19 -> S1 P1",
    "R1 P20 -> E1 P6",
    "R2 P11 -> R6 P6",
    "R6 P6 -> R2 P11",
  ],
  AE: [
    "BA P16 -> FD P2",
    "BR P25 -> BM P1",
    "BW P1 -> FD P4",
    "BW P12 -> FD P2",
    "FD P3 -> BA P1",
    "FD P4 -> BW P1",
    "FD P5 -> BR P16",
    "MI P6 -> NE P2",
    "NE P5 -> PV P1",
    "NE P5 -> SV P6",
    "PV P13 -> NE P5",
    "SV P11 -> NE P5",
  ],
};

// minimal dataset builders, shaped like the generated map data
export const tlv = (name, extra = null) => ({
  t: 0,
  name,
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
  ...(extra ? { extra } : {}),
});
export const path = (id, tlvs, cams = [], w = 1, h = 1) => ({ id, w, h, cams, tlvs, lines: [] });
export const level = (short, ...paths) => ({ short, name: short, paths });
export const dataset = (levels, geometry = SYNTH_GEOMETRY) => ({ id: "XX", levels, geometry });

// a TLV moved to world position (x, y); SYNTH_GEOMETRY cells are 400x200 units
export const at = (t, x, y) => ({ ...t, x1: x, y1: y, x2: x + 10, y2: y + 10 });
