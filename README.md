# Oddworld Map

Interactive map of **Oddworld: Abe's Oddysee** and **Abe's Exoddus** (PS1, NTSC-U), extracted directly from the game discs: every camera background, every object (doors, levers, Mudokons, LCD status boards, hazards, enemies, ...) and every collision line, laid out on the games' real camera grids. The data comes from the PS1 discs, but level layouts, screens and object placements are the same in the PC releases, so the map applies to every version of the games.

Browse it at **[oddworldmap.com](https://oddworldmap.com/)**, part of [RetroAtlas](https://retroatlas.org/), a collection of interactive maps of classic games.

![The viewer on Stock Yards in Oddysee, inspecting a travel bird portal](screenshot.png)

One grid cell = one in-game camera: the viewer lays the games' camera screens out edge to edge on their real world grid and translates every object and collision coordinate to match, so markers land on the artwork.

## What the map does

- **Every screen, object and collision line** of both games on the real camera grid, with overlays for what the games keep invisible, from the collision lines to the gaps between screens.
- **Objects as the game draws them**: every sprite where the game stands it, animated at the engine's own pace down to the LCD boards scrolling their messages, with the creatures walking their beats; or every object as a plain marker, the reference view.
- **Decoded fields in plain English**: hover an object for what it is and what the game stores about it, translated into words and units; in the screen list a definition sits behind every field name and an encyclopedia card behind every type, and a sign reads out what it actually scrolls.
- **A list for every screen**, grouped by category, and a numbers panel counting the types you pick from one screen up to the whole game.
- **Follow the way through**: click a door, a well or any other way out to land where it leads, across levels too; connection arrows draw a path's whole circulation, and switch wiring draws what each lever actually does.
- **Where you are**: the level and path named at every step, with the nickname players gave the place and a note where something about it is odd, and a shuffle to a random screen of either game.
- **Search across both games**: object names and decoded values, the text on the signs, and the places themselves, down to a single screen.
- **Ruler and route planner**: measure in the games' own units, or plot a route that rides doors and wells onto the paths beyond and travels in the link.
- **World graph**: the whole game as one diagram, every path a box and every way between two of them a line; click a box to travel there, or save it as SVG or PNG.
- **Edit objects**: a sandbox on your device for reshaping a path's objects, with undo and what the disc shipped beside every change; edited data says so wherever it shows, and no edit ever travels in a link.
- **Exports**: a whole path or the current view as an image, with the overlays and route that are on, and any path as the JSON the [AliveTeam level editor](https://github.com/AliveTeam/qt-editor) imports.
- **Links to everything**: the address always reflects the view, an object has a link of its own that centres and marks it, and an embed mode fits the map into an iframe on a wiki or forum.
- **Offline**: opt in and the map keeps itself and every screen you visit on the device, or a whole game's artwork in one download, so it opens with no connection.
- **Keyboard and screen reader**: the map, its panels and its toggles work from the keyboard, with the shortcut list in the app; arriving somewhere is spoken, and the map is named rather than left an anonymous picture. On a phone, drag pans, pinch zooms and the panels open as bottom sheets.
- **What's new**: a dated feed of the map's updates, in the app, marking what you have not seen yet.

## What the discs hold

Each level is a `.LVL` archive holding the level's path data and one `.CAM` file per camera. A path is one chunk: its camera table, its collision lines and a run of TLV object records, each a small header and a type-specific payload, which the builder walks and places by world coordinates; a camera is a set of MDEC-compressed strips, decoded and assembled into the 368×240 screen the player sees; and the sprites the objects wear and the message tables the signs scroll are read off the discs as well. The record layouts, the level and path tables, the object types and their fields come from the [alive_reversing](https://github.com/AliveTeam/alive_reversing) decompilation, read from one pinned checkout. The games address their cameras on a grid coarser than the screen, the rest of each cell being slack they never render, which the map folds away. The discs name few of their paths, so most names on the map are curated, from the games' own signage and the walkthroughs credited below.

## Running and rebuilding

The viewer under `public/` is dependency-free vanilla JavaScript with no build step, so serving that folder with any static web server runs the map locally:

```bash
python3 -m http.server -d public
```

The discs are never committed. The generated data under `public/` (the camera artwork, the sprite sheets and each game's `map_data` file, holding its levels, paths, objects and collision lines) is built by [tools/build_map.py](tools/build_map.py) from raw PS1 disc images (2352-byte sectors, the `.bin` of a `.cue/.bin` dump), Exoddus taking both of its discs:

```bash
python3 tools/build_map.py --game AO --disc "/path/to/Abe's Oddysee.bin"
python3 tools/build_map.py --game AE --disc "/path/to/Exoddus (Disc 1).bin" "/path/to/Exoddus (Disc 2).bin"
```

`--disc` can be omitted when `$ODDWORLD_DISC_AO` / `$ODDWORLD_DISC_AE` point at the images. Everything a build writes is generated **and committed**, so regenerate it rather than hand-editing; what a build needs, the oxipng release it pins and how to check one against the last are in [docs/builder.md](docs/builder.md).

Beside the builder, [tools/visit.py](tools/visit.py) writes a PlayStation memory card whose saves start Abe's Oddysee at the place a permalink names, so what the map shows can be checked against the game itself, and [tools/relive_export.py](tools/relive_export.py) and its siblings write every path as the level editor's JSON and run each document through the editor's own reader.

## Where the rest is

- [docs/viewer.md](docs/viewer.md): the map control by control, the overlays, the ruler and the route planner, the numbers panel, the world graph, editing objects, sharing and embedding, and the settings.
- [docs/format-gotchas.md](docs/format-gotchas.md): the disc formats and their traps: the camera grid and its window, cams and foreground masks, TLV records, destinations and when one is trusted, express wells and bird portals, message tables, the Exoddus discs, ender levels and demo paths.
- [docs/builder.md](docs/builder.md): what a build needs and writes, the PNG recompression pin, the level pages and the sitemap, and the static files beside the data.
- [docs/decomp.md](docs/decomp.md): the pinned decompilation checkout, the caches parsed from it, the field-type and enum-label sidecars, and the override and correction tables.
- [docs/relive.md](docs/relive.md): the level editor's JSON export, the caches it draws on, and the oracle it answers to.
- [docs/visit.md](docs/visit.md): what an Oddysee save holds and how loading one starts a path, where a permalink puts Abe, and the emulator profile the visit tool launches.
- [docs/curated-data.md](docs/curated-data.md): how the path names, the field glossary and the type encyclopedia are curated, which source each name follows, and the tests that hold each file to its shape.
- [CLAUDE.md](CLAUDE.md): the rules for changing any of it and the checks a commit passes, with the index of every topic doc, the viewer's area docs, testing and the stylesheet among them.
- [backlog/](backlog/): the plans, what reviews found and what came of both, one file per item.

## Credits & licensing

- Game data formats reverse-engineered by the [AliveTeam / alive_reversing](https://github.com/AliveTeam/alive_reversing) project.
- Curated path names in [annotations.json](public/annotations.json) draw on Oddworld: New 'n' Tasty's official chapter names, the games' own signage, hint flies and story stones, the [Barebones walkthrough](https://steamcommunity.com/sharedfiles/filedetails/?id=1812678216) on Steam, MCJohn117Chief's [GameFAQs walkthrough](https://gamefaqs.gamespot.com/pc/198221-oddworld-abes-exoddus/faqs/74324) and the [Oddworld Wiki](https://oddworld.fandom.com/wiki/SoulStorm_Brewery_(level)), whose names for the Brewery's zulags the map carries as nicknames; [docs/curated-data.md](docs/curated-data.md) says which name follows which. A curated name may refine the games' own coarse labels, but the extracted data is never altered.
- `tools/PSXMDECDecoder.{cpp,h}` are GPL-2.0 (see file headers; originally from libbs / psxdev). The rest of the tooling and the viewer were written for this project, bar the two ported decoders below.
- `decode_psx67` in [tools/oddmap/sprites.py](tools/oddmap/sprites.py) and `decompress_4or5` in [tools/oddmap/image.py](tools/oddmap/image.py) are Python ports of two frame decoders from [paulsapps/alive](https://github.com/paulsapps/alive) (MIT, © 2015 paulsapps; the notice is reproduced in [LICENSE](LICENSE)).
- Oddworld: Abe's Oddysee and Abe's Exoddus are © Oddworld Inhabitants. This project ships none of the games' own code (the object rules and the brains in the viewer are this project's own JavaScript, written from the decompilation's reading of the games' logic) and is intended for research, speedrunning and preservation; the extracted imagery remains the property of its copyright holders. The site says as much in the app, behind the sidebar's "About this map" link.
- Copyright (C) 2026 mariobob, under GPL-2.0 (see [LICENSE](LICENSE)). The licence covers the code written for this project and nothing else: not the vendored decoder above, and not the extracted imagery, which was never this project's to license.
- A rights holder who wants something taken down can write to hello@retroatlas.org.
