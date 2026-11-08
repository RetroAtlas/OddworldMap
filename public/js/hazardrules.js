import { raycastDiag, raycastDown } from "./collide.js";
import {
  FLOOR,
  TRACK,
  planeTypes,
  snapAt,
  trunc,
  mid,
  AO_STOCKYARDS,
  AO_YARDS_TINT,
  NE_TINT,
  brain,
  patrol,
  draw,
  tint,
  rule,
  both,
} from "./spritekit.js";

// ---- hazards and machines -------------------------------------------------

rule("AE", "Mine", (c) => {
  const { t } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  const layer = c.half ? 16 : 35;
  return [
    draw(c, "Mine_Flash", x, y, { layer, rgb: [128, 128, 128] }),
    draw(c, "Mine", x, y, { layer }),
  ];
});
rule("AO", "Mine", (c) => {
  const { t } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const layer = c.half ? 16 : 35;
  const rgb = AO_YARDS_TINT(c, [50, 50, 50], [105, 105, 105]);
  return [
    draw(c, "Mine_Flash", x, y, { layer, rgb: [128, 128, 128] }),
    draw(c, "Mine", x, y, { layer, rgb }),
  ];
});

function uxbCycle(f) {
  let len = f.pattern_length;
  if (!(len >= 1 && len <= 4)) len = 1;
  let pattern = f.pattern || 11111;
  const digits = [];
  for (let i = 0; i < len; i++) digits.push(Math.floor(pattern / 10 ** (len - 1 - i)) % 10);
  return { kind: "uxb", digits };
}
rule("AE", "UXB", (c) => {
  const { t, f } = c;
  const x = mid(t);
  const hit = raycastDown(c.lines, x, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  const y = hit ?? t.y1;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  const rgb = NE_TINT(c);
  const off = f.start_state === 1;
  return [
    draw(c, off ? "Bomb_RedGreenTick@GreenFlash" : "Bomb_RedGreenTick", x, y - trunc(s * 17), {
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      cycle: off ? null : uxbCycle(f),
    }),
    draw(c, off ? "UXB_Disabled" : "UXB_Active", x, y, { layer, rgb }),
  ];
});
rule("AO", "UXB", (c) => {
  const { t, f } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  const rgb = AO_YARDS_TINT(c, [80, 90, 110], [105, 105, 105]);
  const off = f.start_state === 1;
  return [
    draw(c, off ? "Bomb_RedGreenTick@GreenFlash" : "Bomb_RedGreenTick", x, y - trunc(s * 12), {
      yOff: 0,
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      cycle: off ? null : uxbCycle(f),
    }),
    draw(c, off ? "UXB_Disabled" : "UXB_Active", x, y, { layer, rgb }),
  ];
});

rule("AO", "TimedMine", (c) => {
  const { t } = c;
  const x = t.x1 + 12,
    y = t.y1 + 24;
  const s = c.half ? 0.5 : 1;
  const layer = c.half ? 16 : 35;
  return [
    draw(c, "Bomb_RedGreenTick", x, y - trunc(s * 14), {
      layer,
      rgb: [128, 128, 128],
      blend: 1,
      yOff: 0,
    }),
    draw(c, "TimedMine_Idle", x, y, { layer, rgb: [105, 105, 105] }),
  ];
});

const AE_BOMB_TINT = { BA: [97, 97, 97] };
const AO_BOMB_TINT = { E1: [30, 30, 55], E2: [30, 30, 55] };
both("MovingBomb", (c) => {
  const { t, f } = c;
  if (f.triggered_by_alarm === 1) return []; // hidden until the alarm
  const hit = raycastDiag(c.lines, t.x1, t.y1, t.x1 + 24, t.y1 + 24, TRACK);
  const x = hit ? hit.x : t.x1,
    y = hit ? hit.y : t.y1;
  const rgb =
    c.game === "AE"
      ? tint(AE_BOMB_TINT, c.lvl.short, [127, 127, 127])
      : tint(AO_BOMB_TINT, c.lvl.short, [127, 127, 127]);
  // only a bomb whose switch is the always-on id 1 sets off at a fresh start
  const switchId = f.start_moving_switch_id ?? f.switch_id;
  const p = { speed: f.speed / 256, startSpeed: f.start_speed / 256, switchId };
  return [
    draw(c, "MovingBomb", x, y, {
      yOff: 0,
      layer: c.half ? 16 : 35,
      rgb,
      cycle: switchId === 1 ? patrol(c, "bomb", p, { x: t.x1, y: t.y1 }) : null,
    }),
  ];
});

both("ElectricWall", (c) => {
  const { t, f } = c;
  if (f.start_state !== 1) return []; // off until its switch flips
  return [
    draw(c, "Electric_Wall", t.x1, t.y1, {
      layer: 36,
      rgb: [80, 80, 80],
      blend: 1,
      cycle: { kind: "flip8" },
    }),
  ];
});

rule("AO", "MeatSaw", (c) => {
  const { t, f } = c;
  const x = t.x1 + 8;
  const rise = f.max_rise_time || 0;
  const layer = c.half ? 5 : 24;
  const p = {
    type: f.type,
    start: f.start_state,
    speed: f.speed,
    offSpeed: f.off_speed,
    maxRise: rise,
    switchMin: f.switch_min_time_off,
    switchMax: f.switch_max_time_off,
    autoMin: f.automatic_min_time_off,
    autoMax: f.automatic_max_time_off,
    initial: f.initial_position === 1,
    switchId: f.switch_id,
  };
  return [
    draw(c, "MeatSaw_Idle", x, t.y1 - rise, {
      layer,
      cycle: brain(c, "meatsaw", false, p),
      yOff: 0,
    }),
    draw(c, "MeatSawMotor", x, t.y1, { layer, semi: true, yOff: 0 }),
  ];
});

// the drill's stroke is the brain's: the record stands at the base of its travel
rule("AE", "Drill", (c) => {
  const { t, f } = c;
  const dir = f.start_direction;
  const vertical = dir === 0;
  const p = {
    behavior: f.behavior,
    startOn: f.start_state_on === 1,
    speed: f.speed === 250 ? 0.2 : f.speed,
    offSpeed: f.off_speed === 250 ? 0.2 : f.off_speed,
    minOff: f.min_off_time,
    maxOff: f.max_off_time,
    minOffChange: f.min_off_time_speed_change,
    maxOffChange: f.max_off_time_speed_change,
    startBottom: f.start_position_bottom === 1,
    direction: dir,
    width: vertical ? t.y2 - t.y1 : t.x2 - t.x1,
    switchId: f.switch_id,
  };
  return [
    draw(
      c,
      vertical ? "Drill_Vertical_Off" : "Drill_Horizontal_Off",
      dir === 2 ? t.x2 - 12 : t.x1 + 12,
      t.y2,
      {
        layer: c.half ? 5 : 24,
        rgb: NE_TINT(c),
        flip: dir === 2,
        cycle: brain(c, "drill", false, p),
      },
    ),
  ];
});

// the detector's flare where the device sits and the laser sweeping the rect
both("MotionDetector", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const s = c.half ? 0.5 : 1;
  const out = [];
  if (f.draw_flare === 1) {
    let fx, fy;
    if (ae) {
      const abe = c.abeStart || [0, 0];
      [fx, fy] = f.device_x ? [f.device_x - abe[0], f.device_y - abe[1]] : [t.x1, t.y1];
    } else [fx, fy] = [f.device_x + 11, f.device_y];
    out.push(
      draw(c, "MotionDetector_Flare", fx, fy, {
        yOff: 0,
        scale: s,
        layer: 36,
        rgb: [64, 0, 0],
        blend: 1,
        swap: !ae,
      }),
    );
  }
  const speed = (f.speed || 0) / 256;
  const left = f.initial_move_direction === 1;
  out.push(
    draw(c, "MotionDetector_Laser", left ? t.x2 : t.x1, t.y2, {
      yOff: 0,
      scale: s,
      layer: 36,
      blend: 1,
      cycle: speed > 0 && t.x2 > t.x1 ? { kind: "laser", x1: t.x1, x2: t.x2, speed, left } : null,
    }),
  );
  return out;
});

