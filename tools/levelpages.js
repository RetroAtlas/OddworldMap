// Emits the crawlable per-level pages: one plain HTML page per level under
// public/levels/, the /levels/ index, and sitemap.xml naming them all.
// Deterministic over map_data_{ao,ae}.json + annotations.json alone.
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  pathDisplayName,
  pathNickname,
  pathNote,
  setAnnotations,
} from "../public/js/model/annotations.js";
import { displayLabel } from "../public/js/data/settings.js";
import { levelEntry, levelOrder } from "../public/js/model/pathorder.js";
import { isDemoPath } from "../public/js/model/demo.js";
import { esc } from "../public/js/model/util.js";

const ORIGIN = "https://oddworldmap.com";
const PUBLIC = new URL("../public/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, PUBLIC), "utf8"));

const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const nf = (x) => x.toLocaleString("en-US");
const count = (x, word, plural = `${word}s`) => `${nf(x)} ${x === 1 ? word : plural}`;
const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
const gameShort = (data) => data.game.replace(/^Oddworld:\s*/, "");

const CSS = `      body {
        margin: 0;
        background: #14161a;
        color: #d8dbe2;
        font: 15px/1.5 -apple-system, "Segoe UI", sans-serif;
      }
      header, main, footer {
        max-width: 640px;
        margin: 0 auto;
        padding: 0 20px;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 18px;
      }
      header .mark {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgb(232, 163, 61);
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-decoration: none;
      }
      header nav { margin-left: auto; }
      a { color: rgb(232, 163, 61); }
      h1 { margin: 26px 0 2px; font-size: 26px; color: rgb(232, 163, 61); }
      .sub { margin: 0 0 14px; color: #8a8f9c; }
      figure { margin: 18px 0; }
      figure img { max-width: 100%; height: auto; border: 1px solid #32363f; border-radius: 4px; }
      figcaption { margin-top: 4px; color: #8a8f9c; font-size: 13px; }
      h2 { margin: 24px 0 8px; font-size: 16px; }
      ol, ul { margin: 0; padding: 0; list-style: none; }
      li { padding: 4px 0; }
      .meta, .nick { color: #8a8f9c; }
      .note { margin: 2px 0 0; color: #8a8f9c; font-size: 13px; }
      .foot { margin-top: 14px; color: #8a8f9c; font-size: 13px; }
      footer {
        margin-top: 32px;
        padding-top: 16px;
        padding-bottom: 26px;
        border-top: 1px solid #32363f;
        color: #8a8f9c;
        font-size: 12px;
      }`;

function page({ title, description, canonical, main }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#14161a" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <style>
${CSS}
    </style>
  </head>
  <body>
    <header>
      <a class="mark" href="/"><img src="/favicon.svg" alt="" width="20" height="20" /> Oddworld Map</a>
      <nav><a href="/levels/">All levels</a></nav>
    </header>
    <main>
${main}
    </main>
    <footer>
      <p>
        oddworldmap.com is an unofficial, fan-made interactive map. Oddworld, Mudokons, Glukkons,
        and all related characters and designs are registered trademarks and copyrights of Oddworld
        Inhabitants, Inc. This project is not affiliated with, endorsed, or sponsored by Oddworld
        Inhabitants.
      </p>
      <p>
        <a href="/">Open the map</a> · <a href="/levels/">All levels</a> ·
        <a href="https://github.com/RetroAtlas/OddworldMap">Source</a>
      </p>
    </footer>
  </body>
</html>
`;
}

// the path button's own text, so a page and the app name a path alike
function pathItem(data, L, P) {
  const name = pathDisplayName(data.id, L.short, P);
  const nick = pathNickname(data.id, L.short, P);
  const note = pathNote(data.id, L.short, P);
  const parts = [
    `<a href="/#${data.id}/${L.short}/${P.id}">${esc(displayLabel(`P${P.id}`, name, true))}</a>`,
  ];
  if (nick) parts.push(`<span class="nick">· ${esc(nick)}</span>`);
  parts.push(
    `<span class="meta">· ${count(P.cams.length, "screen")}, ${count(P.tlvs.length, "object")}</span>`,
  );
  const row = parts.join(" ");
  return note
    ? `        <li>\n          ${row}\n          <p class="note">${esc(note)}</p>\n        </li>`
    : `        <li>${row}</li>`;
}

const demoFootnote = (n, of = "these areas") =>
  `      <p class="foot">Counts leave out ${count(n, "copy", "copies")} of ${of} that only the title-screen demos play.</p>`;

// a pinned page screen where the default pick (the entry path's first stored
// camera) is not the level's face
const SCREEN_OVERRIDES = {
  "AO L1": "L1P01C14",
  "AO F2": "F2P08C01",
  "AO F4": "F4P09C13",
  "AO D2": "D2P10C01",
  "AO D7": "D7P11C12",
  "AO E2": "E2P04C07",
  "AO R2": "R2P19C03",
  "AO R6": "R6P06C08",
  "AO C1": "C1P01C24",
  "AO S1": "S1P01C01",
  "AE MI": "MIP01C04",
  "AE NE": "NEP02C01",
  "AE FD": "FDP01C01",
  "AE BW": "BWP01C01",
  "AE ST": "STP01C01",
};

function pageScreen(data, L, entry, pins) {
  const pin = pins[`${data.id} ${L.short}`];
  let shot = { cam: entry.cams[0], path: entry };
  if (pin) {
    const path = L.paths.find((P) => P.cams.some((c) => c.name === pin));
    if (!path) throw new Error(`${data.id} ${L.short}: pinned screen ${pin} not found`);
    const cam = path.cams.find((c) => c.name === pin);
    if (cam === entry.cams[0])
      throw new Error(`${data.id} ${L.short}: pin ${pin} is the default pick; retire the entry`);
    shot = { cam, path };
  }
  if (!shot.cam?.png)
    throw new Error(
      `${data.id} ${L.short}: page screen ${shot.cam?.name ?? "(none)"} has no artwork; pin one that does`,
    );
  return shot;
}

function levelPage(data, L, canonical, pins) {
  const byId = new Map(L.paths.map((P) => [P.id, P]));
  const kept = levelOrder(data, L)
    .map((id) => byId.get(id))
    .filter((P) => !isDemoPath(P));
  const demo = L.paths.length - kept.length;
  const screens = sum(kept, (P) => P.cams.length);
  const objects = sum(kept, (P) => P.tlvs.length);
  const lines = sum(kept, (P) => P.lines.length);
  const disc = data.id === "AE" ? "discs" : "disc";

  const entry = byId.get(levelEntry(data)[L.short]);
  const shot = pageScreen(data, L, entry, pins);
  const shotLabel = displayLabel(
    `P${shot.path.id}`,
    pathDisplayName(data.id, L.short, shot.path),
    true,
  );
  const onEntry = shot.path === entry;

  // up to three named areas, play order, for the description sentence
  const areas = [];
  for (const P of kept) {
    const raw = pathDisplayName(data.id, L.short, P);
    const area = raw && raw.split(":")[0].trim();
    if (area && !areas.includes(area)) areas.push(area);
    if (areas.length === 3) break;
  }
  const named =
    areas.length === 0
      ? ""
      : ` Areas include ${areas.length === 1 ? areas[0] : `${areas.slice(0, -1).join(", ")} and ${areas.at(-1)}`}.`;
  const description =
    `Map of ${L.name} in ${gameShort(data)}: ${count(kept.length, "path")}, ` +
    `${count(screens, "screen")} and ${count(objects, "object")}, read straight from the ` +
    `game ${disc}. Every path opens in the interactive map.${named}`;

  // the ender tail is contiguous in the walk, so grouping by section as met
  // yields the main run then one list per section
  const groups = [{ section: "", paths: [] }];
  for (const P of kept) {
    const section = P.section || "";
    if (groups.at(-1).section === section) groups.at(-1).paths.push(P);
    else groups.push({ section, paths: [P] });
  }
  const lists = groups
    .filter((g) => g.paths.length)
    .map(
      (g) =>
        `      <h2>${g.section ? esc(g.section) : "Paths in play order"}</h2>\n      <ol>\n` +
        g.paths.map((P) => pathItem(data, L, P)).join("\n") +
        `\n      </ol>`,
    )
    .join("\n");

  const main = `      <h1>${esc(L.name)}</h1>
      <p class="sub">${esc(data.game)} — level ${L.short}</p>
      <p>
        ${esc(L.name)} is one of ${data.levels.length} levels in ${esc(gameShort(data))}:
        ${count(kept.length, "path")} across ${count(screens, "screen")}, holding
        ${count(objects, "object")} and ${count(lines, "collision line")}, every one read from
        the game ${disc}. <a href="/#${data.id}/${L.short}/${entry.id}">Open ${esc(L.name)} in
        the interactive map</a>.
      </p>
      <figure>
        <img src="/${shot.cam.png}" alt="Screen ${shot.cam.name}, ${onEntry ? "on the entry path of" : "in"} ${esc(L.name)}" width="368" height="240" />
        <figcaption>A screen of ${onEntry ? "the entry path, " : ""}${esc(shotLabel)}.</figcaption>
      </figure>
${lists}${demo ? `\n${demoFootnote(demo)}` : ""}`;

  return page({
    title: `${L.name} — ${gameShort(data)} level map — Oddworld Map`,
    description,
    canonical,
    main,
  });
}

function indexPage(games) {
  const kept = (L) => L.paths.filter((P) => !isDemoPath(P));
  const totals = games.map((data) => ({
    levels: data.levels.length,
    paths: sum(data.levels, (L) => kept(L).length),
    screens: sum(data.levels, (L) => sum(kept(L), (P) => P.cams.length)),
    objects: sum(data.levels, (L) => sum(kept(L), (P) => P.tlvs.length)),
    demo: sum(data.levels, (L) => L.paths.length - kept(L).length),
  }));
  const all = totals.reduce((a, t) => ({
    levels: a.levels + t.levels,
    paths: a.paths + t.paths,
    screens: a.screens + t.screens,
    objects: a.objects + t.objects,
    demo: a.demo + t.demo,
  }));

  const sections = games
    .map((data, i) => {
      const rows = data.levels
        .map((L) => {
          const ks = kept(L);
          return (
            `        <li><a href="/levels/${data.id.toLowerCase()}/${slugOf(L.name)}.html">${esc(L.name)}</a> ` +
            `<span class="meta">(${L.short}) · ${count(ks.length, "path")}, ` +
            `${count(
              sum(ks, (P) => P.cams.length),
              "screen",
            )}, ${count(
              sum(ks, (P) => P.tlvs.length),
              "object",
            )}</span></li>`
          );
        })
        .join("\n");
      return `      <h2>${esc(data.game)}</h2>\n      <ul>\n${rows}\n      </ul>${
        totals[i].demo ? `\n${demoFootnote(totals[i].demo, "areas")}` : ""
      }`;
    })
    .join("\n");

  const main = `      <h1>All levels</h1>
      <p class="sub">${count(all.levels, "level")} · ${count(all.paths, "path")} · ${count(all.screens, "screen")} · ${count(all.objects, "object")}</p>
      <p>
        Every level of both games, each on a plain page of its own: the paths it is built from,
        in the order a player meets them, with links into <a href="/">the interactive map</a>.
      </p>
${sections}`;

  return page({
    title: "All levels — Oddworld Map",
    description:
      `Every level of Oddworld: Abe's Oddysee and Abe's Exoddus — ${count(all.levels, "level")}, ` +
      `${count(all.paths, "path")}, ${count(all.screens, "screen")} and ${count(all.objects, "object")}, ` +
      `each level on a page of its own, opening in the interactive map.`,
    canonical: `${ORIGIN}/levels/`,
    main,
  });
}

const sitemap = (locs) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  locs.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
  `\n</urlset>\n`;

export function emitFiles({
  games = [load("map_data_ao.json"), load("map_data_ae.json")],
  annotations = load("annotations.json"),
  pins = SCREEN_OVERRIDES,
} = {}) {
  setAnnotations(annotations);
  const known = new Set(games.flatMap((d) => d.levels.map((L) => `${d.id} ${L.short}`)));
  for (const key of Object.keys(pins))
    if (!known.has(key)) throw new Error(`screen pin ${JSON.stringify(key)} names no level`);
  const files = new Map();
  const locs = [`${ORIGIN}/`, `${ORIGIN}/levels/`];
  for (const data of games) {
    const seen = new Set();
    for (const L of data.levels) {
      const slug = slugOf(L.name);
      if (!slug || seen.has(slug))
        throw new Error(`${data.id} ${L.short}: unusable slug ${JSON.stringify(slug)}`);
      seen.add(slug);
      const rel = `levels/${data.id.toLowerCase()}/${slug}.html`;
      files.set(rel, levelPage(data, L, `${ORIGIN}/${rel}`, pins));
      locs.push(`${ORIGIN}/${rel}`);
    }
  }
  files.set("levels/index.html", indexPage(games));
  files.set("sitemap.xml", sitemap(locs));
  return files;
}

export function* htmlUnder(dirUrl, rel) {
  for (const e of readdirSync(dirUrl, { withFileTypes: true })) {
    if (e.isDirectory()) yield* htmlUnder(new URL(`${e.name}/`, dirUrl), `${rel}${e.name}/`);
    else if (e.name.endsWith(".html")) yield `${rel}${e.name}`;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const files = emitFiles();
  for (const [rel, text] of files) {
    const url = new URL(rel, PUBLIC);
    mkdirSync(new URL(".", url), { recursive: true });
    writeFileSync(url, text);
  }
  // a renamed level must not strand its old page
  for (const rel of [...htmlUnder(new URL("levels/", PUBLIC), "levels/")])
    if (!files.has(rel)) rmSync(new URL(rel, PUBLIC));
  console.log(`wrote ${files.size} files into public/`);
}
