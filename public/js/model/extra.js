// A TLV's navigation bucket derived again from its archive: the builder's
// tlv_extra_ao / tlv_extra_ae over `fields` instead of payload words, exact on
// every shipped object (key order included, the display rendering extra in
// insertion order). No DOM, so it stays importable in bare Node.

const PORTAL = { 0: "travel", 1: "rescue", 2: "shrykull" };

// the builder guards each branch on the record holding its first N payload
// words; the archive names words, so a branch runs when every one of its
// `words` is named — the whole prefix, not just the words the branch reads
const inRange = (lv, top) => lv >= 1 && lv <= top;

// a destination triple, or nothing where the level id is out of range
const dest = (short, lv, pa, ca, top) =>
  inRange(lv, top) ? { to_level: short(lv), to_path: pa, to_cam: ca } : {};

// an express well's two states: the disabled destination as the way, the
// enabled one as the alternative only where it goes somewhere else
function expressWell(f, short, top, offKeys, onKeys, trigger) {
  const off = dest(short, f[offKeys[0]], f[offKeys[1]], f[offKeys[2]], top);
  const on = dest(short, f[onKeys[0]], f[onKeys[1]], f[onKeys[2]], top);
  const differs = ["to_level", "to_path", "to_cam"].some((k) => on[k] !== off[k]);
  const alt = "to_level" in on && (differs || f[onKeys[3]] !== f[offKeys[3]]);
  const e = { ...off };
  if (alt) Object.assign(e, { alt_level: on.to_level, alt_path: on.to_path, alt_cam: on.to_cam });
  if (trigger) e.trigger_id = f[trigger];
  e["well#"] = f.other_well_id;
  if ("to_level" in off) e["target_well#"] = f[offKeys[3]];
  if (alt) e["alt_target_well#"] = f[onKeys[3]];
  return e;
}

const AO_LEVELS = 15,
  AE_LEVELS = 16;
const WELL_HEAD = ["scale", "switch_id", "other_well_id"];
const WELL_BODY = [...WELL_HEAD, "animation_id", "exit_x", "exit_y"];

