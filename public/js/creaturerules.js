import { raycastDiag, raycastDown } from "./engine/collide.js";
import { filedCell, sligBounds, tlvCell } from "./model.js";
import { lcdMessages } from "./messages.js";
import { AE_MUDOKONS_IN_LEVEL, AO_MUDOKONS, TALLY_EDGE, lcdIds } from "./engine/lcd.js";
import {
  FLOOR,
  TRACK,
  planeTypes,
  snapAt,
  trunc,
  mid,
  midY,
  AO_STOCKYARDS,
  AO_YARDS_TINT,
  NE_TINT,
  brain,
  patrol,
  draw,
  rule,
  both,
  stackOffset,
} from "./spritekit.js";

// ---- creatures --------------------------------------------------------------

const camOf = (c, t) => c.path.cams.find((cm) => cm.cell === filedCell(t, c.path, c.geo, c.game));

both("Slig", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const spawnX = snapAt(c, t.x1);
  // one Bonewerkz screen stands its sligs unstacked
  const unstacked =
    ae && c.lvl.short === "BW" && c.path.id === 2 && camOf(c, t)?.name?.endsWith("C05");
  const x = spawnX + (unstacked ? 0 : stackOffset(c));
  const y = hit ?? t.y1;
  const asleep = f.start_state === 2;
  const yards = !ae && AO_STOCKYARDS.has(c.lvl.short);
  const anim = (asleep ? "Slig_Sleeping" : "Slig_Idle") + (yards ? "@StockYardsSlig" : "");
  const rgb = ae ? [102, 127, 118] : yards ? [127, 127, 127] : [105, 105, 105];
  let cycle = asleep ? brain(c, "sligSleep") : null;
  if (f.start_state === 1) {
    const { left, right } = sligBounds(t, c.path, c.geo, c.game);
    // Oddysee's decomp clears the zone before its scan, so a side with none
    // reads zero, and gives a slig no bound matched at all its hack values;
    // Exoddus never sets a side its scan misses, so a slig short of one stands
    if (!ae || (left && right)) {
      const zone = left || right ? { x: left?.x1 ?? 0, w: right?.x1 ?? 0 } : { x: 12809, w: 6405 };
      const p = {
        pauseTime: f.pause_time,
        leftMin: f.pause_left_min,
        leftMax: f.pause_left_max,
        rightMin: f.pause_right_min,
        rightMax: f.pause_right_max,
        zone,
      };
      cycle = patrol(c, "slig", p, { x: spawnX, y: t.y1 });
    }
  }
  return [
    draw(c, anim, x, y, { layer: c.half ? 14 : 33, flip: f.start_direction === 0, rgb, cycle }),
  ];
});

const locker = (c) => [
  draw(c, "CrawlingSligLocker_Closed", mid(c.t), c.t.y2, { layer: c.half ? 6 : 25 }),
];
rule("AE", "SligGetPants", locker);
rule("AE", "SligGetWings", locker);

rule("AE", "CrawlingSlig", (c) => {
  const { t, f } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 37, planeTypes(c.half, FLOOR));
  const awake = f.state === 2;
  return [
    draw(c, awake ? "CrawlingSlig_Idle" : "CrawlingSlig_Snoozing", x, hit ?? t.y1, {
      layer: awake ? (c.half ? 8 : 27) : c.half ? 6 : 25,
      rgb: NE_TINT(c),
      cycle: awake ? null : brain(c, "crawlSleep"),
    }),
  ];
});
// a spawner draws nothing itself: its brain breathes out the Zs
rule("AE", "ZzzSpawner", (c) => [
  draw(c, null, c.t.x1, c.t.y1, {
    cycle: brain(c, "zzz", false, {
      switchId: c.f.switch_id,
      interval: c.f.zzz_interval,
      layer: 39,
      scale: c.half ? 0.5 : 1,
    }),
  }),
]);
rule("AE", "CrawlingSligButton", (c) => [
  draw(c, "CrawlingSligButton", mid(c.t), c.t.y2, { layer: c.half ? 6 : 25 }),
]);

// a flying slig hangs twenty units under the track line its rect's diagonal
// crosses, and bobs about that
rule("AE", "FlyingSlig", (c) => {
  const { t, f } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, TRACK);
  if (!hit) return [];
  const p = {
    left: f.start_direction === 0,
    delayed: f.spawn_delay_state === 1,
    delay: f.spawn_move_delay,
    pauseMin: f.patrol_pause_min,
    pauseMax: f.patrol_pause_max,
    maxSpeed: f.max_velocity,
  };
  return [
    draw(c, "FlyingSlig_Idle", hit.line[0], hit.line[1] + 20 * (c.half ? 0.5 : 1), {
      layer: c.half ? 14 : 33,
      flip: f.start_direction === 0,
      cycle: patrol(c, "flyslig", p, { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }),
    }),
  ];
});