const AE_ORB_TINT = { NE: [137, 137, 137] };
const securityOrbAE = (c) => [
  draw(c, "Security_Orb", c.t.x1, c.t.y1, { rgb: tint(AE_ORB_TINT, c.lvl.short, [127, 127, 127]) }),
];
rule("AE", "SecurityOrb", securityOrbAE);
rule("AE", "SecurityClaw", securityOrbAE);
rule("AO", "SecurityOrb", (c) => [draw(c, "Security_Orb", c.t.x1, c.t.y1, { layer: 27 })]);
rule("AO", "SecurityClaw", (c) => {
  const { t } = c;
  const s = c.half ? 0.5 : 1;
  const yards = AO_STOCKYARDS.has(c.lvl.short);
  return [
    draw(c, "Security_Claw_Lower_Idle", t.x1, t.y1, {
      layer: c.half ? 9 : 28,
      rgb: yards ? [80, 55, 55] : [127, 127, 127],
    }),
    draw(c, "Security_Claw_Upper_Rotating", t.x1, t.y1 + 8 * s, {
      layer: 27,
      rgb: yards ? [105, 55, 55] : [127, 127, 127],
    }),
  ];
});

const ZBALL_SPEED = ["Normal", "Fast", "Slow"];
const ZBALL_START = [6, 0, 13];
rule("AO", "ZBall", (c) => {
  if (c.lvl.short !== "F2") return [];
  const { t, f } = c;
  return [
    draw(c, `Swinging_Ball_${ZBALL_SPEED[f.speed] || "Normal"}`, t.x1, t.y1, {
      layer: 27,
      rgb: [128, 128, 128],
      frame: ZBALL_START[f.start_position] ?? 0,
    }),
  ];
});

