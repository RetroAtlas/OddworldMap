# 107. Open a path where it reads

**Status:** open · **Effort:** medium (the view's rule and the screen it elects, the order the painter asks for a path's artwork in) · **Where:** viewer, `navigate.js`, `pathorder.js`, the painter

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
