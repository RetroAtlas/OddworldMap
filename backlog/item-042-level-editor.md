# 42. Level editor — could this site host one?

**Status:** open — Phases 1 and 2 shipped, and Phase 3's first three slices: object properties, undo/redo, and the object operations (move, resize, remove, add, duplicate), editing waiting behind a setting; editing collision lines is the one parked slice · **Effort:** the parked slice large · **Where:** anywhere; nothing left here needs a disc

**Outcome: what the site should produce is a *description* of a path, not a level — and the write path belongs in `tools/`, not on the page.** AliveTeam's level editor already exists, is released for Windows and Linux, and pins the exact decomp tree the builder's parsers already read; it reads the user's own LVL files and can patch them from a JSON. So the site's job is not to be an editor but to emit that JSON — and the first thing that JSON buys is not modding at all, it is a **cross-check of our extraction against AliveTeam's**, object for object, over 16,225 objects and 9,540 collision lines (measured 2026-08-26).

**Scheduling is carried by the phase split, not by a section of the backlog.** **Phase 1 is ready now:** no disc image, no site change, and — for the exporter itself — nothing beyond the committed data and the decomp headers the builder already parses. Only its verification step adds a local prerequisite, a `relive_api` build, which that project's own CI does on macOS. **Phases 2 and 3 are the moonshot it earns** — a download button, then editing in the browser — and neither should start before Phase 1's diff comes back clean.

---

## What was checked (2026-07-31)

### The editor exists, is released, and is not Windows-only

