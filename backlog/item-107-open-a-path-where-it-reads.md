# 107. Open a path where it reads

**Status:** shipped 2026-11-12 · **Effort:** medium (the view's rule and the screen it elects, the order the painter asks for a path's artwork in) · **Where:** viewer, `navigate.js`, `pathorder.js`, the painter

**Filed:** 2026-11-12, from a look at what a phone shows on a first visit.

## What and why

A path opens fitted whole to the map's box, and the fit has no floor above the manual zoom's own. On a 390 px phone Rupture Farms' first path, twelve screens by three, opens at 0.08: twenty screens 29 px wide in a strip across a black page, artwork on 3.4% of it and no sprites, the zoom being under the one that fetches them. Every path change goes through the same fit (the boot, a link naming a path and no view, which is every link on the level pages, the level and path buttons, `[` and `]`, a place hit in search, a box of the world graph), so a phone lands back in the strip at each.

Measured 2026-11-12 over the shipped data at 390×844: the fit puts artwork on a median 5% of the box, 138 of the 191 paths fit under 0.2, and the fit steps by the path's width, 0.687 for a path one screen wide, then 0.417, 0.299, 0.233, 0.191 and 0.162 for two to six. A tablet held upright (a box 518 px wide beside the sidebar) opens the two games' first paths at 0.11 and 0.09, a phone on its side (594×390) at 0.13 and 0.10. A window of 1280×720 fits its smallest path, Necrum Mines' Tunnel 1, at 0.18, and nothing there is under 0.17.

The view alone does not mend the visit. The painter asks for every screen of the path at the first paint, whatever the view holds, and a view above the sprite gate adds the path's sheets and masks to the same burst. Cold on a throttled slow-4G phone over HTTP/2 against a local server (2026-11-11, three runs each): the strip is complete at 17.8 s; opened on one screen with nothing else changed, the first screen arrives at 17.6 s rather than 15.8 s, and the sprites draw on black from 15.2 s.

## Sketch

- **The rule.** A path opens whole where its screens read at the fit, and on the screen it is entered by where they would not: that screen as large as the box holds it, its artwork's own size at most, the view kept over the path's screens rather than centred on the one.
- **Two floors.** No single zoom floor serves both ends: a path five screens wide on a phone and the fifteen-wide Tunnel 1 on a laptop both fit near 0.18 to 0.19, so the floor that leaves the laptop alone leaves the phone its strips. What differs is how much the box can show at the artwork's own size, so a box under two screens wide asks more of the fit.
- **The screen.** One election per path beside `levelEntry`'s one per level: where the play-order walk first arrives in it, else its start marker.
- **The order.** The screens in view, then the path's sprite art, then the rest of its screens.

## Ruled out

- **A quarter-scale tier of the artwork for zoomed-out views.** About 7 KB a screen where a screen is 100 KB (measured 2026-09-28), but a disc rebuild and a second copy of every camera in history, past the floor [73](item-073-repo-size-trajectory.md) closed on, for a view the rule stops opening on.
- **The focus zoom for the entry screen.** A box 390 px wide clamps it at 0.5, where object labels crowd and a top-row screen centred leaves 43% of the page black; one screen across reads as the game does.
- **The narrow layout as the key to the higher floor.** The fit reads the map's box and the layout reads the window: beside the sidebar a tablet held upright has a box of 518 px and a phone on its side one of 594, and under the lower floor they would keep 129 and 142 of the 191 paths whole, 76 and 98 of them fitted under 0.3.
- **The path's grid as what the view is held over.** 115 of the 191 grids hold an edge row or column with no camera in it, and a view kept inside the grid gives those their share of the page.

## Shipped: the artwork's order, 2026-11-12

A paint asks for a path's screens as its view needs them: the screens showing in the view, then the path's sprite art, then the rest of its screens. Three things the sketch did not have:

