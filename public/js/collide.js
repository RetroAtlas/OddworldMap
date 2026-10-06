// The engine's collision geometry, as its own functions do it: the raycast
// against a path's lines, the grid snap, and the walk along a line that hands
// over to the linked one at its end. Pure functions over the archive's line
// list, so they import nothing and run in bare Node.

// the two shapes the rules ask the raycast in: the nearest y under a vertical
// probe, and the crossing along a diagonal one with its line's own ends
export const raycastDown = (lines, x, y1, y2, types) =>
  raycast(lines, x, y1, x, y2, types)?.y ?? null;
export function raycastDiag(lines, x1, y1, x2, y2, types) {
  const hit = raycast(lines, x1, y1, x2, y2, types);
  return hit && { x: hit.x, y: hit.y, line: lines[hit.line].slice(0, 4) };
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

// ScaleToGridSize: the grid a creature's probes and strides are measured in
export const gridSize = (half) => (half ? 13 : 25);

// the engine's raycast: the nearest crossing along the ray of a line whose type
// is among `types`, or null; a line parallel to the ray never counts
export function raycast(lines, x1, y1, x2, y2, types) {
  const minX = Math.floor(Math.min(x1, x2)),
    maxX = Math.floor(Math.max(x1, x2)),
    minY = Math.floor(Math.min(y1, y2)),
    maxY = Math.floor(Math.max(y1, y2));
  const dx = x2 - x1,
    dy = y2 - y1;
  let best = 2,
    hit = null;
  for (let i = 0; i < lines.length; i++) {
    const [ax, ay, bx, by, lt] = lines[i];
    if (!types.includes(lt)) continue;
    if (Math.min(ax, bx) > maxX || Math.max(ax, bx) < minX) continue;
    if (Math.min(ay, by) > maxY || Math.max(ay, by) < minY) continue;
    const lx = bx - ax,
      ly = by - ay;
    const det = lx * dy - dx * ly;
    if (Math.abs(det) < 1) continue;
    const u1 = lx * (ay - y1) - ly * (ax - x1);
    if (det > 0 ? u1 < 0 || u1 > det : u1 > 0 || u1 < det) continue;
    const u2 = dx * (ay - y1) - dy * (ax - x1);
    if (det > 0 ? u2 < 0 || u2 > det : u2 > 0 || u2 < det) continue;
    const t = u1 / det;
    if (t < best) {
      best = t;
      hit = i;
    }
  }
  return hit === null ? null : { line: hit, x: x1 + dx * best, y: y1 + dy * best };
}

// WallHit: a wall within offX of the point, probed offY above the feet
const WALLS = [1, 2];
export const wallHit = (lines, x, y, offY, offX, half) =>
  raycast(lines, x, y - offY, x + offX, y - offY, half ? WALLS.map((t) => t + 4) : WALLS) !== null;

// Check_IsOnEndOfLine: no floor `distance` grids ahead of the snapped foot
const FLOOR_MASK = [0, 1, 2, 3];
export function onEndOfLine(game, lines, x, y, half, left, distance) {
  const g = gridSize(half) * distance;
  const sx = snapX(game, x, half) + (left ? -g : g);
  return (
    raycast(lines, sx, y - 4, sx, y + 4, half ? FLOOR_MASK.map((t) => t + 4) : FLOOR_MASK) === null
  );
}

// the linked neighbour of a line, or the one whose matching end lies near its
// own; Exoddus asks for the same type, Oddysee for any
const NEAR = 8;
export function nextLine(lines, links, i, ao) {
  if (links?.[i]?.[1] !== undefined && links[i][1] !== -1) return links[i][1];
  const [, , bx, by, lt] = lines[i];
  for (let j = 0; j < lines.length; j++) {
    const [ax, ay, , , t] = lines[j];
    if (Math.abs(bx - ax) <= NEAR && Math.abs(by - ay) <= NEAR && (ao || t === lt)) return j;
  }
  return null;
}
export function prevLine(lines, links, i, ao) {
  if (links?.[i]?.[0] !== undefined && links[i][0] !== -1) return links[i][0];
  const [ax, ay, , , lt] = lines[i];
  for (let j = 0; j < lines.length; j++) {
    const [, , bx, by, t] = lines[j];
    if (Math.abs(ax - bx) <= NEAR && Math.abs(ay - by) <= NEAR && (ao || t === lt)) return j;
  }
  return null;
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// PathLine::MoveOnLine: the point `dist` further along line `i` in the line's
// own direction, carried onto the linked line past either end, or null where
// the chain ends
export function moveOnLine(lines, links, i, x, y, dist, ao) {
  const [ax, ay, bx, by] = lines[i];
  const xd = bx - ax,
    yd = by - ay;
  let nx, ny;
  const onto = (j, jx, jy, d) => (j === null ? null : moveOnLine(lines, links, j, jx, jy, d, ao));
  if (yd === 0) {
    nx = xd >= 0 ? x + dist : x - dist;
    ny = y;
  } else if (xd === 0) {
    if (yd >= 0) {
      ny = y + dist;
      if (ny > by) {
        const n = nextLine(lines, links, i, ao);
        return onto(n, n === null ? 0 : lines[n][0], n === null ? 0 : lines[n][1], ny - by);
      }
      if (ny < ay) {
        const p = prevLine(lines, links, i, ao);
        return onto(p, p === null ? 0 : lines[p][2], p === null ? 0 : lines[p][3], ny - ay);
      }
    } else {
      ny = y - dist;
      if (ny < by) {
        const n = nextLine(lines, links, i, ao);
        return onto(n, n === null ? 0 : lines[n][0], n === null ? 0 : lines[n][1], by - ny);
      }
      if (ny > ay) {
        const p = prevLine(lines, links, i, ao);
        return onto(p, p === null ? 0 : lines[p][2], p === null ? 0 : lines[p][3], ay - ny);
      }
    }
    return { line: i, x, y: ny };
  } else {
    let len = Math.hypot(xd, yd);
    if (len === 0) len = 1;
    nx = x + (dist * xd) / len;
    ny = y + (dist * yd) / len;
  }
  if (sign(nx - bx) === sign(bx - ax)) {
    const n = nextLine(lines, links, i, ao);
    if (n === null) return null;
    const toEnd = Math.hypot(bx - x, by - y);
    const moved = Math.hypot(nx - x, ny - y);
    return moveOnLine(lines, links, n, lines[n][0], lines[n][1], moved - toEnd, ao);
  }
  if (sign(nx - ax) === sign(ax - bx)) {
    const p = prevLine(lines, links, i, ao);
    if (p === null) return null;
    const moved = Math.hypot(nx - x, ny - y);
    const toStart = Math.hypot(ax - x, ay - y);
    return moveOnLine(lines, links, p, lines[p][2], lines[p][3], toStart - moved, ao);
  }
  return { line: i, x: nx, y: ny };
}

// TLV_Get_At: the first object of the name whose rectangle meets the probe
// rectangle, edges inclusive
export function tlvAt(tlvs, x1, y1, x2, y2, name) {
  const minX = Math.min(x1, x2),
    maxX = Math.max(x1, x2),
    minY = Math.min(y1, y2),
    maxY = Math.max(y1, y2);
  for (const t of tlvs)
    if (t.name === name && minX <= t.x2 && maxX >= t.x1 && maxY >= t.y1 && minY <= t.y2) return t;
  return null;
}

// CamX_VoidSkipper and CamY_VoidSkipper: Oddysee's screens sit 368 by 240 in
// cells of 1024 by 480, and the engine carries a point that lands in the void
// between them to `margin` units inside the next screen along its velocity;
// null where the point is on a screen, or close enough
export function camVoidX(x, vel, margin) {
  const v = Math.trunc(x) - 256;
  const div = Math.trunc(v / 512);
  const mod = v - div * 512;
  const odd = div % 2 !== 0;
  if ((!odd || mod >= 512 - margin) && (odd || mod <= margin + 368)) return null;
  if (vel <= 0) return div * 512 + margin + 112;
  return odd ? div * 512 - margin + 768 : div * 512 - margin + 1280;
}
export function camVoidY(y, vel, margin) {
  const v = Math.trunc(y) - 120;
  const idx = Math.trunc(v / 240);
  if (idx % 2 === 0) return null;
  const block = v - idx * 240;
  if (block >= 240 - margin || block <= margin) return null;
  return vel <= 0 ? 240 * idx + margin + 120 : 240 * idx - margin + 360;
}
