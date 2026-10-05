// Viewer-wide tunables and the object category tables.
// Environment-free on purpose: this module must stay importable outside the
// browser (the unit tests run it in bare Node).

export const ZOOM_MIN = 0.02, ZOOM_MAX = 4;              // manual zoom clamp (px per draw unit)
export const FOCUS_ZOOM_MIN = 0.5, FOCUS_ZOOM_MAX = 1.6; // zoom clamp when jumping to an object
export const FOCUS_SCREENS = 2.6;                        // jump target: ~this many screens across
export const FLASH_MS = 1600;                            // follow-destination highlight duration
export const FLASH_HOLD_MAX_MS = 30000;                  // held highlight's cap when no interaction comes
export const TOAST_MS = 3000;                            // toast lifetime, and its countdown bar's drain
export const TOAST_OUT_MS = 150;                         // fade before a spent toast leaves the stack
export const TOAST_MAX = 3;                              // toasts on screen at once; the rest wait behind a "+N more" badge
export const CACHE_MAX_IMAGES = 500;                     // cam bitmaps kept before eviction (~70 KB compressed each)
export const CAM_FILE_BYTES = 70000;                     // typical cam PNG, for sizing a download before it runs
export const SHEET_FILE_BYTES = 780000;                  // typical sprite sheet, the same sizing
export const KEY_PAN_PX = 75, KEY_ZOOM_STEP = 1.25;      // keyboard pan step (screen px) / zoom factor per press
export const GRID_UNIT = 25;                             // world units per in-game grid square
export const LOGIC_FPS = 30;                             // logic frames the engine counts to the second
export const PAGE_ZOOM_MIN = 1.02;                       // browser zoom counted as zoomed (a pinch settles a hair off 1)
export const MAX_ROUTE_PTS = 512;                        // route waypoints a permalink may carry (parser sanity cap)
export const EXPORT_MAX_PX = 4096 * 4096;                // whole-path export: canvas area cap, past which the image scales to fit
export const EXPORT_MAX_DIM = 8192;                      // whole-path export: canvas side cap, past which the image scales to fit

// what an object anchored between camera windows has to say for itself
export const OFFSCREEN_NOTE =
  "Offscreen: anchored between camera windows, where the map draws it over a neighbouring screen.";

// what a path says about itself: a tooltip trails a path name that can carry a colon
export const ENTRY_NOTE = "entry point (arrived at from another level)";
export const DEMO_NOTE = "demo path (only the title-screen demos play here)";
export const EDITED_NOTE = "edited on this device";

export const LINE_COLORS = { 0:"#43d94c", 1:"#ff5c5c", 2:"#ff9d3d", 3:"#5ca9ff", 4:"#2b8f33", 5:"#a33c3c", 6:"#a3702b" };
export const LINE_NAMES = { 0:"Floor", 1:"Wall (left)", 2:"Wall (right)", 3:"Ceiling",
                            4:"Background floor", 5:"Background wall (left)", 6:"Background wall (right)" };

// connection-arrow colors by source kind — every transition kind shares the
// one Doors/Transitions CATS bucket, so the category color can't tell them
// apart; unlisted kinds fall back to white
export const CONN_COLORS = { Door:"#ffd23e", LevelLoader:"#ffd23e",
                             WellExpress:"#ff6ee9", BirdPortal:"#b78cff",
                             Teleporter:"#6ef0e2", PathTransition:"#ffffff" };