- **A sliver is not in view.** With one screen across a 390 px box, 11 px of each neighbour shows, and a plain intersection counts every such neighbour into the first tier: over the 191 paths opened that way, 36 of its 70 MB (measured 2026-11-12). A screen showing under a tenth of a side, or of the view's where the view is the smaller, waits with the rest, and leads it.
- **The rest comes nearest the view first, four at a time.** Asked for together, the screens out of view share the connection and land together at the end, so the first drag off the opening view meets nothing until the whole path is in.
- **The decision has a seam.** Whether the sprite art still holds the other screens back turns on five facts (the objects shown, the zoom under the sprite gate, the sidecar in, coming or failed, the place's sprites already drawn, the art in), each a way for the rest never to be asked for, so `artorder.js` takes them as arguments and `tests/unit/artorder.test.js` holds a case a branch.

Measured cold over HTTP/2 against a local server, three runs each, against the commit before (2026-11-12). A 390×844 phone on throttled slow 4G, opening the link to Rupture Farms' first screen at the artwork's own size: the screens in view are complete at 8.3 s where they took 18.9 s, the first of them at 8.2 s rather than 17.5 s; the sprites draw at 11.0 s, over their scenery, where they drew at 15.1 s on black; the whole path is in at 21.6 s rather than 19.5 s. A 1280×720 window on fast 4G, opening the same path whole with every screen in view: the screens are complete at 3.8 s rather than 4.1 s and the sprites follow at 4.4 s, where they came first at 3.3 s. The path is chosen at 5.6 s on that phone, which is the code's and the data's time and nothing here moves.

Accepted with it: a file that never settles holds back what waits on it, where it cost only itself; a tab opened in the background, which paints nothing, asks for the screens in view alone until it is shown; and a path left before the rest of its screens were asked for is asked for no more, so with "Keep the map on this device" switched on it is stored as far as it got, where its first paint used to ask for it whole.

Left out, each measured on the same phone (2026-11-11 and 2026-11-12):

- **Preloading the nine sidecars the boot waits on.** The path is chosen at 4.6 s rather than 5.6 s, for nine lines in `index.html` and a second look at why the page preloads one dataset alone.
- **A preload naming the link's own game.** An Exoddus link is chosen at 6.7 s rather than 8.1 s, by an inline script that restates the boot's rule.

## Shipped: the view, 2026-11-12

A path opens whole where `opensWhole` says its screens read at the fit, and otherwise on the screen `entryCell` elects, as `screenView` shows it; [docs/viewer-navigation.md](../docs/viewer-navigation.md#how-a-path-opens) has the rule whole. What the sketch does not hold:

- **Judged with the screens edge to edge.** Spaced apart, 32 of Oddysee's 74 paths fall under the floor at 1280×720, and the one screen they would open on shows none of the spacing the Gaps toggle is there for.
- **Clear of the map's furniture.** The one screen stands below the chip row, above the help line, and above or beside the minimap, which shows wherever the path outgrows the box. With a browser's own bars up a 390 px phone leaves a box 664 px tall: with eight pixels kept all round the entry screen would lie under the chip row on 45 of its 189 one-screen openings, and with the minimap alone not kept clear, under it on 10, a door and two wells among what it would cover.
- **About the one screen where nothing else would show.** The view is kept over the path's screens, about them all on an axis where they fit what is clear and stopped at their edge where they do not, only where that holds another row or column of them there, by a fifth of a screen or more; an entry screen with none sits in the middle of what is clear, 75 of those 189 down the page, where kept it would stand against the chip row or the help line, or off the middle, with the rest of the page black.
- **Four links in the election, not two.** The way in from the path before it and the start marker decide all but five paths; Bonewerkz' Executive Office is entered only from a path its level lists after it, and the credits and the menus from nowhere. Where one path leads in twice the lower-numbered screen is taken, the door stored first being Annex 1's way out.
- **A path transition's follow lands on its own screen.** It names no partner and its destination no camera, so it opens its path as a path opens: 24 of Oddysee's lead back to another screen than the one their path is entered on, which the camera word the election reads decides for the follow too.
- **Never smaller than the whole.** In a frame under some 340 px tall the room kept for the minimap can leave one screen smaller than the whole path fits at, and a path opens whole there whatever the floor says: four paths in a frame of 320×240, twelve in one of 280×180.
- **A band of windows opens some paths on one screen.** At 720 px of height and from 986 to 1222 px wide the lower floor turns up to 13 paths, those fitting under 0.17, both games' first among them at 1024; under 606 px of height it turns the Mines' Tunnels 3-5 at any width.

Measured as the artwork's order was, on the throttled phone (2026-11-12, three runs): the default boot has Rupture Farms' first screen and the two below it complete at 8.4 s, where the strip took 17.8 s, with the sprites drawn at 11.1 s, where the strip drew none, and the whole path in at 21.7 s; the link to Necrum Mines' first path has its view at 11.3 s rather than 28.9 s.

Left as it is:

- **A phone turned after the open** keeps the middle of the view it held, as every view does through a resize, which can leave the entry screen cut.
- **A path stepped to along a shared route** opens on its way in, which need not be where the route's leg runs.
- **No control fits a path whole.** On a small box the whole is a pinch away and the minimap is the overview; a path's own button opens it on its entry screen again.
- **The room above the minimap** is the narrow layout's on every layout, 14 px more than the minimap needs beside the sidebar, which costs a phone on its side a few hundredths of its zoom.
- **What the canvas shows outside what is clear**, beside the minimap or under the help line, holds no view at an edge, so a screen two rows from the entry can be left as a strip at the page's foot.
- **The route planner's bar** takes the chip row's place and drops the row onto the entry screen's top, and on a canvas under some 330 px wide the help line's mouse wording wraps to a second line, over the screen's foot.
- **A label above the top row.** Rupture Farms' `AbeStart` stands partly in the slack above its screen, so its label is drawn into the chip row of the very first view.
- **The level pages** picture each level by a pinned screen, else the first its entry path stores, on 13 of the 25 another screen than the one their link opens on.
- **How often a phone paints.** At the fit a phone at rest painted nothing, the zoom being under the one that draws the sprites; on its entry screen it paints with the engine's clock like any view that shows them. Headless, with the CPU slowed six times, a paint takes 5 ms of script; no check here has put it on a real phone.
