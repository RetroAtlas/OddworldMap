# 99. Sprite sheets per family, fetched by the path on screen

**Status:** open — the sheets are one per family; fetching only the families a path draws, and holding them back until the zoom makes them out, are still to land · **Effort:** medium (builder, viewer, worker) · **Where:** `tools/oddmap/sprites.py` and `tools/data/sprite_anims.json` with a disc rebuild, `public/js/render.js`, `public/sw.js`

**Filed:** 2026-10-14, from feedback on how the repository grows with each sprite rebuild and on how heavy the first visit became on phones once the objects were drawn as themselves by default.

## What and why

Each game shipped its sprites as one whole-game set of sheets, so a change to any animation re-packed and re-encoded about a megabyte per game: history holds 4.9 MB of sheets from the eleven days between 2026-10-02 and 10-13, all of it past the floor [73](item-073-repo-size-trajectory.md) closed on, and every visitor storing artwork downloaded a game's whole sheet again with each version. The packer placed frames tallest first across the whole game, so a creature's animations lay scattered over the sheet.

The same sheet weighed on the first visit. With the objects on by default, a cold visit fetches the sheet and the opening path's foreground masks beside its screens; on a throttled slow-4G phone the live site's opening path drew its screens between 5.0 and 15.6 s and finished the Oddysee sheet's 987 KiB at 21.4 s, as filed, while at the opening 0.08× zoom a creature is about 4 px tall, and Rupture Farms P15 draws 14% of that sheet's frame area and Necrum Mines P1 10% of Exoddus's (measured 2026-10-14 over every animation their objects reach).

## Decided

- **A family is a kind.** A creature or a device is one family with its palette and theme recolours (`Slig` with the Stockyards slig, `Door` with every level's doors, `Lift` with every level's lifts), the story's three Glukkons each one of their own; a camera's own animation goes with the others first held by the same path, in the game's level and path order, named for that path as its camera files are (`R1P15`); every effect a brain gives off is on `Particles`; the font is `Font`. Each entry of `tools/data/sprite_anims.json` names its family, and [docs/builder.md](../docs/builder.md) states the rules.
- **A sheet reads in the sidecar's order.** A family's animations pack in name order, each kept whole on a shelf where it fits, the sheet cut to its widest shelf; identical frames within a family pack once, where they first appear.
- **A family's sheet is named for the family and its pixels** (`Slig.328cf3d0b4cd.png`), so a change to one family is a new URL for that sheet alone, and the worker retires a family's old sheet as its successor is stored. The sheets lie side by side in the game's `sprites/` rather than in a directory each because the worker before the split read every directory there as a whole-game set and retired the others as it stored one: a returning visitor's first visit after the split, still answered by that worker, would have kept none of the sheets it fetched.

## Ruled out

- **Git LFS.** Pages has to serve the files themselves, and LFS brings storage and bandwidth quotas and friction to every clone.
- **Splitting a kind by theme or palette** (Oddysee's lifts per level, the Stockyards slig on a sheet of its own). It saves 20 to 25 KB on a path that draws one, for families nobody would call a kind.
- **A level's camera animations on one sheet.** Rupture Farms P15 would fetch about 270 KB of sheets rather than 205 KB, the difference being R1 P18's machinery, which no camera of P15 holds.

## Shipped (2026-10-14)

Every animation is packed on its family's sheet: Oddysee's 267 animations on 59 family sheets and the font, 810 KB, where its whole-game set held them in 1,012 KB, and Exoddus's 202 on 39 and the font, 512 KB, where its set held them in 723 KB. The sheets are smaller chiefly because most families fit in 256 colours, which oxipng stores as an indexed PNG (34 of Oddysee's 59, 35 of Exoddus's 39), where the whole-game sheets held 3,798 and 1,495 colours, and next because each family is an image of its own rather than frames of every kind mixed tallest first; the largest is Exoddus's Scrab at 86 KB, which is the most a rebuild of one family rewrites. The decoded area over every sheet grows, 2.55 Mpx against 2.11 for Oddysee and 2.15 against 1.72 for Exoddus, from the shelves an animation kept whole leaves part empty. The split itself adds 1.3 MB of artwork to history for both games, a whole-game rewrite like the ones before it.