// ---- categories (matched by TLV name so both games share the buckets) ----
export const CATS = [
  { key:"board",  label:"LCD Status Boards", color:"#ff3860", on:true, names:["LCDStatusBoard"], tip:"The Mudokon tally boards: how many are left, saved and lost, and in Exoddus the ledger every rescue and death is booked against." },
  { key:"mud",    label:"Mudokons",          color:"#3ec6ff", on:true, names:["Mudokon","SlingMudokon","RingMudokon","LiftMudokon","MudokonPathTrans","TorturedMudokon"], tip:"Not only the workers Abe rescues: the chanters that grant spirit rings, the guards that sling unless their password is answered, the ones strung up in tear extractors, and the deaf ones placed as scenery." },
  { key:"door",   label:"Doors / Transitions", color:"#ffd23e", on:true, names:["Door","PathTransition","BirdPortal","BirdPortalExit","WellLocal","LocalWell","WellExpress","Teleporter","SlamDoor","MineCar","LevelLoader","LiftPoint","LiftMover","DoorBlocker"], tip:"Doors, and everything else that carries Abe somewhere: path transitions, bird portals, wells, teleporters, lifts and the level loader, with the locks that bar a door until a switch is thrown." },
  { key:"cont",   label:"Continue points",   color:"#ffffff", on:true, names:["ContinuePoint","AbeStart","ElumStart"], tip:"Where the game restarts you, and the marks that place Abe at a level's start." },
  { key:"switch", label:"Switches / levers", color:"#5dde75", on:true, names:["Switch","Lever","InvisibleSwitch","FootSwitch","BellHammer","HandStone","IdSplitter","SecurityDoor","BellSongStone","ChimeLock","MovieHandStone","GlukkonSwitch","CrawlingSligButton","MultiSwitchController","WheelSyncer","TimerTrigger","WorkWheel","SlapLock","PullRingRope","ResetPath","ResetSwitchRange","RollingBallStopper"], tip:"Everything that sets a switch id: levers, buttons, plates, work wheels, chime locks and hand stones, the stoppers a rolling ball trips, with the logic gates and resets that sit between them." },
  { key:"hazard", label:"Hazards",           color:"#ff8b3d", on:true, names:["DeathDrop","TimedMine","Mine","UXB","ElectricWall","MovingBomb","MeatSaw","DeathClock","GasEmitter","GasCountdown","TrapDoor","FallingItem","RollingBall","RollingRock","ZBall","Drill","LaughingGas","ExplosionSet","Water","SecurityOrb","SecurityClaw","MotionDetector"], tip:"Anything that hurts Abe, or fetches someone who will: mines, saws, drills, gas and water, plus the security orbs, claws and motion detectors that punish rather than kill." },
  { key:"enemy",  label:"Enemies / spawners", color:"#c85dff", on:true, names:["Slig","Slog","Paramite","Scrab","Bat","Bees","HoneySack","SligSpawner","SlogSpawner","ScrabSpawner","Glukkon","SlogHut","FlyingSlig","FlyingSligSpawner","CrawlingSlig","Fleech","Slurg","SlurgSpawner","ZzzSpawner","Greeter","SligGetPants","SligGetWings","BeeSwarmHole"], tip:"The creatures the level fields, hunting or not: Sligs, Slogs, Scrabs, Paramites, Fleeches and the rest, plus the spawners, marked spots that materialise fresh ones when a switch or timer asks." },
  { key:"pickup", label:"Pickups / dispensers", color:"#b6e83c", on:true, names:["RockSack","MeatSack","BoneBag","Honey","BoomMachine","BrewMachine"], tip:"What Abe can pick up: rock and meat sacks, bone bags, honey, and the machines that dispense grenades and brew." },
  { key:"screen", label:"Displays",          color:"#3effc8", on:true,  names:["LCDScreen","LCD","MovieStone","HintFly","DemoPlaybackStone","StatusLight","ColourfulMeter","DoorFlame"], tip:"The level's signs and readouts: LCD screens, hint flies, status lights, meters and door flames." },
  { key:"scenery", label:"Scenery",          color:"#ffb0c8", on:true,  quietLabels:true, names:["LightEffect","BackgroundAnimation","Dove","FlintLockFire","ParamiteWebLine"], tip:"The scenery that lives on its own: the glows and door lights, the animated backdrops, the doves circling a portal, the flintlock fires and the Paramites' webs." },
  { key:"nav",    label:"Hoists / edges",    color:"#8f9bb3", on:false, names:["Hoist","Edge","Pulley","ElumWall","ScrabNoFall"], tip:"The geometry that carries or stops a body: hoists, ledges and pulleys, and the invisible lines holding Scrabs and the Elum to their ground." },
  { key:"meta",   label:"Meta / bounds",     color:"#5b6270", on:false, names:[], tip:"Everything the other filters do not claim: the zones and bounds that shape behaviour without being seen, shadow zones, music triggers, and the game's own bookkeeping markers." },   // fallback for everything else
];
const NAME_CAT = {};
CATS.forEach(c => c.names.forEach(n => NAME_CAT[n] = c));
const META_CAT = CATS[CATS.length - 1];
export const catOf = t => NAME_CAT[t.name] || META_CAT;

