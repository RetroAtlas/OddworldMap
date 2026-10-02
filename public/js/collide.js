// The engine's collision geometry, as its own functions do it: the raycast
// against a path's lines, the grid snap, and the walk along a line that hands
// over to the linked one at its end. Pure functions over the archive's line
// list, so they import nothing and run in bare Node.

// the nearest point a vertical ray from (x, y1) towards y2 meets a line of one
// of the given types, as the engine's Raycast answers it, or null
export function raycastDown(lines, x, y1, y2, types) {
  let best = null;
  for (const [lx1, ly1, lx2, ly2, lt] of lines) {
    if (!types.includes(lt)) continue;
    const lo = Math.min(lx1, lx2),
      hi = Math.max(lx1, lx2);
    if (x < lo || x > hi) continue;
    const y = lx1 === lx2 ? Math.min(ly1, ly2) : ly1 + ((x - lx1) * (ly2 - ly1)) / (lx2 - lx1);
    if (y < Math.min(y1, y2) || y > Math.max(y1, y2)) continue;
    if (best === null || Math.abs(y - y1) < Math.abs(best - y1)) best = y;
  }
  return best;
}

// the nearest crossing along the ray from (x1, y1) to (x2, y2) of a line whose
// type is among `types`, with that line's own ends, or null
export function raycastDiag(lines, x1, y1, x2, y2, types) {
  let best = null;
  for (const [ax, ay, bx, by, lt] of lines) {
    if (!types.includes(lt)) continue;
    const d = (bx - ax) * (y2 - y1) - (by - ay) * (x2 - x1);
    if (!d) continue;
    const u = ((x1 - ax) * (y2 - y1) - (y1 - ay) * (x2 - x1)) / d;
    const v = ((x1 - ax) * (by - ay) - (y1 - ay) * (bx - ax)) / d;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    if (best === null || v < best.v)
      best = { v, x: x1 + v * (x2 - x1), y: y1 + v * (y2 - y1), line: [ax, ay, bx, by] };
  }
  return best;
}

// the x grid the engine snaps standing objects to, 25 units at full scale and
// 13 at half, each game measuring from its own origin (SnapToXGrid); a C
// remainder, which truncates toward zero
const rem = (a, b) => a - b * Math.trunc(a / b);
export function snapX(game, x, half) {
  if (half) {
    const r = rem(game === "AO" ? x - 11 : rem(x, 375) - 6, 13);
    return x - r + (r >= 7 ? 13 : 0);
  }
  const r = rem(game === "AO" ? x - 15 : x - 12, 25);
  return x - r + (r >= 13 ? 25 : 0);
}
