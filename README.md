# Oddworld Map

Interactive map of **Oddworld: Abe's Oddysee** and **Abe's Exoddus** (PS1, NTSC-U), extracted directly from the game discs: every camera background, every object (doors, levers, Mudokons, LCD status boards, hazards, enemies, ...) and every collision line, laid out on the games' real camera grids. The data comes from the PS1 discs, but level layouts, screens and object placements are the same in the PC releases, so the map applies to every version of the games.

Browse it at **[oddworldmap.com](https://oddworldmap.com/)** — or serve the `public/` folder with any static web server (`python3 -m http.server -d public`) to run it locally.

Part of [RetroAtlas](https://retroatlas.org/), a collection of interactive maps of classic games.

![The viewer on Stock Yards in Oddysee, inspecting a travel bird portal](screenshot.png)

One grid cell = one in-game camera: the viewer lays the games' camera screens out edge to edge on their real world grid and translates every object and collision coordinate to match, so markers land on the artwork.

## Controls

- **AO / AE** buttons switch between the two games
- **drag** or **arrow keys** to pan, **mouse wheel** (anchored at the cursor) or **`+` / `-`** to zoom; **`[` / `]`** step through the level's paths, **`g` / `c` / `f` / `a`** flip the grid, collision lines, foreground masks and connection arrows, **`r`** / **`m`** arm the route planner and the ruler, **`i`** says where you are, **`l`** lists what is on the screen nearest the view's center and **`v`** opens the world graph — press **`?`** for the full shortcut list
- **hover** any object for decoded details
  - the details open with what the thing *is*: one plain-English sentence per object type, the opening line of its encyclopedia entry (curated in [glossary_types.json](public/glossary_types.json))
  - door destinations (level/path/door#), path-transition targets, continue-point zones, Mudokon state (Oddysee job / Exoddus work state + mood), and enemy behaviour (a Slig's start state and how it attacks — `shoot_on_sight_delay=0` means it shoots the instant it sees Abe, no "FREEZE!" warning; whether a Slog starts asleep)
  - each object type surfaces its own notable fields too — a door's lock state, a trap door's or electric wall's on/off, a bird portal's type, a Glukkon's or Crawling Slig's type/state
  - Settings → "Show more object fields" picks which of the game's stored fields each object type shows; the picker never limits what search reads, and what is out of both is the values the map drops as dead (a zero that means nothing is set, and a field the game reads only on other placements)
  - a marquee reads out what it actually scrolls, lifted from the game's own message table: Rupture Farms' slogans ("The profits justify the means."), the SoulStorm Brew ads, the control tutorials, and in Oddysee the phrases its hint-fly swarms spell in mid-air. An Exoddus board names both states of the switch that turns it over, and a board whose messages are all blank says that too: 20 of Oddysee's boards run dark, every one a Rupture Farms Return copy of a board the first visit taught with. Search reads them, so a half-remembered slogan finds the sign
  - a number that is measured in something says so. A timer reads `90 frames ≈ 3s`, a sleeper's hearing reads in grid squares, a chance reads as a percentage. The seconds are derived at the engine's own rate of thirty frames to the second, which the field's definition states
  - in the screen list and the Fields picker, every field name carries a definition, marked by a dotted underline — what it means and its possible values, curated in [glossary_fields.json](public/glossary_fields.json); hover it with a mouse or tap it on a touch screen, where the tap still does what it would have done anyway (tick the field, jump to the object)
- **click** a door, path transition, travel portal, express well, teleporter, level loader or hand stone to follow it to its destination (for hand stones, the camera they show), including across levels
  - while hovering one, its partner — the object you'd come out of — gets a dashed outline whenever the pair sits on the current path
  - a destination is only believed where the object it pairs with is really there: Exoddus stores a level of 1 on links that were never pointed anywhere, which reads as Necrum Mines, so those name no destination and offer no follow — their stored fields still show, raw as the game left them
  - an express well has a destination for each state of the switch it answers to, and the map follows whichever of the two leads somewhere
- **click/tap** anywhere else on a screen to list everything on it, grouped by category
  - hover a row to outline that object on the map, click it to jump there
  - tapping an object opens the list scrolled to that object's highlighted row: on touch devices, where there is no hover, this is how you inspect an object
  - **`l`** opens that list for the screen nearest the view's center and puts the keyboard inside it: Tab walks the rows, Enter jumps to the object one names, Escape closes it and gives the keyboard back to where it came from — with no mouse at all, this is how you inspect a screen
  - the **ⓘ** at a row's edge (also next to each type in the Fields panel) opens that type's encyclopedia card: the full curated entry, how many are placed in each game — counted live, with what the hidden demo paths hold noted apart — what its stored fields mean, and a link that finds every one of them with search
  - on phones the panel opens as a bottom sheet with the map staying visible above it; switch "List a screen's objects on click" off in Settings if you'd rather those clicks did nothing
- level and path buttons top-left; object category filters with counts below — hover a filter for what falls inside it
  - hover a path button for its area name: a curated community name from [annotations.json](public/annotations.json) where one is defined (a deliberate override), otherwise the in-game name (Rupture Farms Return's Zulag 1–4)
  - ahead of either, the section where the game gives one — which half of the level the path belongs to, for the thirteen Exoddus areas the endgame returns to
  - where players have a nickname for a place, that follows after a `·` — nine of the Brewery's zulags carry one, so zulag 3 reads `Zulag 3 · Industrial Machines`, dimmed because it is not what the game calls the place, and on the button itself only with "Show full names" on
  - Exoddus' 25 demo areas — copies of real places that only the demos on the title screen ever play, unreachable however you play — are left off the buttons; Settings → "Show demo paths" lists them, and a link to one opens it either way
  - the buttons follow the order the games store their paths in; Settings → "Paths in play order" lists them in the order a player meets them instead, so the Stock Yards open on their entrance and Rupture Farms Return reads Zulag 1 through 4
- **where you are**: a chip at the top-left corner of the map names the level and path you are looking at
  - click it (or press **`i`**) for the level's full name, which half of it the path belongs to where the game says, the nickname players gave the place where it has one, whether the path is one the game arrives at from another level or one only the title-screen demos play, and the path's note where it has one — a remark on something odd about the place, marked by a dot on the chip
- **somewhere odd**: the shuffle button beside the chip jumps to a random screen — either game, any level — for when you'd rather the map did the choosing
- **world graph**: the **World graph** button under the path list (or **`v`**) puts the map away and draws the whole game as one diagram — every path a box, every way between two of them a line; click a box to travel there
- **edit objects**: with Settings → "Edit object properties" on, an **Edit objects** button appears under the World graph (or press **`e`**); it turns a click on a marker into a selection, and a panel lists every field the game stores for that object — a dropdown of the values the game knows, or a number to type — with what the disc shipped beside anything you have changed and a ↺ to put it back. The map follows the edit everywhere at once: a door sent to another camera draws its arrow there, a lever given a new switch id wires up, the tooltip and the screen list read the new value, and an edited marker wears a second outline so it cannot pass for the game's own data. Edits stay on this device — they are there after a reload, marked as edited — and never travel in a link: a copied link opens on the shipped object. **undo** and **redo** in the panel, or **Ctrl/⌘ Z** and **Shift+Ctrl/⌘ Z** (Ctrl/⌘ Y too), step through the path's edits one at a time for as long as the tab is open — a revert is one step, so a mistaken one comes back with one press; **Revert this path** puts a path back as the disc has it, and the setting's own row forgets every edit on the device and its trail with it
  - edited data says so wherever it shows: the path's button and the chip carry a mark, the tooltip, the screen list and a search hit name the fields you changed, the world graph marks the path's box, and every export of an edited path says so in its name (`oddworld-ae-MI-P1-edited.json`, `…-view-edited.png`, `oddworld-ae-graph-edited.svg`)
- **minimap**: when a path outgrows the window, a small overview appears in the lower-right corner — the path's grid with the viewport drawn on it; click or drag inside it to move the view (it steps aside while a panel takes the same corner, and hides once the whole path fits on screen)
- **reset** in the Display and Objects headers puts that section back to its defaults
- **search** (`/` to focus) matches object names and decoded fields across both games — try `mudokon`, `lcdstatusboard` or `switch_id=70`
  - it also knows the places themselves, listed as a **Places** group above the objects: a level or path by its name (`monsaic`, `feeco`, `zulag 2`), by the nickname players gave it (`tear extractors`), by the section the game files it under (`ender`), or by its code (`R2 P1`) — down to a single screen (`R2 P1 C3`, or a full camera name like `r1p15c03`) — clicking one takes you there, a level opens on the first path it lists, and a screen centers that camera
  - a place's level name finds what is inside it, so `paramonia temple` lists the temple and its trials; the code answers whole words only, so the `2` in `zulag 2` is not answered by the `R2` a path happens to sit in; a screen answers only a query that names one, so `brewery` brings back the Brewery and its paths, not its hundred screens
  - combine terms: a space means all must match (`Mudokon state=chisle` finds only chiselling Mudokons), a comma or the word `or` means any (`Slig, Slog`)
  - results are grouped by context (current path, current level, then per game), rank exact name matches first, and clicking (or Enter) jumps straight to the hit
  - a scope bar narrows the search to the current game/level/path
- on touch devices one finger pans and two fingers pinch-zoom the map; the page itself pinch-zooms too, and while it is zoomed two fingers on the map zoom the page back out instead; the sidebar collapses behind a menu button on narrow screens
- with a **screen reader**, arriving somewhere is spoken: the game, the level's full name, the path and the name it carries, how many objects are on it, and whether it has a note — and the map itself is named with that same line rather than being an anonymous picture; the chip discloses the rest, and pressing **`i`** puts the keyboard in the panel where the section, the nickname and the note are
- **What's new**: the top-right button opens a dated changelog of recent updates; a dot marks entries added since you last opened it, and the tags under the masthead switch each kind of update (new, improved, fixed) in or out of the list — a choice the panel forgets when it closes, so a filter can never hide the news
  - the handful of updates that added something the map was built around wear a shifting foil badge beside their kind, and a Flagship tag at the end of the row switches them; a flagship answers to that tag alone, so turning the other three off leaves the flagships by themselves — the shortest history of the map there is
  - at the other end, an update that was a one-line fix or a flipped default says Tiny beside its kind, so what was a small refinement and what was real news are told apart at a glance without either leaving the feed
- **About this map**: the link at the foot of the sidebar opens the notice that this is an unofficial fan project unaffiliated with Oddworld Inhabitants, alongside links to the map's source and to the project whose reverse-engineering the data formats come from
- the browser's **back button** closes an open panel — What's New, Settings, About, the shortcut list, an object's encyclopedia card — just as **Escape** and the × do, so going back on a phone leaves the panel rather than the map

### Overlays

Every toggle in the Display section explains itself, as do the sidebar's own buttons: hover one for a short note on what it does (on a phone, the note appears as you tap it). The toggles with a keyboard key wear it at the row's edge, and it lights while the key is held.

- **Object labels**: names each object beside its marker, from about half zoom in
- **Connection arrows**: draws the path's whole circulation — every door, express well, bird portal, teleporter and path transition linked to where it leads
  - a double-headed arrow is a two-way pair; a dashed arrow points at the arrival camera when the exact arrival object isn't resolvable; short 45° stubs labelled `→ MI P7` lead to other paths (stub labels appear zoomed in with object labels on)
  - colours tell the kinds apart: doors and the level loader yellow, wells pink, bird portals lavender, teleporters teal, path transitions white
  - hovering an object spotlights just its own arrows
- **Switch wiring** (on by default, or press **`w`**): what a lever actually does — green dotted lines from everything that writes a switch id (levers, buttons, work wheels, pressure plates, pull rings) to everything on the path answering that id (doors, drills, electric walls, trapdoors, bird portals, spawners, status lights), through the logic gates Exoddus wires between them and the hub doors Oddysee opens only when every zulag id they watch is set
  - hovering a wired object spotlights just its own wires, with arrowheads showing which way the signal runs, and the tooltip spells them out — `sets 66 → 5 objects`, or `answers 11 — set in P2` for a wire whose other end lives on another path of the level (switch state is level-wide in the engine, so those connections are real)
  - wires run between markers you can see: hide a category and its wires go with it (status lights and alarms sit in buckets that are off by default)
- **Gaps between screens** (off by default, or press **`s`**): both games address their cameras on a grid larger than the screen you actually see, and the map normally packs that slack away so the screens sit edge to edge. Turn this on and every screen moves to where the game addresses it, with the gaps at their real size — 656×240 units around each Oddysee screen, 7×20 around each Exoddus one. Objects and collision lines the designers put in a gap then sit where they really are, rather than over the neighbouring screen; they stay dotted, because the games render none of it and Abe is teleported straight across it whenever the camera changes
- **Enemy patrol pens** (off by default, or press **`p`**): the invisible posts that pen enemies in (Slig and Scrab bounds, enemy stoppers, moving-bomb stoppers) draw as dashed posts on the exact boundary the game enforces, whenever Enemies / spawners is on and whatever filter bucket they belong to; a foot at the base points into the pen where the type claims a side
  - hover a Slig (or a Slig spawner) and the span it patrols shades in, edge to edge between its own pair of posts — matched the way the game itself matches them, by the slig id both ends carry
- **Collision lines**: floors green, walls red/orange, ceilings blue, dashed = background layer; a line goes dotted where it runs off its own screen, the same way an object's outline does
- **Background-plane objects**: objects placed on the half-scale background plane are drawn dimmed with a dashed outline, so foreground and background objects are tellable apart when reading a route
- **Offscreen objects and lines**: both games address their cameras on a grid slightly larger than the screen you see, and level authors sometimes ran an object or a collision line into the leftover gap. The map lays screens out edge to edge, so that part of it lands over the neighbouring screen: an outline goes hollow and dotted exactly where it leaves its own screen, and stays solid where it really is. One with nothing on screen at all is dotted throughout, and its tooltip says so — 276 of those in Oddysee, whose gap is 656 units wide, and none in Exoddus, whose 7 is too narrow to hide anything. The screen list and the counts put every object on the screen it belongs to, however the packing draws it, and a row whose object is on no screen at all is tagged `offscreen`. The games render none of it either
- **Foreground masks (FG1)**: highlights the scenery drawn in front of the player — every hideable/behind-walkable spot at a glance (pairs well with "Dim backgrounds")
- **Dim backgrounds**: fades the camera artwork to a third of its brightness, so markers and overlays stand out against it

### Measuring and routes

- the readout in the map's bottom corner follows the pointer: its world position, where it stands within its screen in grid squares, and the zoom
- **Ruler**: enable (or press **`m`**), then drag to measure — Δx × Δy, length in true world units and 25-unit grid squares (an Oddysee unit is one PS1 screen pixel; Exoddus screens are scaled artwork, and measurements account for that)
  - its ends snap to nearby object centers — and to collision-line ends while those are shown — so door-to-door distances come out exact; the radius is a few screen pixels, so zooming in shrinks it away
  - hovering a collision line shows its type and length the same way
  - moving on (switching path, following a door, changing game) clears the measurement
- **Route planner**: arm it (or press **`r`**), then click waypoints to plot a route — every leg is labelled with its length, and a bar at the top totals the distance in the same units
  - waypoints snap the way the ruler's ends do
  - **routes go through doors**: while the planner is armed, clicking a door, well, portal or teleporter closes the leg on it, rides it, and keeps plotting where you land — the line breaks at the seam, since the travel between the halves isn't walked, and the bar says how many paths the route crosses (hand stones only show a camera, so they stay plain waypoints)
  - **Backspace** (or the bar's undo button) removes the last waypoint — at a seam it takes the whole crossing back; clear starts over, and the browser back button brings a cleared route back
  - the route travels in the URL, so copying the link shares it exactly as plotted — it opens visible with the map fully browsable, no mode armed — and it appears in PNG exports
  - whoever you share it with can walk it: the route stays while you move among its own paths — path buttons, doors, the back button — and clears only when you wander somewhere it never visits (Back brings it back)
  - should a chat app or forum shorten the link, it opens with the waypoints that survived and says how many are missing

### By the numbers

- the **By the numbers** button under the Objects filters opens a small panel that counts object types you pick at every granularity at a glance: the screen under the view's center, the current path, the level, the whole game
- the numbers follow you as you browse: switch path, follow a door, even press shuffle, and the panel re-derives itself
- counting reads the data rather than the display (a type whose category filter is off still counts, the way search still finds it) and follows the demo-paths setting, noting below the table what the hidden demo copies hold
- click a type's name in the table to stop counting it
- the table holds six types at once; with six picked the rest of the list greys out until you drop one

### World graph

The **World graph** button under the path buttons (or **`v`**) puts the map away and draws the whole game as one diagram. The button stays lit while it is up. The sidebar stays, so the game buttons, search and Settings all still work; pressing the button again, **Escape**, the ×, or the browser's back button bring the map back.

- one column per level, in the games' own level order, and inside each column one box per path in the order a player meets them — the same walk "Paths in play order" lists, whether that setting is on or not, because the walk is what keeps the lines short
- a line gathers every door, express well, bird portal, teleporter, path transition and level loader running between the same two paths, and takes the colour the connection arrows give its kind: doors and the level loader yellow, wells pink, bird portals lavender, teleporters teal, path transitions white
- an arrowhead marks a one-way link and nothing else — 13 of Oddysee's 77 lines and 28 of Exoddus' 97 — so what is worth noticing is what carries a mark; hover a line for what it is made of (`Door ×6`) and which way it runs
- each line leaves its box on a line of its own, so a hub reads as an interchange: the Scrabanian Temple's Trials hall fans out to eight rooms, and the Mudomo and Mudanchee Vaults are that same shape twice more
- where the game files half a level under a name of its own — the five Exoddus areas the endgame returns to — that half sits at the foot of its column under its own caption
- lines inside a level run in the channel beside their column, a line to the next level along drops through the gutter between them, and one reaching further travels the band above the columns — so nothing is ever drawn across a box
- the box you are standing on is outlined, and the diagram opens scrolled to it with the keyboard already on it: Tab walks the boxes level by level, Enter travels to the one you are on, and **`[`** / **`]`** still step through the level's paths with the outline following
- hover a box for the level's full name, the section and nickname where the place has them, whether the game arrives there from another level or only the title-screen demos play there, how many objects are on it, its note, and every path it links to — the one thing a diagram can only be asked in words, and the only way a screen reader gets the lines at all
- a box the game arrives at from another level wears the same `▸` its path button does
- drag the diagram to move it, or use the arrow keys; **fit** scales the whole game into the window and **actual size** puts it back, and **`−`** and **`+`** do the same: Oddysee's diagram is 3491 × 809, Exoddus' 2799 × 896. At the fit the path names drop out and the level codes are scaled back to the size they were, since they are the only labels an overview that small can carry
- the diagram makes one thing plain that no amount of browsing does: Exoddus is two halves that never touch. Nothing in the Necrum Mines, Necrum or either vault connects to anything in FeeCo Depot, the Barracks, Bonewerkz or the Brewery — 38 paths and 51 with no line between them, because the one crossing the game has (the Necrum Vaults to FeeCo Terminal 1) happens in a cutscene and no well pairs for it
- the "Show demo paths" setting moves the diagram, the way it moves the path buttons — Exoddus is 92 paths and 97 links without its demo copies, 117 and 120 with them
- the link in the address bar carries the diagram, so the chain button and a copied URL open on it rather than on the map
- **save svg** and **save png** in the diagram's own bar put it in a file: the SVG stays sharp at any size — a poster, a wiki, print — and the PNG pastes anywhere at twice the diagram's actual size. Both carry the bar's title and colour legend across the top, every name on it however the diagram was being viewed, and the filename says which diagram it is: `oddworld-ae-graph.svg` without the demo copies, `oddworld-ae-graph-demos.svg` with them, and `-edited` after either when a path on it has been edited on this device, which the title and a mark on the path's box say too. On phones the bar keeps to **fit** — save from a wider window

### Sharing and embedding

- the URL hash (`#GAME/LEVEL/path/x/y/zoom`, where x/y is the point in the middle of the view, in the game's own world coordinates) always reflects the current view, including any plotted route
  - copy it to share an exact location, and it opens on that spot whatever the size of the window it lands in; the browser back button retraces follows
  - the chain button in the top-right corner copies the same link, for phones and installed-app mode where there may be no address bar
- **right-click** an object to copy a direct link to it — opening that link centers the object, holds a marker on it until you interact, and names what the marker is on at the bottom of the map
- add **`?embed=1`** to the URL for a view made for iframes on wikis and forums: the map fills the frame, fully interactive (hover, follow, the screen-list panel), with the sidebar starting closed but reachable through the menu button
  - a corner button opens the full site at the exact view
  - combine it with any permalink hash to embed an exact screen, e.g. `https://oddworldmap.com/?embed=1#AO/R1/15/…`
- an **Export** button under the Display toggles unfolds three exports; the two image ones draw the overlays, markers and plotted route that are on
  - **Export whole path** puts every screen of the path in one image, laid out edge to edge at the artwork's own resolution however far the view is zoomed out — Rupture Farms' widest path comes out as a 4416 × 720 `oddworld-ao-R1-P15-full.png` with all twenty of its screens on it, and the largest path either game has, Necrum Mines P4, as a 4416 × 3360 one with thirty-seven; turning on "Gaps between screens" can take a path past what a browser will hand back as a single image, and the export scales it to fit and says what it scaled to
  - the image is framed on the path's screens, so an object or a collision line the map draws out in the gap beyond the outermost ones can fall outside it: 248 dotted Oddysee markers do, and nothing that covers a screen ever does. Turning on "Gaps between screens" takes that ground in, since there it is canvas of its own
  - **Export view** saves what the canvas is showing, the visible area at the current zoom, as `oddworld-ao-R1-P15-view.png`
  - an image of a path you have edited carries the edited markers' outlines and says so in its name (`…-view-edited.png`, `…-full-edited.png`)
  - **Export path as JSON** saves the path in the format the [AliveTeam level editor](https://github.com/AliveTeam/qt-editor) reads: every object with all of its fields, and every collision line, as `oddworld-ao-R1-P15.json`. It carries no artwork and no game code — a description of the path rather than a level. An unedited path's file is what this map is checked against object for object; a path you have edited saves as `oddworld-ao-R1-P15-edited.json` and describes your edits
  - importing it into your own copy of the game replaces that path's objects and collision lines and **drops the path's foreground masks**, the layer that hides Abe behind scenery, because the importer rebuilds them from the file and this one has none to give
  - the two image buttons act on the map, so the world graph is put away while they are, and it saves from its own bar instead — see [World graph](#world-graph)

### Settings

The gear button at the top of the sidebar opens them, in three groups. A setting you have changed from its default says so on its row, so "off by default" reads apart from "I turned this off".

- **Saved on this device**
  - "Remember display & object filters" (on by default) keeps the Display toggles and Objects filters across visits; turn it off to start from the defaults every time
  - "Remember last location" (off by default) reopens the map where you left off when the URL carries no permalink — a shared link always wins
  - "Keep the map on this device" (off by default) stores the app itself and every screen you visit, so the map opens and works offline, the places you've browsed included; everything refreshes automatically while you're online, and switching it off frees the storage
    - switching it on offers each game's artwork as one download (~65 MB for Oddysee, ~137 MB for Exoddus, or both in one go), so places you have never opened work offline too; a download resumes where it left off, and the rows report what is stored rather than what was clicked
- **Buttons and names**
  - "Show full names" (on by default) expands the game, level and path buttons into a list labelled with their full names ("MI — Necrum Mines"); turn it off for the bare short codes
  - "Paths in play order" (off by default) lists a level's paths in the order a player meets them rather than the order the games store them: the way into the level first, then a walk of the doors, wells, portals and transitions out from it, each area finished before the next one starts, numbered areas in the order the games' own signs count them, and an Exoddus level's endgame half together at the end — so Necrum Mines opens on Tunnel 1 with its secret area beside it, the Paramonian Temple lists the hub before the six trials it opens, and the Brewery reads its terminal, its first hub, zulags 1 to 5, its second hub, and on
  - "Show demo paths" (off by default) adds Exoddus' 25 demo areas to the path buttons, marked `[Demo]`; they are copies of real places that only the title-screen demos visit, so the map leaves them out of the buttons and out of search results, but a shared link to one still opens it and says what it is
- **Objects and fields**
  - "List a screen's objects on click" (on by default) opens the screen-inventory panel when a click/tap finds nothing to follow
  - "Show more object fields" (off by default) reveals a "Fields" panel in the sidebar where you pick, per object type, which of its fields show in tooltips and the screen list (the notable ones pre-checked) — a ⚙ next to an object in a screen's list opens that type's row in the panel; with it off, only the notable fields show and the panel stays hidden
  - "Edit object properties" (off by default) adds the Edit objects button to the sidebar and turns on its key; its row counts the objects you have edited across both games and forgets them all in two presses. Edits you made earlier keep applying, marked, with the setting off: an edit is kept as its difference from the disc, so a rebuild of the map applies it where its object still is and forgets, with a note, any that no longer match; an embedded map applies none and always shows the disc's data
  - "Show raw field values" (off by default) shows field values as the raw numbers the game stores (1/0, 15, …) instead of the translated text (left/right, patrol, true/false) and the units a bare number is measured in (`90 frames ≈ 3s`, `6 grid`, `100%`); search matches whichever representation you're viewing

## Rebuilding from a disc image

The site's generated data under `public/` (`cams/`, `map_data_ao.json`, `map_data_ae.json`) is produced by [tools/build_map.py](tools/build_map.py) from raw PS1 disc images (2352-byte sectors, e.g. the `.bin` of a `.cue/.bin` dump):

```bash
python3 tools/build_map.py --game AO --disc "/path/to/Abe's Oddysee.bin"
python3 tools/build_map.py --game AE --disc "/path/to/Exoddus (Disc 1).bin" "/path/to/Exoddus (Disc 2).bin"
python3 tools/build_map.py --levels R2,R6   # subset while iterating
```

`--disc` can be omitted if `$ODDWORLD_DISC_AO` / `$ODDWORLD_DISC_AE` point at the images; `$ODDWORLD_DISC_AE` holds both discs separated by `:` (the PATH separator):

```bash
export ODDWORLD_DISC_AO="$HOME/games/Abe's Oddysee.bin"
export ODDWORLD_DISC_AE="$HOME/games/Exoddus (Disc 1).bin:$HOME/games/Exoddus (Disc 2).bin"
```

The script needs Python 3.8 or newer, compiles `tools/cam2rgba` automatically on first run (needs a C++17 compiler) and requires [oxipng](https://github.com/oxipng/oxipng) at exactly the release `OXIPNG_VERSION` in [tools/oddmap/image.py](tools/oddmap/image.py) names, 10.2.1 — every emitted PNG is losslessly recompressed, oxipng's bytes move between its releases, and the builder refuses any other release rather than rewriting images that reproduce as they stand. `brew pin oxipng` keeps Homebrew's copy where it is, and `cargo install oxipng --version 10.2.1 --locked` installs a release Homebrew no longer offers. Everything the builder parses from the [alive_reversing](https://github.com/AliveTeam/alive_reversing) decompilation — level/path tables, object field layouts, enum labels, the level editor's schema — is cached under [tools/data/](tools/data/); a cache only needs regenerating if it is deleted, which reads the checkout `$ODDWORLD_DECOMP` names, else the one beside this repo, and refuses one that is not at the pinned revision. The collision links beside them (`lines_ao.json`, `lines_ae.json`) are not a cache of the checkout but the discs' own data, like the artwork: a normal build writes them, and nothing regenerates them without the discs.

A rebuild that changes any committed cam PNG also rewrites `CACHE_NAME` in [sw.js](public/sw.js), which the build summary prints — commit that line with the artwork. It is a content hash of the images, and visitors who opted into artwork caching serve cams cache-first from a service worker and never revalidate them, so it is what stops them keeping the old images indefinitely.

## How it works

- **Disc → files**: raw MODE2/FORM1 sectors are parsed as ISO9660; each level is a `.LVL` archive (32-byte header + 24-byte file records) containing the path data (`xxPATH.BND`) and one `.CAM` per camera.
- **Path chunks** hold, in order: the camera-name table (8 bytes/cell), collision lines (20 bytes, coordinates + type), and packed TLV object records (0x18-byte header in AO, 0x10 in AE, + type-specific payload) which the builder walks linearly and places by world coordinates.
  - Level/path tables and the AE type enum are parsed from the [alive_reversing](https://github.com/AliveTeam/alive_reversing) decompilation into `tools/data/` caches.
- **Camera backgrounds** are MDEC-compressed: 12 strips per screen, each decoding to 32×240 and assembled into 384×240 and cropped to the 368 visible columns before being written as PNG (the other 16 are macroblock padding). Oddysee frames a strip with a `u16` length prefix and a BS v3 bitstream, Exoddus with a `u32` prefix and BS v2; the decoder detects which.
  - The decoder (`tools/cam2rgba.cpp`) is built on `PSXMDECDecoder` from the [alive_reversing](https://github.com/AliveTeam/alive_reversing) project, patched for bounds-safe decoding of camera strip streams.
- **The viewer** is dependency-free vanilla JS with no build step: [index.html](public/index.html) plus [css/main.css](public/css/main.css) and the ES modules under [js/](public/js/) ([js/main.js](public/js/main.js) boots the app); `map_data_ao.json` / `map_data_ae.json` carry the level/path/TLV/collision data. The boot reads the link to see which game it is opening and draws as soon as that game's data lands, fetching the other behind it.
  - **Offline cache**: an optional service worker ([sw.js](public/sw.js), off by default — Settings → "Keep the map on this device") keeps the app and visited screen artwork cached on-device: repeat visits render instantly instead of re-downloading, and with no connection the map still opens and shows every place you've browsed. [js/offline.js](public/js/offline.js) is its page-side half, offering a whole game's artwork as one download so nothing has to be browsed to be kept.
  - **Checks**: `npm run lint` (ESLint) and `npm test` (`node --test` unit tests for the DOM-free logic) cover the viewer, `npm run test:browser` (Playwright) drives the served site headlessly, pinning the alignment anchors as exact geometry and pixel checks and smoke-testing boot, permalinks, follows, embed mode, search, settings, the world graph's SVG and PNG downloads and the path's JSON export, and the builder is byte-compiled, linted with [ruff](https://docs.astral.sh/ruff/) and unit-tested with `python3 -m unittest discover -s tools/tests` (stdlib only, no disc image needed); CI runs all of it.
  - **Changelog**: the in-app What's New panel reads [changelog.json](public/changelog.json) (hand-curated, newest-first); [tools/changelog.py](tools/changelog.py) drafts candidate entries from the git log (dropping internal churn and printing each commit as context) to be curated in, but never writes the file itself.
  - **Level pages**: every level has a plain HTML page under [levels/](public/levels/) — its paths in play order with links into the viewer — so search engines have somewhere to land; [tools/levelpages.js](tools/levelpages.js) emits them (and the sitemap) from the committed data, and a test keeps the committed pages byte-identical to a fresh emit.
- **Curated names**: [annotations.json](public/annotations.json) is hand-curated (never generated) — names and notes the discs don't provide: community names for 155 of the 173 paths the games leave nameless, plus notes on the places with something odd about them.
  - A path entry is a bare name string, or `{name?, note?, nickname?}` where there is more to say.
  - The note is a curiosity about that place, not the evidence behind the name, and it reads in the panel behind the map's place chip.
- **Nicknames**: a `nickname` is what players call a place, where the map has adopted their name for it — the [Oddworld Wiki](https://oddworld.fandom.com/wiki/SoulStorm_Brewery_(level))'s names for the Brewery's zulags, used as written where the shipped data confirms they fit, so zulag 3 answers to Industrial Machines and does hold more drills than anywhere else in the level.
  - It cannot be folded into the name, because every colon name in the Brewery marks a sub-path of a zulag that spans more than one path, so "Zulag 10: Slig High Security" would claim a division that isn't there.
  - It shows dimmed beside the name, never in its place, and each one is pinned in the tests against the fit it claims.
  - A name the map coins itself is not a nickname and goes in `name` instead.
- **The override rule**: a curated name deliberately overrides the in-game one where both exist, but must keep the in-game label visible within it ("Zulag 2 — Lobby", never a full erasure — the tests enforce this); the extracted map data itself is never altered.
  - A path's section is not a name and stands outside the rule: it says which half of the level the path belongs to, so it shows beside the curated name instead of having to be repeated inside it.
  - An adopted name stands outside it for the same reason — it is not the curated name, so it has nothing to refine.

Structure layouts (TLV types, path tables, collision records) come from the alive_reversing decompilation (the AO path tables from commit `c1ba4c6c8`, everything else from `e2badb8df` — the `AO_COMMIT` and `DECOMP_COMMIT` pins in [tools/oddmap/paths.py](tools/oddmap/paths.py)), which matches the PS1 data formats. Both games address cameras on a grid coarser than the screen: world units map 1:1 to PS1 screen pixels, and each camera shows a 368×240 window of them inside its cell. AO's cell is 1024×480, with the window centered at (cell·1024+440, cell·480+240); AE's is 375×260, with the window at the cell's corner. The map lays screens out edge to edge, folding away the slack the game never renders.

## Credits & licensing

- Game data formats reverse-engineered by the [AliveTeam / alive_reversing](https://github.com/AliveTeam/alive_reversing) project.
- Curated path names in [annotations.json](public/annotations.json) draw on Oddworld: New 'n' Tasty's official chapter names and on the [Barebones walkthrough](https://steamcommunity.com/sharedfiles/filedetails/?id=1812678216) on Steam, whose per-path titles most of the Oddysee names follow.
  - The Exoddus names are read off the game's own signage where it has any — the zulag, tunnel, block and terminal boards and the arches over them — and elsewhere from matching each path's contents against MCJohn117Chief's [GameFAQs walkthrough](https://gamefaqs.gamespot.com/pc/198221-oddworld-abes-exoddus/faqs/74324) and the [Oddworld Wiki](https://oddworld.fandom.com/wiki/SoulStorm_Brewery_(level)), with the demo paths and each level's entry path taken from the decompilation's own tables.
  - A curated name may refine the games' own coarse labels, but the extracted data is never altered.
- Nine of the Brewery's zulags additionally carry a nickname, the Oddworld Wiki's own name for that sector, adopted as written (minus its `#1`/`#2` numbering) where the shipped data confirms the name fits: Industrial Machines, Electrical Devices, Tear Gas, Blind Mudokon, Slog Warehouse, Slig High Security, Tear Extractors and the two Flying Sligs zulags.
  - Those are the wiki's coinages, not this project's, and the map shows them as such — beside each zulag's own number rather than in place of it.
- `tools/PSXMDECDecoder.{cpp,h}` are GPL-2.0 (see file headers; originally from libbs / psxdev). The rest of the tooling and the viewer were written for this project.
- Oddworld: Abe's Oddysee and Abe's Exoddus are © Oddworld Inhabitants. This project ships no game code and is intended for research, speedrunning and preservation; the extracted imagery remains the property of its copyright holders. The site says as much in the app, behind the sidebar's "About this map" link.
- Copyright (C) 2026 mariobob, under GPL-2.0 (see [LICENSE](LICENSE)). The licence covers the code written for this project and nothing else: not the vendored decoder above, and not the extracted imagery, which was never this project's to license.
- A rights holder who wants something taken down can write to hello@retroatlas.org.
