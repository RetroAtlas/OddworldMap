// Somewhere odd: the shuffle button beside the place chip jumps to a random
// screen of either game. Demo paths follow their setting, and the handful of
// art-less cams stay out — a blank cell is nobody's prize.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { camIdOf } from "./model.js";
import { pathVisible } from "./pathvisible.js";
import { jumpToPlace } from "./navigate.js";
import { SHUFFLE_SVG } from "./icons.js";

const btn = $("shuffleBtn");
btn.innerHTML = SHUFFLE_SVG;

btn.onclick = () => {
  const pool = [];
  for (const G of state.games)
    for (const L of G.levels)
      for (const P of L.paths) {
        if (!pathVisible(P)) continue;
        for (const c of P.cams) {
          const cam = camIdOf(c.name);
          if (cam != null && c.png) pool.push({ G, L, P, cam });
        }
      }
  const s = pool[Math.floor(Math.random() * pool.length)];
  if (s) jumpToPlace(s.G, s.L.short, s.P.id, s.cam);
};

window.addEventListener("selection-changed", () => {
  btn.hidden = !state.path;
});
