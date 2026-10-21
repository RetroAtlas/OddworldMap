// The diagram as a standalone SVG file: the same worldGraph + graphLayout the
// screen draws, serialized with everything inlined — presentation attributes
// only, no classes, no var(), no external references — so the file renders
// wherever it lands. Importable in bare Node: no DOM.

import { pathDisplayName } from "./annotations.js";
import { CONN_COLORS, GRAPH } from "./config.js";
import { isDemoPath } from "./demo.js";
import { pathEdited } from "./edits.js";
import { computeEntryPaths } from "./model.js";
import { esc } from "./util.js";
import { graphLayout, worldGraph } from "./worldgraph.js";

// main.css's :root resolved by hand — a standalone file cannot ask for var()
export const INK = {
  bg: "#14161a",
  panel: "#1d2026",
  text: "#d8dbe2",
  dim: "#8a8f9c",
  line: "#32363f",
  accent: "#e8a33d",
  edit: "#5fd8e8",
};

const STRIP = 44; // the title band above the diagram

export const marker = (kind) =>
  `<marker id="gvh-${kind}" viewBox="0 0 7 6" refX="6.5" refY="3" markerWidth="7" markerHeight="6"` +
  ` orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="${CONN_COLORS[kind] || "#fff"}"/></marker>`;

// the drawn line of one route, shared by the screen and the file. A head marks
// a one-way link and nothing else: nearly every pair runs both ways, so a head
// on each travelable end would spend the mark on "ordinary". It sits on the
// travel end — a reverse-only route is emitted backwards rather than asking
// for auto-start-reverse, which not every SVG renderer implements.
export function wirePath({ e, pts }, attrs = "") {
  const p = e.rev && !e.fwd ? [...pts].reverse() : pts;
  const head = e.fwd && e.rev ? "" : ` marker-end="url(#gvh-${e.kind})"`;
  return (
    `<path${attrs} d="${p.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}"` +
    ` stroke="${CONN_COLORS[e.kind] || "#fff"}"${head}/>`
  );
}

export const graphName = (id, demo, edited, ext, release = null) =>
  `oddworld-${id.toLowerCase()}${release ? `-${release}` : ""}-graph${demo ? "-demos" : ""}${edited ? "-edited" : ""}.${ext}`;

// `scale` multiplies only the root width/height over a constant viewBox, so a
// rasterizer that draws at intrinsic size is still crisp at 2x. Numeric
// baselines throughout: dominant-baseline is stripped by some sanitizers, and
// the uppercase and entry marks the stylesheet supplies on screen have to be
// written into the text itself.
export function graphSvg(data, { entry = computeEntryPaths(data), scale = 1 } = {}) {
  const g = worldGraph(data);
  const laid = graphLayout(g);
  const w = laid.w,
    h = laid.h + STRIP;
  const demo = [...g.nodes.values()].some((n) => isDemoPath(n.P));
  const edited = [...g.nodes.values()].some((n) => pathEdited(n.P));
  const kinds = [...new Set(g.edges.map((e) => e.kind))].sort();
  const name =
    (data.game || data.id).replace(/^Oddworld:\s*/, "") +
    (data.release ? `, ${data.release.name}` : "");
  const title =
    `${name} — ${g.nodes.size} paths, ${g.edges.length} links` +
    `${demo ? ", with demo paths" : ""}${edited ? ", with edits made on this device" : ""}`;

  const head = (c) =>
    `<text x="${c.x}" y="${laid.top - GRAPH.headH + 12}" font-size="12" font-weight="600"` +
    ` fill="${INK.accent}"><tspan font-weight="700">${esc(c.L.short)}</tspan>` +
    `<tspan dx="4">${esc(c.L.name)}</tspan></text>`;
  const sec = (c) =>
    c.sec
      ? `<rect x="${c.x}" y="${c.sec.y}" width="${GRAPH.nodeW}" height="1" fill="${INK.line}"/>` +
        `<text x="${c.x}" y="${c.sec.y + 12}" font-size="10" letter-spacing="0.4"` +
        ` fill="${INK.dim}">${esc(c.sec.label.toUpperCase())}</text>`
      : "";
  // the rect at half-pixel offsets, one unit smaller: an SVG stroke straddles
  // its path where the DOM border sat inside the box. Only the text is clipped
  // — a clipped rect loses its own right edge.
  const node = (n) => {
    const { x, y } = laid.box(n);
    const pathName = pathDisplayName(data.id, n.lv, n.P) || "";
    const mark = entry[n.lv]?.has(n.pa) ? `<tspan fill="${INK.accent}">▸</tspan>` : "";
    const changed = pathEdited(n.P)
      ? `<tspan${mark ? ' dx="4"' : ""} fill="${INK.edit}">◆</tspan>`
      : "";
    return (
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="${GRAPH.nodeW - 1}" height="${GRAPH.nodeH - 1}"` +
      ` rx="4" fill="${INK.panel}" stroke="${INK.line}"/>` +
      `<g transform="translate(${x + 8},${y})" clip-path="url(#gvt)"><text y="17">${mark}${changed}` +
      `<tspan${mark || changed ? ' dx="5"' : ""} fill="${INK.dim}">P${n.pa}</tspan>` +
      (pathName ? `<tspan dx="5" fill="${INK.text}">${esc(pathName)}</tspan>` : "") +
      `</text></g>`
    );
  };

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}"` +
    ` viewBox="0 0 ${w} ${h}" font-family="-apple-system, 'Segoe UI', sans-serif">` +
    `<title>${esc(name)} — world graph</title>` +
    `<rect width="${w}" height="${h}" fill="${INK.bg}"/>` +
    `<defs><clipPath id="gvt"><rect width="${GRAPH.nodeW - 16}" height="${GRAPH.nodeH}"/></clipPath>` +
    `${kinds.map(marker).join("")}</defs>` +
    `<text x="${GRAPH.pad}" y="27" font-size="13" font-weight="600" fill="${INK.text}">${esc(title)}</text>` +
    `<text x="${w - GRAPH.pad}" y="27" font-size="11" text-anchor="end">` +
    kinds
      .map(
        (k, i) =>
          `<tspan${i ? ' dx="14"' : ""} fill="${CONN_COLORS[k] || "#fff"}">${esc(k)}</tspan>`,
      )
      .join("") +
    `<tspan dx="18" fill="${INK.dim}">oddworldmap.com</tspan></text>` +
    `<rect y="${STRIP - 1}" width="${w}" height="1" fill="${INK.line}"/>` +
    `<g transform="translate(0,${STRIP})">` +
    // opacity per path, as the stylesheet's is: it composites the marker head
    // with its line, where a group stroke-opacity would leave heads solid
    `<g fill="none" stroke-width="1.4">${laid.routes.map((r) => wirePath(r, ' opacity="0.8"')).join("")}</g>` +
    `<g font-size="11">` +
    laid.cols.map((c) => sec(c) + c.nodes.map(node).join("") + head(c)).join("") +
    `</g></g></svg>`;
  return { svg, w, h, demo, edited };
}