// the invisible posts that pen enemies in — tiny stamps in the data, rendered as
// barriers and shown whenever Enemies is, whatever bucket holds them. The value
// is the side the pen lies on (+1 right of the post, -1 left, 0 unclaimed);
// EnemyStopper carries its own stop_direction field instead.
export const BARRIERS = { SligBoundLeft:1, SligBoundRight:-1, ScrabLeftBound:1, ScrabRightBound:-1,
                          EnemyStopper:0, MovingBombStopper:0 };
export const ENEMY_CAT = CATS.find(c => c.key === "enemy");
export const barrierDir = t => {
  const b = BARRIERS[t.name];
  if (b === undefined) return null;
  if (t.name !== "EnemyStopper") return b;
  const d = t.fields?.stop_direction; // 0 stops leftward travel, 1 rightward, 2 both
  return d === 0 ? 1 : d === 1 ? -1 : 0;
};

// the pens toggle gates the whole barrier treatment — off by default, since
// hundreds of posts are clutter for anyone not reading patrol ranges
export const PENS = { on: false };

// scenery the game draws nothing for yet Abe uses, kept there to point at
export const USED_UNSEEN = ["HandStone", "MovieHandStone", "BellSongStone", "MovieStone"];

// the one visibility rule for map markers: what is drawn is exactly what can
// be pointed at
export const markerShown = t =>
  catOf(t).on || (t.name in BARRIERS && PENS.on && ENEMY_CAT.on);

