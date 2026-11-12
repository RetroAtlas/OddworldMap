// The order a path's artwork is asked for in: the screens showing in the view,
// then its sprite art, then the rest of its screens, nearest the view first.
// Importable in bare Node: no DOM.

const SLIVER = 0.1;
const REST_AT_ONCE = 4;

// whether more than a sliver of a cell's screen shows in a view: a tenth of the
// screen's side, or of the view's where the view is the smaller
export function showing(cell, path, layout, view) {
  const x = (cell % path.w) * layout.cellW,
    y = Math.floor(cell / path.w) * layout.cellH;
  const w = Math.min(x + layout.visW, view.x + view.w) - Math.max(x, view.x),
    h = Math.min(y + layout.visH, view.y + view.h) - Math.max(y, view.y);
  return w > SLIVER * Math.min(layout.visW, view.w) && h > SLIVER * Math.min(layout.visH, view.h);
}

// whether the sprite art holds no screen back: it is in, or nothing waits on it
export const artSettled = ({ objects, gated, sidecar, shown, artIn }) =>
  !objects || gated || sidecar === "failed" || (sidecar === "in" && (shown || artIn));

// cameras ordered by how near their screens lie to the middle of a view
export function nearestFirst(cams, path, layout, view) {
  const mx = view.x + (view.w - layout.visW) / 2,
    my = view.y + (view.h - layout.visH) / 2;
  const far = (c) =>
    ((c.cell % path.w) * layout.cellW - mx) ** 2 +
    (Math.floor(c.cell / path.w) * layout.cellH - my) ** 2;
  return [...cams].sort((a, b) => far(a) - far(b));
}

// whether a view stands complete: the screens showing in it have come, and the
// sprite art holds nothing back
export const viewComplete = (path, layout, view, { arrived, settled }) =>
  path.cams.filter((c) => c.png && showing(c.cell, path, layout, view)).every(arrived) && settled();

const NONE = new Set();

// the cameras a paint of a view asks for: those whose screens show in it, and
// once those have arrived and the sprite art holds nothing back, the rest,
// nearest first and a few at a time. `asked` and `arrived` say of a camera
// whether its files have been asked for and have come, `settled` of the art
export function wanted(path, layout, view, { asked, arrived, settled }) {
  if (path.cams.every((c) => !c.png || asked(c))) return NONE;
  const cams = path.cams.filter((c) => c.png);
  const want = new Set(cams.filter((c) => showing(c.cell, path, layout, view)));
  if (!viewComplete(path, layout, view, { arrived, settled })) return want;
  const rest = cams.filter((c) => !want.has(c));
  let room = REST_AT_ONCE - rest.filter((c) => asked(c) && !arrived(c)).length;
  const next = rest.filter((c) => !asked(c));
  for (const c of nearestFirst(next, path, layout, view)) if (room-- > 0) want.add(c);
  return want;
}