[AliveTeam/qt-editor](https://github.com/AliveTeam/qt-editor) is its **own repository**, not a branch of the decomp: created 2021-04, default branch `master`, last commits 2026-02-28. The latest release (`github_0.7.1`, 2026-02-28) ships `Windows32-Release-qt-editor.zip`, `Windows64-Release-qt-editor.zip` and `relive-qt-editor-0.1.1-Linux.deb`. Its CI builds Windows 32/64 (artifacts), Linux on `ubuntu-22.04` (a `.deb` artifact) and macOS Intel via `brew --prefix qt@5` (builds, artifacts still a TODO). So "Windows-only" is wrong: Windows and Linux get binaries, macOS builds from source, and an Apple Silicon build is untested rather than excluded.

**It pins `3rdParty/alive_reversing` at `e2badb8df`, a `master` commit** — confirmed by `git branch -a --contains` naming `master` alone, and the head of `master` in the local checkout, which has not been fetched past 2026-02-26. That is the same tree `parse_object_schema` / `parse_member_types` / `parse_enum_labels` read. The `beta` question that [29](item-029-decomp-label-sweep.md) records does not reach the editor at all.

There is a **command line**: `qt-editor --export <json> <lvl>` (`Source/main.cpp`, `exportJsonToLvlCommandLine`). `Source/Exporter.cpp` shows it imports the JSON into that LVL **in place** — writes a `.lvl.tmp`, deletes the original, renames over it — and adds the LVL's own directory to the resource search set. So the only artifact we would ever ship is one JSON; the user's game files never leave their machine. relive itself requires the PC game files, so anyone using the export already owns a copy.

**Prior art is public and long-standing**, which matters for the claim question below: Paul's Level Editor circulated for years (still linked as `aliveteam.github.io/legacy/Editor_0.6.2.rar`), the RELIVE site advertises the new editor as "the replacement for the legacy Paul's Level Editor", and a Steam guide walks people through installing both and invites them to share levels. The editor's own README is blunt that its output targets relive: "maps/paths exported to LVLs with this editor will not work with the original engine."

### The format, and how versioned it is

The format is **relive_api v4 JSON** — `kApiVersion = 4` at the pinned `e2badb8df` (`Source/Tools/relive_api/relive_api.cpp:259`), which is the version the released editor reads. Upstream master has moved past the pin, so this figure and [29](item-029-decomp-label-sweep.md)'s version numbers describe different trees; 29 records which is which. Root keys are `api_version`, `game` (`"AO"` / `"AE"`), `map` and `schema`.

Versioning is strict but survivable. Import compares the version and, on mismatch, throws through `context.JsonNeedsUpgrading` (`relive_api.cpp:1043-1046`) — there is no silent auto-upgrade. `UpgradePathJson` is the explicit path, and upgrade steps are registered per *source* version (`ADD_UPGRADE_STEP_FROM(3, UpgraderAO3)`, `JsonUpgraderAO.cpp:54-57`) with rename/remap operations (`RenameMapObjectProperty`, `RemapNumberToEnum`, …), reinjecting a fresh `schema` at the end. So a bump does not orphan our exporter: it means adding one step's worth of renames, and the editor already "handles json upgrading on opening existing json files" (its PR #168). This is the same versioning that mattered once here already — [29](item-029-decomp-label-sweep.md)'s `chase_abe_when_spotted` fix bumps `kApiVersion` upstream, and its confirmed `scale`/`level` batch is queued to bump it again.

### The import contract

Every key below was read out of the reader, not assumed.

- **`map` requires** `path_bnd`, `path_id`, `x_size`, `y_size`, `abe_start_xpos`, `abe_start_ypos`, `num_muds_in_path`, `total_muds`, `num_muds_for_bad_ending`, `num_muds_for_good_ending`, `lcdscreen_messages`, `hintfly_messages`, `cameras` (`JsonReaderBase.cpp:52-83`). Missing keys throw. `x_grid_size` / `y_grid_size` are written on export and never read back.
- **`schema` is not read on import** — but the **editor** reads it (`Model.cpp:93` takes `enum_and_basic_type_properties`), so a JSON meant to be *opened* must carry it. It is identical for every path in a game, so it is one generated blob per game, not per path.
- **Collisions:** import reads `collisions.items` only; `structure` is export metadata (`JsonReaderAO.cpp:11-13`, `JsonWriterBase.cpp:132-134`). AO items need `x1`, `y1`, `x2`, `y2`, `Type`, `Next`, `Previous`; AE adds `Next 2`, `Previous 2`, `Length` (`JsonReaderBase.hpp:20-29` and `45-59`). `Type` is an enum, so it takes a label string.
- **Cameras require** `x`, `y`, `id`, `name`, `map_objects`; `image` and the four FG1 layers are optional (`ReadOptionalString`, `JsonReaderBase.cpp:96-107`). **Every camera must be listed** or its grid cell is written as an 8-byte blank (`relive_api.cpp:702-728`).
- **An object** is `{name, object_structures_type, properties}`. The type string goes through `MakeTlvFromString`; an unknown one throws `UnknownStructureTypeException` (`JsonReaderBase.cpp:111-131`). `name` is required but cosmetic — the instance suffix (`Hoist_1`) is not read back into anything. `xpos`/`ypos`/`width`/`height` are ordinary properties, with **width/height relative** to the top-left, which import adds back (`TlvObjectBaseAO.cpp:31-35`, `49-57`). The binary `length` comes from `sizeof`, and the end-of-list flag is set on the last object of each camera (`TlvsAO.hpp:81-85`, `TlvObjectBaseAO.cpp:71-76`) — neither is ours to supply.
- **Every registered property is required per object**, `ADD_HIDDEN` included. A missing numeric throws; a missing enum throws through `context.MissingEnumType` (`PropertyCollection.hpp:48-54`). **An unknown enum *label* does not throw** — it silently takes the first enumerator and records the substitution in `context.UnknownEnumValue` / `Context::RemappedEnumValues()` (`EnumTypeBase.hpp:63-74`). That is the one way this format can accept our data and quietly mean something else, so `Context` is the oracle every export run must be checked against; the editor's CLI already prints both the remapped enums and the missing properties.

### Why the format is nearly free for us

**Our field keys already *are* the JSON's property names.** `parse_object_schema`'s `ADD` regex matches `ADD("Door Number", mTlv.field_20_door_number)` and `norm()`s the **display string** into the key we ship — and that display string is exactly the JSON key the `ADD` macro registers (`TlvObjectBaseMacros.hpp:4`). The mapping is not a table to be written; it is a column the parser has in hand and throws away. Checked over the shipped schemas: **zero collisions** after `norm()` in either game, so the correspondence is one-to-one and reversible.

**Our enum labels are the same `AddEnum` strings, lowercased.** `enum_labels_{ao,ae}.json` is generated from those blocks already. The JSON wants the originals, and un-lowercasing is *not* a mechanical inverse — the labels are not uniformly Title-Case-with-spaces (`{eOpen_0, "Open"}`, `"Hub Door Closed"`, `"Closing (Internal Only)"` at `TlvsAO.hpp:433-438`, but `SwitchOp` is `"SetTrue"` / `"SetFalse"` with no space, `TypesCollectionAO.cpp:179-185`). So the sidecar must carry the original strings verbatim rather than reconstruct them, which is the same discipline `write_enum_labels` already applies in the other direction.

**The field-less sets agree, which is evidence the two schemas are the same schema.** The 15 AO and 7 AE types that ship no `fields` are exactly types relive_api declares with `EMPTY_CTOR` — `LCDStatusBoard` (`TlvsAO.hpp:1623-1626`), `GasEmitter` (`365-368`), `ScrabLeftBound` (`1681-1684`), `InvisibleZone` (`698-701`), `ZSligCover` (`1673-1676`), `SoftLanding` (`1647-1650`), `KillUnsavedMuds` (`270-273`). Our archive is lossy in the same places theirs is, because both are driven by the same `ADD` lines.

**And PS1-versus-PC parity is better evidenced than the README's assertion.** The builder feeds **PC-derived** static tables — `obj_off`, `idx_off`, `coll_off`, `coll_count`, grid sizes, all parsed out of `PathData.cpp` by `parse_pathdata_cpp_{ao,ae}` — to **PS1** path chunks, and gets clean camera-name tables, exactly-sized collision arrays and sane object walks across all 190 paths. If the content differed the offsets would not land.

---

## Phase 1 — a `tools/` exporter whose first job is a cross-check

Our pipeline is an independent second implementation of AliveTeam's readers, and nothing has ever compared the two. Emitting their format makes the comparison mechanical: same path, same objects, same values, or a diff that names what disagrees. That is the strongest available answer to "is our data right" — the question [29](item-029-decomp-label-sweep.md) and [41](item-041-inherited-field-types.md) keep circling with eyeballing and heuristic scans.

### What it emits

A `tools/` entry point (a flag on the builder or a small sibling script) that takes `(game, level, path)` and writes a relive_api v4 JSON, reading **only** the committed `map_data_{ao,ae}.json` plus new generated sidecars. No disc, no LVL, no site change.

Three sidecars, all derived from the same decomp source the builder already parses, all emitted alongside `field_types_*` / `enum_labels_*` by the existing `--emit-field-data` path:

- **the property display names** — the string `norm()` currently discards, per `(type, field)`;
- **the enum labels verbatim**, un-lowercased, keyed as `enum_labels_*` already keys them;
- **the per-game `schema` blob**, one static object per game (types with their properties, the enum tables, the basic-type ranges), since the editor needs it and it never varies by path.

The rest is assembly: `map`'s required scalars, `collisions.items`, and `cameras` with `map_objects` bucketed by cell — which is a straight read of `c.cell` against each TLV's world rect, since [js/state.js](../public/js/state.js)'s transforms already establish the cell geometry.

### How to verify it

**Diff against the reference reader on a PS1-extracted LVL.** `relive_api` builds on macOS in `alive_reversing`'s own CI, and the builder's `Lvl` can already write out a `R1.LVL` byte-for-byte from the disc image. Point `ExportPathBinaryToJson` at that file and diff its `map_objects` and `collisions.items` against ours for the same path.

The reason this works without a PC copy of the games: a PS1 `.CAM` uses the **same chunk container** with the same `Bits` tag (`decode_cam`), only a different payload framing, and `CamConverter` never throws — it carries a bare `// todo: throw` (`CamConverter.cpp:202`). So the camera base64 comes out as garbage while the objects and collisions come out right, which is precisely the half the diff reads. **Time-box this step**: it is the one part of Phase 1 not established by reading code, and if it does not hold, the fallback is a GOG copy, which is a purchase rather than a redesign.

**Then read `Context`.** Run the export through the editor's CLI on a scratch copy of an LVL and check `RemappedEnumValues()` and `MissingJsonProperties()` are empty. A clean `Context` is what distinguishes "our JSON is accepted" from "our JSON is accepted and means what we meant" — the same distinction [28](item-028-readable-units.md) draws when it refuses to ship guessed seconds.

### The gaps to close, all disc-free

- **Collision link fields.** `Next` / `Previous` (and AE's `Next 2` / `Previous 2` / `Length`) live in the same 20-byte record the builder already reads and discards — it keeps the four coordinates and the type byte and stops, in the builder's collision walk. The offsets differ per game (AO `0x0C` previous / `0x10` next; AE `0x0A`, `0x0C`, `0x0E`, `0x10`, `0x12`). Capturing them makes the export lossless where the editor's own default is to write `-1` and recompute the length.
- **`ShadowZone`'s three RGB fields** are registered with `ADD_LINKED`, which the schema regex does not match (`ADD(?:_HIDDEN)?`) — three fields per game, one type, missing from our archive as well as from any export.
- **AE's Abe start** is `pd[10]` / `pd[11]` in the PathData row `positional_rows` reads and names in a comment without storing.
- **The mud counts are constants**, not data: relive_api hardcodes AO as `0 / 99 / 75 / 50` and AE as `Path_GetMudsInLevel(level) / 300 / 20 / 255` (`relive_api.cpp:106-113`, `131-137`). Copy them.
- **The two message arrays can be empty**, which is what a vanilla LVL yields — the strings only reach the file through the `Pxtd` chunk an editor round-trip writes. This is where [5](item-005-lcd-marquee-text.md) (LCD marquee text) would eventually plug in, but it blocks nothing.

### Why FG1 is not a Phase 1 concern

The FG1 trap described under Phase 2 is real, and it **only bites on import**. Phase 1 writes no LVL, touches no `.CAM` chunk, and reads no camera art: a diff against `ExportPathBinaryToJson` compares object and collision arrays and ignores the base64 entirely. **Nothing in Phase 1 needs a disc image or a data rebuild** — so a reader who meets the trap first should not conclude the exporter is gated behind one. It is gated behind the *download*, and only because a download invites someone to import it.

---

## Phase 2 — the download, and the FG1 trap that lives here

A button that hands the current path's JSON over as a file. Technically this is small and breaks nothing: the site stays a static page with no backend, and a generated JSON is a download like the PNG export already is.

**But the artefact has one silent failure, and it must be resolved before the button exists.** `ImportCameraAndFG1` removes every FG1 chunk **unconditionally** (`relive_api.cpp:1162`), and it is called for every camera with a non-empty name (`relive_api.cpp:518-538`) — while a camera left out of the JSON loses its grid cell instead. So there is no way to say "leave this screen alone": an art-free import **strips the foreground masks off the whole path**, and the visible result is Abe no longer hiding behind scenery on every screen of it. The public `ImportPathJsonToBinary` passes `skipCamerasAndFG1 = false` (`relive_api.cpp:875-878`); the `true` overload is `Detail::`, used by the integration tests, not reachable through the editor.

Two ways out, and the choice is the gate on Phase 2:

- **Say so.** Ship the download described as an object-and-collision description, and state that importing it drops the path's foreground masks. Honest, cheap, and consistent with how this project handles a known limitation — but it makes the artefact something you inspect rather than play.
- **Emit the layers.** The builder already decodes FG1, but it merges everything into one `_fg.png` for the viewer's overlay, and the import wants up to four separate layers (foreground, background, and the two well variants). Splitting them is a builder change and therefore **a disc rebuild** — which is the only place in this whole item where a disc is needed. AE's format is per-row bitmasks selecting camera pixels, so it should round-trip; AO's partial chunks carry their own RGB555 pixels, so it would be approximated exactly as the editor already approximates it.

---

## Phase 3 — editing in the browser

Only if Phases 1 and 2 land, and its output must be the Phase 1 JSON rather than a format of its own.

The property form is the cheap half and is close to free: for any field the viewer already knows the raw value, the game type, the full enum value list and the prose definition — `fieldHelp` in [js/fields.js](../public/js/fields.js) composes exactly that list today for the tooltips, so a `<select>` is a rendering of something already computed, and a bare-int field falls back to a number input.

What is genuinely missing:

- **no selection model** — hover yields a list, and `findTlv` identifies an object by name plus top-left ([js/model.js](../public/js/model.js)), so an object that moves loses its own permalink;
- **no dirty state and no undo**;
- **no way to re-derive `t.extra`** — the whole navigation layer (`destOf`, `computeConnections`, `computeEntryPaths`, `destTrusted`) reads `extra`, not `fields`, and the logic that produces it is Python in `tlv_extra_{ao,ae}`. Edit a door's destination and the arrows keep the old answer until that is ported;
- **caches with no invalidation for this** — `connCache` keyed on path identity, `state.entry` recomputed only on a game switch, `searchTextCache` keyed per TLV object, and the demo `WeakMap`.

---

## Ruled out

### Edits shared as a patch or a URL

Not on cost — on what it would cost the map. Nothing downstream consumes a patch of our own invention, and the hash already carries up to ~5.6 KB with a 512-point route, so the payload would have to be a file anyway. The decisive objection is that **a shared link showing edited data is indistinguishable from one showing the game.** Every other feature here is built the other way: `destTrusted` exists so the map never claims a destination the data cannot support, the override rule forbids a curated name from erasing the game's own, and the README states outright that the extracted data is never altered. A link a recipient cannot check undoes all of it. A purely local sandbox is a different proposition and is Phase 3.

### Writing back to a retail LVL or the PS1 disc

**For relive this is already solved** by `ImportPathJsonToBinary`, so reimplementing LVL and BND packing in JavaScript is strictly more work for a worse result — it would also have to carry the FG1 reconstruction and the animation-resource lookup that the import does for us.

**For the retail engine it is the one scope that breaks a stated constraint.** `obj_off`, `idx_off`, `coll_off` and `coll_count` are not in the level file at all: they are static tables in the executable, which is why the builder reads them out of `PathData.cpp` rather than out of the path chunk. relive overrides them at load from the `Resource_Pxtd` `PerPathExtension` chunk the import writes (`PathDataExtensionsTypes.hpp:54-76`, applied in `AliveLibAO/PathDataExtensions.cpp:126-140`) — that mechanism *is* the reason editor output runs in relive and not in the original engine. So anything structural on retail means patching the game's own tables, which is shipping a game-code patch. On the PS1 disc specifically, add per-sector EDC/ECC regeneration on a 2352-byte image — `Disc.sector` only ever touches the 2048-byte user area — plus ISO extent rewrites when a file changes size, for an output that is a modified copy of the game.

Worth stating plainly, since it is the reverse of the intuition: **the static-page and no-backend constraints rule nothing out here.** Every scope is a client-side download. The constraint that actually bites is "ships no game code", and only this one crosses it.

### Targeting `beta`'s cooked format

`beta` deleted `ImportPathJsonToBinary` outright, and playing an edit there means writing into the `relive_data/` tree the user's own install cooked from their LVLs — a directory of per-path JSON (`path_version: 13`), camera PNGs and FG1 manifests, keyed by unified `relive_tlvs` slugs with a vocabulary of their own. That is not a file you hand someone. The editor tree vendored in `beta` is a variant whose LVL export is stubbed out with "Exporting to lvls is obsolete now"; the *released* editor is the standalone repo, on master.

### "One click to playable"

Ruled out as a framing rather than as an implementation. The editor already produces a **better** artefact than we can synthesize, because it starts from the user's own LVL and therefore has the camera art, the FG1 chunks and the animation resources. Our JSON is worse as a level and valuable as a description; promising the former would be promising the part we are weakest at.

---

## Is this a claim the project should make?

**Phase 1 makes no new claim.** It is a verification harness in `tools/`, on exactly the same footing as the builder: it reads committed data and the decomp, and emits a file for our own checking.

**Phases 2 and 3 do, and the narrow form is defensible.** What ships is a JSON describing object placements the site already publishes, in a format defined by a third-party open-source project; the playable artefact is produced on the user's machine, by a tool they installed, from files they own — and relive requires the PC game files regardless, so there is no route by which our download reaches someone who has no copy. The precedent is public and unbroken: Paul's Level Editor circulated for years, the current editor ships signed GitHub releases, the RELIVE site advertises it, and a Steam guide teaches it.

**What to refuse is the rest of the slope.** No hosting or sharing of user-made levels — which the static-site constraint forbids anyway, and which would turn a description into a distribution channel. No modified disc images: that is a copy of the game rather than a description of it, and it is separately ruled out above.

**The reason to keep the write path in `tools/` is not legal, though — it is the site's credibility.** The promise of this map is that everything on it is what the disc says. An editor living inside the map puts that at risk; an exporter living beside it does not. If Phase 2 lands, the About dialog's "ships no game code" stays true and gains one sentence saying what the export is and is not, and the README's rebuild section gains the export beside the build. That touches [68](item-068-repo-licensing.md), the open question of what terms this project states about itself, but does not settle it: a download is not a licence.

---

## Shipped: Phase 3, slice 3, 2026-10-12

**An object can be moved, resized, removed, added and duplicated, each through the one edit model.** A move or a resize is a `rect` beside the field deltas under the object's pristine key, applied by the materialization and marked `moved` or `resized` wherever edited data shows; the drag carries the selection by the click's own ranking, so what selects is what drags, a dashed ghost standing where the release would commit, Shift snapping the midpoint onto the engine's x grid the way the sprite rules stand a sprite, and Shift with the arrows nudging a unit at a time, a held key's autorepeat one undo step through a tag the trail joins steps on until another kind of step, an undo or a redo ends the run. A removal is a `removed` flag the other deltas survive: the object leaves the standing path and every export, and stands as a ghost while the mode is on, drawn, hovered and listed where its deltas left it, selectable like any object and restored from the panel or the screen list, so a reload, which drops the trail, still has a way back short of reverting the path. An addition is a `+n` entry carrying its type's name, its rect and all of its fields, materialized after the shipped objects so their list positions hold, from a type picker that is the panel's second view, placed at the view's centre on the screen under it and sized and valued like a typical placement of its kind: the type table behind it reads the pristine levels, so it answers the same whatever has been edited, and a type's defaults stand in for the shipped values in every funnel; a duplicate is the same entry for a copy beside the original on its own screen. One guard decides a rect, `validRect`, by column and row on each axis for the corner and the midpoint, the two points the games' camera indexes list a rect by, so an export never meets one off the grid.

**Where the sketch was wrong.** The `t` an added object exports under came from the game's own placements rather than from the schema, which also settled which types can be added: the ones the game places, since a type with no placement has no `map_data` name, no category and no sprite rule; the four never-placed schema types stay out. A ghost had to be the object as its deltas left it, not the shipped one, or a door moved to another screen and then removed would have ghosted on the wrong screen and restored elsewhere. The nudge run needed an ending rule the trail could own without a clock, which is why an undo clears the tag of the step it exposes. The three per-dataset memos (the numbers panel's type counts, the type card's field cache, the place search's candidates) never go stale under this slice, since an addable type is a placed type and places do not change; the one memo that does matter is the type table itself, which reads pristine placements for that reason. A copy placed to the right alone would have left its screen for many Exoddus objects, whose screens leave little room beside the right edge, and been clamped back over its original near the grid's edge, so the spot is the first beside the original that keeps its screen, and a second add of a kind steps aside the same way. Backspace was already the route planner's key, so the planner yields to a removal, and a hash link into the page the visitor is already on is a hash change rather than a reload, so a spec that means a reload reloads.

**What the maker will need from here.** Importing an exported JSON back into the sandbox; the path-level values no object holds (Exoddus's Abe start per path, the mud counts, the message arrays); a marquee for group moves; and a pristine stand-in for a path made from scratch, since the store presumes a shipped path behind every key. One thing to measure before it is promised: relive's import finds a screen's artwork by name in the target LVL, so a template screen taken from another level names a CAM the LVL does not hold, and carrying the artwork instead has to be weighed against relive's 640-wide PC cams. The maker itself is [98](item-098-level-maker.md).

## Shipped: Phase 3, slice 2, 2026-09-13

**The trail is a trail of the store, never of the map.** A step is what a hand did to a path's deltas through the two funnels, a field committed or the path reverted, and the trail holds the path's store entry as it stood before each one, cloned because the funnels write into the live entry. Undo and redo put the held entry back and swap, the way a revert does, so every surface follows through the swap that already exists and nothing downstream knows a trail is there. It is kept per path and for the session, the edits themselves persisting as before; a revert is one step, so a mistaken one comes back with one press; a boot apply is no step, and forgetting all in Settings empties every trail. Ctrl/⌘ Z and Shift (Ctrl/⌘ Y too) act on the path in hand whenever the mode is on and the keyboard is not in a form field, where the browser's own undo keeps the keystroke, and the panel's footer carries the two buttons. The later slices inherit undo the moment their edits route through the funnels: the snapshot is the whole entry.

## Shipped: Phase 3, slice 1, 2026-09-12

**Editing is a local sandbox over data that is never mutated.** An edit is a per-field delta keyed by the object's pristine origin (its name and top-left, with an ordinal where the tuple repeats inside the path: 10 groups in Oddysee, 41 in Exoddus); a path carrying deltas stands in the dataset as a new object built over the pristine one, its unedited TLVs kept by identity and its edited ones fresh with their navigation bucket derived again; a path whose deltas are all gone stands as the pristine object itself, which makes an unedited export's digest structural rather than asserted. The deltas live on the device under one localStorage key, read by shape alone, and apply inside `loadGame`'s chain before a dataset is shown, each answering to its object or being dropped with a note. Edit mode (a sidebar button and `e`, both waiting on a setting that is off by default and arms the mode without ever gating the data: stored edits apply and are marked whatever it says) turns a click into a selection; the panel lists every archived field as a select over the labelled values or an s16 number input, with what the disc shipped beside anything changed; the map follows through a `data-changed` event; and edited state is marked wherever it shows, exports included, in every export's name.

**The re-derivation this file called missing was the smallest part.** `js/extra.js` is `tlv_extra_ao` / `tlv_extra_ae` over the archive's field names, and its test requires every one of the 16,227 shipped objects to re-derive to its committed bucket, key order included — which is also the proof, never made before, that the archive carries everything navigation reads. It needed one sidecar key, the builder's whole level-id map, since the served level list keeps one level per archive and 69 Exoddus destinations name an ender id.

**The gap list above was right about what and wrong about how.** The caches needed no invalidation: once the data is copy-on-write, a memo keyed on path or level identity misses on its own, and only the two game-wide election memos in `pathorder.js` are reset by hand — a level's walk starts from an entry another level's door decides. The hole an adversarial review of the plan found was not a memo at all but the place-search rows holding level and path objects, through which one click landed the viewer on the shipped data with the edits gone; the answer is a rule rather than a fix, the navigation seam resolving levels and paths by short and id and every "same path" guard comparing places, never identity. The selection model became a mode and a `state.sel` slot, cleared on a real path change and re-pointed by the one helper every swap goes through. Persistence, which the Ruled-out section left open as "a different proposition", was decided for the device, with the marks as the condition: a later visit can never mistake an edit for the game's data.

**What remains is the rest of the scope the sketch's later slices name:** moving and resizing objects (a `rect` delta the materialization already spreads), adding and removing them, and the collision lines. Each is planned after the one before it ships.

## Shipped: Phase 2, 2026-09-08

**The download is an Export path as JSON button beside the two image exports**, handing the standing path over as `oddworld-ao-R1-P15.json`. It refuses rather than writing a document whose manifest holds a miss, relive's importer aborting the process outright on a missing numeric property, and the button's tooltip and the About dialog say the same thing, a description of the path, no artwork, and an import drops that path's foreground masks, of which the toast it leaves repeats the last alone. The About dialog gained two sentences where the section above promised one; the README describes the download among the controls rather than the tool beside the build, the exporter staying with the builder's other checks in CLAUDE.md.

**The gate this file set had only one side to land on.** The choice was stated as "say so" against "emit the layers", the second costing a builder change and a disc rebuild. The second is not available at any price: `ApiFG1Reader`'s layer buffers are `u16[4][240][640]` and `MakeFG1Layer` scans a 640-wide mask in 32x16 blocks, because a PC camera bitmap is 640x240 in 40 strips of 16 columns (`ConvertAOCamera`). A PlayStation screen is 368 wide, which the committed artwork carries at 368x240. The masks are screen-space, the two platforms' screens are different widths, and no rebuild changes that — so the layers cannot be derived from this data at all, and "say so" is what shipped.

The evidence under that is one measurement and one debt. On the discs both games' partial blocks carry their own RGB555 pixels — the bitmask form the sketch above expects Exoddus to round-trip through is the PC files' (*Read a foreground block as the pixels it carries in both games*, `5779f86e`), so neither game's blocks are structurally confined to their screen. Oddysee's confinement is measured: across every camera on the disc the rightmost block edge is exactly x=369, which ten of them reach and none passes. Exoddus' equivalent sweep is owed to the next disc pass, and nothing waits on it — the impossibility stands on relive's side alone, its layer buffers PC screens 640 wide against this data's 368.

**The page builds the document itself**, [js/reliveexport.js](../public/js/reliveexport.js) being a port of `export_path` over the same caches, reached through a `relive_export_{ao,ae}.json` sidecar that no boot fetches — 37 KB gzipped for Exoddus, and nothing reads it until the button is pressed. That spends the Phase 1 call below that none of this is viewer data: one sidecar per game now sits in `public/`, written by `--emit-field-data` beside the field types and enum labels and byte-compared against the caches it copies. What survives of the call is its narrower half, the one the cross-check section below makes about the collision links: what the viewer does not draw does not ride the first paint.

**Neither implementation can run the other, so both answer to one file.** `tools/relive_export.py --digests` writes a canonical-form sha256 per path; the builder's suite regenerates and byte-compares it, and the page's suite hashes all 191 documents against it. The two agreed on nothing at first — JS reorders an object's integer-like keys, so `Enum_LevelIds`, which opens at `-1`, came back rotated by one — which is exactly the class of divergence a shared fixture is for. Driven in a real browser, both games' documents now hash to the digests the builder recorded.

**What Phase 3 still owes is unchanged**, and the FG1 finding does not touch it: an edit made in the browser would ship through this same document, and the selection model, dirty state and `t.extra` re-derivation listed below are still what is missing.

## The cross-check, 2026-09-05

**Every path the reference can export agrees with ours, object for object.** 179 of the 191, holding 14,975 objects and 9,022 collision lines: no divergence, no ordering warning, and one tolerated class — AE's `num_muds_in_path` on 105 paths, the reference-side mud indexing the runbook already predicted. relive_api's own reader still accepts all 191 documents with no remapped label.

**The time-boxed leg passed, but one leg further along than the runbook expected.** `OpenPathBnd` takes a byte-exact PS1 LVL and `EnumeratePaths` returns `R1PATH.BND: 15 16 18 19 20`, exactly the path set the map holds. `ExportPathBinaryToJson` then aborts inside the FG1 reader: `CamConverter` picks a cam's FG1 format by testing the Bits payload's strip sizes against `16*240*2`, which is a PC cam's framing and never a PS1 one's, so an Oddysee cam is read as Exoddus and the first `eStartCompressedData` block hits `ALIVE_FATAL`. Nothing in the objects, collisions or camera grid comes from a `.CAM`, and `ProcessCamera` carries on with empty layers when it cannot find one, so `--dump-lvl` now shifts a letter of each `.CAM` directory name and every byte of path data stays the disc's own. The GOG copy is not needed.

**The harness carried a second-order bug the `check` path could never reach.** The shim compiles relive_api with `ELPP_NO_DEFAULT_LOG_FILE`, leaving easylogging's default logger with file output on and nowhere to write, so the first `LOG_WARNING` dereferences a null stream. 191 documents had read clean past it; the export mode meets it on its first camera.

**The one thing the diff found on our side was the camera an object is listed under.** The exporter derived it from the rect's top-left corner in both games, and Exoddus authors by the midpoint: 835 of its 10,602 objects were listed under the neighbouring camera, mostly the zones that straddle a cell boundary. Read off the index table the chunks themselves carry, each rule is exact over its own game — 5,625 and 10,602 objects, with the other rule wrong on 3 and 835 — and an object listed under the wrong camera would be written into that camera's TLV stream on import, so it is the spawn that moves rather than the listing. Everything else agreed from the first run, before any fix: identical object sets on all 179 paths, every property equal.

**Twelve Oddysee paths the reference cannot export, in two classes, neither of them a disagreement about data.**

- **Ten hit `WrongTLVLengthException` on `RingCancel`**, whose PS1 record is 28 bytes to the decomp struct's 24. The four extra payload bytes are zero on all ten placements, and the type is `EMPTY_CTOR` on both sides, so nothing is lost — but relive compares `field_2_length` to `sizeof` and refuses. Swept over both discs, it is the only type in either game whose record length disagrees with relive's struct, across 5,625 and 10,602 records.
- **Two read their index table at the wrong offset**, `R1 P20` and `R6 P6`, because the PC tables miscount their collision lines by one. That one is ours as much as relive's, and it was a real defect in the shipped map data: a missing wall and Hoist on one path, a phantom line and a missing ContinuePoint on the other. `audit_path_meta` now counts the lines from the chunk, in *Count a path's collision lines from the chunk, not from the PC tables*.

**The rebuild spent what was batched for it.** ShadowZone's R, G and B reach 1,656 placements; [93](item-093-securityclaw-layout.md)'s two words land; the collision links are captured. Apart from those and the two audited paths, each a line and an object different, the rebuild reproduced the committed data byte for byte. Only `MovieHandstone`'s export fallback survives, and it stays by design.

**The links went to `tools/data/lines_{ao,ae}.json` rather than into `map_data`,** which is drift from the sketch worth stating: no viewer surface draws a link, and carried in `public/` they cost every Exoddus visitor 27 KB gzipped on the dataset first paint waits for. That is the same call the Phase 1 notes below record for the relive schema, and with the words captured the diff's link tolerance and its `--strict-links` flag are both gone.

**Phase 2's gate is met and its trap is not.** The diff is clean, so the condition this file set on the download is satisfied; `ImportCameraAndFG1` still strips every FG1 chunk unconditionally, so the choice under Phase 2 stands untouched.

## Shipped: Phase 1, 2026-09-04

In *Cache relive_api's own schema for the exporter* and the four commits around it: `tools/relive_export.py` writes any path — or all 191 — as a v4 document from the committed data alone, `tools/relive_diff.py` is the structural comparison the disc session will run, and `tools/relive_verify.py` builds `tools/relive_check` (a shim CMake project over the checkout's `Source/Tools/relive_api` directory alone, which is self-contained and SDL-free) and runs every document through relive_api's **own** JSON reader. That oracle came back clean over all 191 paths in both games: no exception, no abort, no silently remapped enum label.

What shipped drifted from the sketch, in ways worth keeping:

- **One committed cache per game (`tools/data/relive_{ao,ae}.json`), not three public sidecars.** None of this is viewer data — `public/` is the deploy artifact — and the `schema` blob is a root key of every exported document, assembled at export time. The `--emit-field-data` outputs never moved a byte.
- **The field→property join rides on payload words, never names.** relive's ADD order is not its read order: its own `Path_MovieHandstone` ADDs contradict its struct, so the cache computes each property's word from the data struct's real layout (base chains, unions, aggregates, alignment, enum backings), validated against the decomp's `ALIVE_ASSERT_SIZEOF` lines. The same sweep found the archive's own liar — AE SecurityClaw, now [93](item-093-securityclaw-layout.md) — and the `WordAudit` test pins the complete set so the next one fails a test instead of shipping.
- **Fourteen placed types' `object_structures_type` literals differ from the names `map_data` carries** — seven per game (our `LCD` is relive's `LCDScreen`, our `Switch` its `Lever`, `DeathClock` its `GasCountDown`); keying the cache by numeric type id made the mapping free rather than a table.
- **The collision-link gap was not disc-free** — this file's claim above is wrong: `Next`/`Previous` (AE `Next 2`/`Previous 2`/`Length`) live only in the path chunk, so capturing them was a builder change **plus a rebuild**, batched for the disc session. Until it ran, the exporter wrote the editor's own `-1` and the diff held those keys as a counted non-fatal class.
- **A pinned fallback table stood in for the words relive reads that the archive did not yet hold** — ShadowZone's R/G/B in both games (in the layouts since the ADD_LINKED widening, in `map_data` only from the rebuild), MovieHandstone's meaningless s32 high word, and SecurityClaw's unarchived `Unknown`. Every entry prints on every run and doubles as the diff's known-divergent set, so retiring one retires its tolerance too; the rebuild spent them loudly — except MovieHandstone's, whose word the archive drops by design, so that one stays.
- **The Context wording under "How to verify it" was optimistic**: `Context::MissingJsonProperties()` is dead code upstream — nothing ever populates it. A missing numeric property *aborts the importer process* (jsonxx asserts stay on in release), a missing enum property throws, and only an unknown enum *label* lands in `Context::RemappedEnumValues()` — which is therefore what the oracle fails on.