// ---- switch wiring: the fields that write a switch id (out) and the fields
// that answer to one (in). The engine keeps one switch-state array per level
// (ids are level-scoped; the array resets only on level change), ids 0 and 1
// are hardwired never/always-on and producers refuse them, so only 2..255 can
// carry a wire. Curated against the engine's actual read/write sites: most
// fields named switch_id are neither end (pair numbers, spawner bindings,
// words never read), and a drill or saw that writes its own id back at cycle
// end is group timing rather than wiring, so those stay consumers.
export const WIRES = {
  AO: {
    out: {
      Switch:["switch_id"], InvisibleSwitch:["switch_id"], FootSwitch:["switch_id"],
      PullRingRope:["switch_id"], BellSongStone:["switch_id"], ChimeLock:["solve_switch_id"],
      SecurityDoor:["switch_id"], Mudokon:["rescue_switch_id"], MotionDetector:["alarm_switch_id"],
      SecurityClaw:["alarm_switch_id"], IdSplitter:["id_1","id_2","id_3","id_4"],
      RollingBallStopper:["ball_switch_id"],
    },
    in: {
      Door:["switch_id"], TrapDoor:["switch_id"], ElectricWall:["switch_id"],
      DoorFlame:["switch_id"], FlintLockFire:["switch_id"], MeatSaw:["switch_id"],
      EnemyStopper:["switch_id"], MovingBomb:["switch_id"], FallingItem:["switch_id"],
      RollingBall:["release_switch_id"], RollingBallStopper:["stopper_switch_id"],
      LiftMover:["lift_mover_switch_id"], MusicTrigger:["switch_id"], DeathClock:["start_switch_id"],
      Bees:["switch_id"], BellHammer:["switch_id"], WellLocal:["switch_id"], WellExpress:["switch_id"],
      SligSpawner:["slig_spawner_switch_id"], SlogSpawner:["spawner_switch_id"], SlogHut:["switch_id"],
      Slog:["anger_switch_id"], Paramite:["surprise_web_switch_id"], ChimeLock:["password_switch_id"],
      IdSplitter:["source_switch_id"], MotionDetector:["disable_switch_id"],
    },
  },
  AE: {
    out: {
      Lever:["switch_id"], InvisibleSwitch:["switch_id"], FootSwitch:["switch_id"],
      PullRingRope:["switch_id"], WorkWheel:["switch_id"], CrawlingSligButton:["switch_id"],
      SlapLock:["toggle_switch_id","target_tomb_id_2"], GlukkonSwitch:["ok_switch_id","fail_switch_id"],
      Glukkon:["help_switch_id","death_switch_id"], Mudokon:["rescue_switch_id"],
      MotionDetector:["alarm_switch_id"], HandStone:["trigger_switch_id"],
      MovieHandStone:["trigger_switch_id"], SecurityDoor:["switch_id"],
      Slurg:["switch_id"], SlurgSpawner:["switch_id"], MultiSwitchController:["output_switch_id"],
      TimerTrigger:["output_switch_id_1","output_switch_id_2","output_switch_id_3","output_switch_id_4"],
      WheelSyncer:["output_switch_id"],
    },
    in: {
      Door:["switch_id"], SlamDoor:["switch_id"], TrapDoor:["switch_id"], DoorBlocker:["switch_id"],
      DoorFlame:["switch_id"], Drill:["switch_id"], ElectricWall:["switch_id"], EnemyStopper:["switch_id"],
      ExplosionSet:["switch_id"], FallingItem:["switch_id"], MovingBomb:["start_moving_switch_id"],
      LiftMover:["lift_mover_switch_id"], BirdPortal:["create_portal_switch_id","delete_portal_switch_id"],
      StatusLight:["switch_id","id_1","id_2","id_3","id_4","id_5"], LCD:["toggle_message_switch_id"],
      ColourfulMeter:["switch_id"], Alarm:["switch_id"], Water:["switch_id"], GasEmitter:["switch_id"],
      GasCountdown:["start_timer_switch_id","stop_timer_switch_id"], LaughingGas:["laughing_gas_switch_id"],
      LevelLoader:["switch_id"], SoftLanding:["switch_id"], Teleporter:["switch_id"],
      WellExpress:["switch_id"], LocalWell:["switch_id"], ZzzSpawner:["switch_id"],
      SligSpawner:["id"], SlogSpawner:["spawner_switch_id"], ScrabSpawner:["spawner_switch_id"],
      SlurgSpawner:["spawner_switch_id"],
      FlyingSligSpawner:["spawner_switch_id","launch_grenade_switch_id"],
      FlyingSlig:["launch_grenade_switch_id"], CrawlingSlig:["panic_switch_id"],
      Fleech:["wake_up_switch_id","can_wake_up_switch_id"], Slog:["anger_switch_id"],
      Paramite:["surprise_web_switch_id"], Mudokon:["angry_switch_id"],
      Glukkon:["spawn_switch_id","play_movie_switch_id"], TimerTrigger:["input_switch_id"],
      TorturedMudokon:["kill_switch_id","release_switch_id"],
      MultiSwitchController:["input_switch_id_1","input_switch_id_2","input_switch_id_3",
                             "input_switch_id_4","input_switch_id_5","input_switch_id_6"],
      WheelSyncer:["input_switch_id_1","input_switch_id_2","input_switch_id_3",
                   "input_switch_id_4","input_switch_id_5","input_switch_id_6"],
    },
  },
};

// hub doors run an AND over their eight hub ids and write the result to their
// own switch id, making those doors both consumer and producer; which doors
// run the gate is a per-game field value (Door.cpp's hub/tasks-door update)
export const DOOR_GATE = { AO: t => t.fields?.start_state === 2,
                           AE: t => t.fields?.door_type === 2 || t.fields?.door_type === 3 };
export const HUB_FIELDS = ["hub_1_id","hub_2_id","hub_3_id","hub_4_id",
                           "hub_5_id","hub_6_id","hub_7_id","hub_8_id"];

// wires carry the switch signal, so they take the switches category's green
export const WIRE_COLOR = CATS.find(c => c.key === "switch").color;

// world graph geometry: the node box, the row pitch and the gutter right of a
// column that every edge routes in — `lane` apart, `laneGap` clear of whatever
// they hug, and `bandLane` apart in the band above the columns
export const GRAPH = { nodeW:190, nodeH:26, rowPitch:38, secGap:18, fan:4,
                       gutter:56, lane:7, laneGap:8, bandLane:9, pad:24, headH:26 };