// per game and type: the payload words the builder's guard needs, in word
// order, and the bucket derived from them
const RULES = {
  AO: {
    Door: {
      words: ["level", "path", "camera", "scale", "door_number", "switch_id", "target_door_number"],
      derive: (f, short) => ({
        to_level: short(f.level),
        to_path: f.path,
        to_cam: f.camera,
        "door#": f.door_number & 0xffff,
        "target_door#": f.target_door_number,
      }),
    },
    PathTransition: {
      words: ["level", "path"],
      derive: (f, short) => ({ to_level: short(f.level), to_path: f.path }),
    },
    ContinuePoint: { words: ["zone_number"], derive: (f) => ({ zone: f.zone_number }) },
    MovieStone: { words: ["fmv_id"], derive: (f) => ({ movie: f.fmv_id }) },
    HandStone: {
      words: [
        "scale",
        ...[1, 2, 3].flatMap((n) => [
          `camera_${n}_level`,
          `camera_${n}_path`,
          `camera_${n}_camera`,
        ]),
      ],
      derive: (f, short) => {
        const e = {};
        for (const n of [1, 2, 3]) {
          const lv = f[`camera_${n}_level`],
            pa = f[`camera_${n}_path`],
            ca = f[`camera_${n}_camera`];
          // unused slots carry stale level ids with zeroed path/camera
          if (inRange(lv, AO_LEVELS) && pa >= 1 && ca >= 1) {
            e[`view${n}_level`] = short(lv);
            e[`view${n}_path`] = pa;
            e[`view${n}_cam`] = ca;
          }
        }
        return e;
      },
    },
    WellExpress: {
      words: [
        ...WELL_BODY,
        "off_level",
        "off_path",
        "off_camera",
        "off_other_well_id",
        "on_level",
        "on_path",
        "on_camera",
        "on_other_well_id",
      ],
      derive: (f, short) =>
        expressWell(
          f,
          short,
          AO_LEVELS,
          ["off_level", "off_path", "off_camera", "off_other_well_id"],
          ["on_level", "on_path", "on_camera", "on_other_well_id"],
          "switch_id",
        ),
    },
    WellLocal: { words: WELL_HEAD, derive: (f) => ({ "well#": f.other_well_id }) },
    BirdPortal: {
      words: [
        "enter_side",
        "level_destination",
        "path_destination",
        "camera_destination",
        "scale",
        "movie_id",
        "portal_type",
      ],
      derive: (f, short) => {
        const e = { portal: PORTAL[f.portal_type] ?? f.portal_type };
        // only a travel portal has a real destination
        if (f.portal_type === 0)
          Object.assign(e, {
            to_level: short(f.level_destination),
            to_path: f.path_destination,
            to_cam: f.camera_destination,
          });
        return e;
      },
    },
  },
  AE: {
    Door: {
      words: ["level", "path", "camera", "scale", "door_number", "switch_id", "target_door_id"],
      derive: (f, short) => ({
        to_level: short(f.level),
        to_path: f.path,
        to_cam: f.camera,
        "door#": f.door_number & 0xffff,
        "target_door#": f.target_door_id,
      }),
    },
    PathTransition: {
      words: ["level", "path"],
      derive: (f, short) => ({ to_level: short(f.level), to_path: f.path }),
    },
    WellExpress: {
      words: [
        ...WELL_BODY,
        "disabled_well_level",
        "disabled_well_path",
        "disabled_well_camera",
        "disabled_well_id",
        "enabled_well_level",
        "enabled_well_path",
        "enabled_well_camera",
        "enabled_well_id",
      ],
      derive: (f, short) =>
        expressWell(
          f,
          short,
          AE_LEVELS,
          ["disabled_well_level", "disabled_well_path", "disabled_well_camera", "disabled_well_id"],
          ["enabled_well_level", "enabled_well_path", "enabled_well_camera", "enabled_well_id"],
          null,
        ),
    },
    LocalWell: { words: WELL_HEAD, derive: (f) => ({ "well#": f.other_well_id }) },
    HandStone: {
      words: ["scale", "camera_id_1", "camera_id_2", "camera_id_3", "trigger_switch_id"],
      derive: (f) => {
        const e = {};
        for (const n of [1, 2, 3]) if (f[`camera_id_${n}`]) e[`view${n}_cam`] = f[`camera_id_${n}`];
        if (f.trigger_switch_id) e.switch_id = f.trigger_switch_id;
        return e;
      },
    },
    Teleporter: {
      words: [
        "teleporter_switch_id",
        "other_teleporter_switch_id",
        "camera",
        "path",
        "level",
        "switch_id",
      ],
      derive: (f, short) => ({
        "tp#": f.teleporter_switch_id,
        "target_tp#": f.other_teleporter_switch_id,
        ...dest(short, f.level, f.path, f.camera, AE_LEVELS),
      }),
    },
    BirdPortal: {
      words: [
        "enter_side",
        "birdportalexit_level",
        "birdportalexit_path",
        "birdportalexit_camera",
        "scale",
        "movie_id",
        "portal_type",
      ],
      derive: (f, short) => ({
        portal: PORTAL[f.portal_type] ?? f.portal_type,
        ...(f.portal_type === 0
          ? dest(
              short,
              f.birdportalexit_level,
              f.birdportalexit_path,
              f.birdportalexit_camera,
              AE_LEVELS,
            )
          : {}),
      }),
    },
    LevelLoader: {
      words: [
        "switch_id",
        "destination_level",
        "destination_path",
        "destination_camera",
        "movie_id",
      ],
      derive: (f, short) =>
        dest(short, f.destination_level, f.destination_path, f.destination_camera, AE_LEVELS),
    },
  },
};

// the navigation bucket a TLV's archive yields, `levelShort` being the
// builder's id -> short map; an id it lacks stays a number, as the builder's does
export function deriveExtra(gameId, t, levelShort) {
  const rule = RULES[gameId]?.[t.name];
  const f = t.fields;
  if (!rule || !f || !rule.words.every((w) => w in f)) return {};
  return rule.derive(f, (lv) => levelShort[String(lv)] ?? lv);
}