The disc-session runbook: dump a byte-exact LVL (`tools/relive_verify.py --dump-lvl AO R1 /tmp/R1.LVL`), then `relive_check enum /tmp/R1.LVL` — the **time-boxed leg**, the first moment relive's `OpenPathBnd` meets a PS1 LVL; if it refuses, the fallback is the GOG PC copy priced above and everything else stands. Then per path `relive_check export` (no camera images at all, the dump having hidden every cam, and the diff never reads them) and `tools/relive_diff.py ours.json reference.json`, recording totals and the tolerated-class counts with the date. First divergence: minimize to one object or line, read the path-chunk bytes at that offset, classify as our extraction bug, our exporter bug, or a reference-side quirk (candidates already known: AE `Next_TLV`'s skip-the-last-entry TODO, and AO tables compiled from the pin versus our parse pinned at `AO_COMMIT`). One reference-side quirk is already confirmed and tolerated: the reference indexes AE's per-level mud table by the **path index** it was handed (`ToPathInfo` receives `PathAt`'s id, and past path 14 it reads beyond the 15-row table), where the engine — and our export — read it by level id, so the diff holds AE's `num_muds_in_path` known-divergent until an upstream fix. The rebuild that captured the collision links, ShadowZone's colours and [93](item-093-securityclaw-layout.md)'s words spent the fallback entries and the `--strict-links` flag with them.

## Byproducts this spike owes elsewhere

- **[29](item-029-decomp-label-sweep.md)'s branch note now rests on the pin rather than on `beta` being dormant:** the released editor pins master, so the tree our parsers read is the tree the tooling downstream of it uses. That is the argument; the divergence — 1783 commits ahead of master and 42 behind, measured 2026-07-31 — sizes the parser rewrite `beta` would cost, and settles nothing about which branch to read.
- **Two real holes in the shipped archive**, found by reading the import contract rather than by looking for them, and worth fixing whether or not any of this is built: the `ADD_LINKED` blind spot costs `ShadowZone` three fields in both games, and the collision link fields are being dropped from bytes the builder already has in hand.