both("Slog", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, ae ? FLOOR : planeTypes(c.half, FLOOR));
  const x = t.x1 + (ae ? stackOffset(c) : 0);
  const y = hit ?? t.y1;
  const rgb = ae ? [127, 127, 127] : AO_YARDS_TINT(c, [48, 48, 48], [127, 127, 127]);
  const asleep = f.asleep === 1;
  return [
    draw(c, asleep ? "Slog_Sleeping" : "Slog_Idle", x, y, {
      yOff: ae ? (c.half ? 2 : 1) : c.yOff,
      layer: ae ? 34 : c.half ? 15 : 34,
      flip: f.start_direction === 0,
      rgb,
      cycle: brain(c, asleep ? "slogSleep" : "slog"),
    }),
  ];
});

both("Scrab", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  let x = t.x1 + 12;
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 30, planeTypes(c.half, FLOOR));
  if (hit !== null) x = snapAt(c, x);
  const anim = ae && hit === null ? "Scrab_JumpAndRunToFall" : "Scrab_Idle";
  const rgb = ae ? NE_TINT(c) : [127, 127, 127];
  const p = {
    chance: ae ? f.patrol_type_run_or_walk_chance : f.patrol_type,
    leftMin: f.left_min_delay,
    leftMax: f.left_max_delay,
    rightMin: f.right_min_delay,
    rightMax: f.right_max_delay,
  };
  return [
    draw(c, anim, x, hit ?? t.y1, {
      rgb,
      cycle: hit === null ? null : patrol(c, "scrab", p, { x, y: t.y1 }),
    }),
  ];
});

both("Paramite", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  if (ae && f.entrance_type >= 2) return []; // hidden until it drops from its web
  let x = ae ? t.x1 + 12 : t.x1;
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, ae ? planeTypes(c.half, FLOOR) : FLOOR);
  if (ae || f.enter_from_web === 1) x = snapAt(c, x);
  x += stackOffset(c);
  const patrol = ae ? f.entrance_type === 0 : f.enter_from_web === 0;
  return [
    draw(c, "Paramite_Idle", x, hit ?? t.y1, {
      rgb: [105, 105, 105],
      cycle: patrol ? brain(c, "paramite") : null,
    }),
  ];
});

// the web a paramite drops down: one segment tiled along the track line
rule("AE", "ParamiteWebLine", (c) => {
  const { t } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x1 + 20, t.y1 + 20, TRACK);
  if (!hit) return [];
  const [lx, ly1, , ly2] = hit.line;
  const camTop = Math.floor(t.y1 / c.geo.worldH) * c.geo.worldH + c.geo.winY;
  const top = Math.max(Math.min(ly1, ly2), camTop);
  const bottom = Math.min(Math.max(ly1, ly2), camTop + 240);
  const s = c.half ? 0.7 : 1;
  return [
    draw(c, "ParamiteWeb", lx, bottom, {
      scale: s,
      layer: c.half ? 5 : 24,
      rgb: c.half ? [50, 50, 200] : [10, 10, 10],
      semi: false,
      tile: { top, bottom, step: c.half ? 7 : 15 },
    }),
  ];
});

rule("AE", "Fleech", (c) => {
  const { t, f } = c;
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const spawnX = snapAt(c, t.x1);
  let x = spawnX + stackOffset(c);
  let y = hit ?? t.y1;
  let anim = f.asleep === 1 ? "Fleech_Sleeping" : "Fleech_Idle";
  let cycle = null;
  if (f.hanging === 1) {
    anim = "Fleech_SleepingWithTongue";
    x = mid(t);
    y += t.y2 - t.y1;
    cycle = brain(c, "fleechHang");
  } else if (f.asleep === 1) cycle = brain(c, "fleechSleep");
  else {
    const p = {
      goesToSleep: f.goes_to_sleep === 1,
      increaser: f.attack_anger_increaser + 2,
      range: (f.patrol_range || 0) * (c.half ? 13 : 25),
    };
    cycle = patrol(c, "fleech", p, { x: spawnX, y: t.y1 });
  }
  return [
    draw(c, anim, x, y, {
      layer: c.half ? 15 : 34,
      flip: f.start_direction === 0,
      rgb: NE_TINT(c),
      cycle,
    }),
  ];
});