both("BoomMachine", (c) => {
  const { t, f } = c;
  const ae = c.game === "AE";
  const s = c.half ? 0.5 : 1;
  const x = t.x1 + (c.half ? 6.5 : 12.5);
  const y = t.y1;
  const left = f.nozzle_side === 1;
  const rgb = ae ? [127, 127, 127] : [105, 105, 105];
  return [
    draw(c, "BoomMachine_Pipe_Idle", x + (left ? -1 : 1) * 30 * s, y - 30 * s, {
      scale: s,
      layer: 27,
      rgb,
      semi: false,
      flip: left,
    }),
    draw(c, "BoomMachine_Button_On", x, y, { scale: s, layer: 27, rgb, blend: 1, yOff: 0 }),
  ];
});

rule("AE", "BrewMachine", (c) => [
  draw(c, "BrewMachine_Button", mid(c.t), c.t.y1, { scale: 1, layer: 23 }),
]);

const AO_FLINTLOCK = new Set(["L1", "F2", "D2"]);
rule("AO", "FlintLockFire", (c) => {
  if (!AO_FLINTLOCK.has(c.lvl.short)) return [];
  const { t } = c;
  const layer = c.half ? 6 : 25;
  return [
    draw(c, "FlintLock_Hammers_Disabled", t.x1, t.y1, { layer }),
    draw(c, "FlintLock_Gourd", t.x1, t.y1, { layer, frozen: true }),
  ];
});

rule("AO", "RollingBall", (c) => {
  const { t, f } = c;
  const hit = raycastDown(c.lines, t.x1, t.y1, t.y1 + 24, planeTypes(c.half, FLOOR));
  return [
    draw(c, "Stone_Ball", snapAt(c, t.x1), hit ?? t.y1, {
      layer: c.half ? 12 : 31,
      flip: f.roll_direction === 0,
    }),
  ];
});
rule("AO", "RollingBallStopper", (c) => [
  draw(c, "Stone_Ball_Stopper", c.t.x1, c.t.y1, { layer: 37, flip: c.f.direction === 0 }),
]);

// an Oddysee light effect is one of the door lights; the star draws nothing
const AO_LIGHT = {
  1: "GoldGlow",
  2: "GreenGlow",
  3: "FlintGlow",
  4: "RedDoorLight",
  5: "RedHubLight",
};
rule("AO", "LightEffect", (c) => {
  const { t, f } = c;
  const anim = AO_LIGHT[f.type];
  if (!anim) return [];
  const flip = f.direction === 0;
  const xoff = f.type === 4 ? 6 : 0;
  // the sheet at the pulse's peak; the pulse itself is the additive pass's alpha.
  // The flint glow is the switchable light, red until its switch is thrown
  return [
    draw(c, anim, t.x1 + (flip ? -xoff : xoff), t.y1, {
      scale: 1,
      layer: 17,
      flip,
      blend: 3,
      rgb: f.type === 3 ? [255, 32, 32] : [255, 255, 255],
      cycle: { kind: "pulse" },
    }),
  ];
});

const AE_BG_LAYER = { 0: 1, 1: 20, 2: 39 };
both("BackgroundAnimation", (c) => {
  const { t, f } = c;
  if (!f.animation_id) return [];
  const ae = c.game === "AE";
  return [
    draw(c, `bg:${f.animation_id}`, t.x1, t.y1, {
      yOff: 0,
      scale: 1,
      layer: ae ? (AE_BG_LAYER[f.layer] ?? 27) : 1,
      semi: f.is_semi_trans === 1,
      blend: f.semi_trans_mode || 0,
    }),
  ];
});
