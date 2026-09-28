// World units to draw space and back, over a layout: a geometry whose
// cellW/cellH are the pitch its screens are laid out at. Reads nothing but
// its arguments.

export const drawAt = (v, cell, win, pitch) => {
  const c = Math.floor(v / cell);
  return c * pitch + (v - c * cell - win);
};

const worldAt = (d, cell, win, pitch) => {
  const c = Math.floor(d / pitch);
  return c * cell + win + (d - c * pitch);
};

export const drawX = (wx, layout) => drawAt(wx, layout.worldW, layout.winX, layout.cellW);
export const drawY = (wy, layout) => drawAt(wy, layout.worldH, layout.winY, layout.cellH);
export const worldX = (dx, layout) => worldAt(dx, layout.worldW, layout.winX, layout.cellW);
export const worldY = (dy, layout) => worldAt(dy, layout.worldH, layout.winY, layout.cellH);