rule("AE", "Slurg", (c) => {
  const { t, f } = c;
  const x = mid(t) + stackOffset({ ...c, half: false });
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const p = { delay: f.time_until_turning_around, right: f.start_direction === 1 };
  // the half-scale slurg keeps a full-size sprite on the half layer
  return [
    draw(c, "Slurg_Move", x, hit ?? t.y1, {
      scale: 1,
      layer: c.half ? 14 : 33,
      rgb: [102, 127, 118],
      cycle: patrol(c, "slurg", p, { x: mid(t), y: t.y1 }),
    }),
  ];
});

rule("AE", "Greeter", (c) => {
  const { t, f } = c;
  const s = c.half ? 0.5 : 1;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  // the three records run one brain, each reading its own part of it
  const part = (name) => patrol(c, "greeter", { part: name }, { x, y: t.y1 });
  return [
    draw(c, "Greeter_Moving", x, y, {
      layer: c.half ? 14 : 33,
      flip: f.start_direction === 0,
      cycle: part("body"),
    }),
    draw(c, "MotionDetector_Flare", x, y - 20 * s, {
      scale: s,
      layer: 36,
      rgb: [64, 0, 0],
      blend: 1,
      cycle: part("flare"),
    }),
    draw(c, "MotionDetector_Laser", x, y, { scale: s, layer: 36, blend: 1, cycle: part("laser") }),
  ];
});

rule("AO", "Bat", (c) => {
  const { t, f } = c;
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x2, t.y2, TRACK);
  if (!hit) return [];
  const p = { wait: f.ticks_before_moving, speed: f.speed / 256 };
  return [
    draw(c, "Bat", hit.line[0], hit.line[1], {
      layer: c.half ? 6 : 25,
      cycle: patrol(c, "bat", p, { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }),
    }),
  ];
});

// the flies hover about the hint's point; the hint itself waits on Abe's chant
rule("AO", "HintFly", (c) => [
  draw(c, null, c.t.x1, c.t.y1, { cycle: brain(c, "hintfly"), yOff: 0 }),
]);

// an LCD screen scrolls its messages in the game's font, by the lcd brain; one
// whose fixed message and whole random range are blank runs dark and draws
// nothing
rule("AO", "LCDScreen", lcdScreen);
rule("AE", "LCD", lcdScreen);
function lcdScreen(c) {
  const table = lcdMessages(c.data, c.path);
  if (!table || !c.font) return [];
  const { t, f } = c;
  const p = {
    x1: t.x1,
    x2: t.x2,
    y: midY(t) - 7,
    font: c.font,
    table,
    fixed1: f.message_1_id ?? 0,
    fixed2: f.message_2_id ?? null,
    sw: f.toggle_message_switch_id ?? 0,
    pool: [f.random_message_min_id ?? 0, f.random_message_max_id ?? 0],
  };
  if (lcdIds(p).every((id) => !table[id])) return [];
  const layer = c.game === "AO" ? 22 : 24;
  return [draw(c, null, t.x1, midY(t), { yOff: 0, layer, cycle: brain(c, "lcd", false, p) })];
}

// a tally board counts as a fresh game does, nobody rescued and nobody killed.
// The one object that writes a counter on loading, the Stockyards entrance's
// KillUnsavedMuds, counts its kills for a board on its own screen
const KILL_UNSAVED = 28;
const pad = (n, width, fill) => String(n).padStart(width, fill);
both("LCDStatusBoard", tallyBoard);
function tallyBoard(c) {
  const { t, f } = c;
  if (!c.font || f.hide_board) return [];
  let lines;
  if (c.game === "AO") {
    const cell = tlvCell(t, c.path, c.geo);
    const killed = c.path.tlvs.some(
      (o) => o.name === "KillUnsavedMuds" && tlvCell(o, c.path, c.geo) === cell,
    )
      ? KILL_UNSAVED
      : 0;
    lines = [AO_MUDOKONS - killed, killed, 0].map((n) => pad(n, 2, "0"));
  } else {
    const inLevel = AE_MUDOKONS_IN_LEVEL[c.lvl.id] ?? 0;
    lines = [inLevel, f.number_of_mudokons ?? 0, 0, 0].map((n) => pad(n, 3, " "));
  }
  const p = { x1: t.x1, y1: t.y1, font: c.font, lines, edge: TALLY_EDGE[c.game] };
  return [draw(c, null, t.x1, t.y1, { yOff: 0, layer: 22, cycle: brain(c, "tally", false, p) })];
}
rule("AO", "Honey", (c) => [
  draw(c, "Honey", c.t.x1 + trunc((c.t.x2 - c.t.x1) / 2), c.t.y1 + 24, {
    scale: 1,
    layer: 27,
    rgb: [128, 128, 128],
  }),
]);
rule("AO", "HoneySack", (c) => [draw(c, "HoneySack_Hanging", c.t.x1, c.t.y1, { layer: 31 })]);
