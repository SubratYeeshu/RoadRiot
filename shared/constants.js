// Tuning values shared by the authoritative server simulation and the browser client.
// Both sides import this file so client-side prediction matches the server exactly.

export const MAX_PLAYERS = 8;
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const SNAPSHOT_EVERY = 3; // ticks -> 20 snapshots/sec
export const INPUT_SEND_MS = 33; // ~30 input packets/sec
export const INTERP_DELAY_MS = 110;

// ---------------------------------------------------------------- road geometry
export const SEGMENT_LENGTH = 200;
export const RUMBLE_LENGTH = 3;
export const ROAD_WIDTH = 2000;
export const LANES = 3;
export const DRAW_DISTANCE = 260;
export const FIELD_OF_VIEW = 100;
export const CAMERA_HEIGHT = 1150;
export const FOG_DENSITY = 4.5;

// ---------------------------------------------------------------- bike handling
export const MAX_SPEED = SEGMENT_LENGTH * TICK_HZ; // 12000 units/sec
export const ACCEL = MAX_SPEED / 5.2;
export const BRAKING = -MAX_SPEED / 1.35;
export const COAST_DECEL = -MAX_SPEED / 7;
export const OFF_ROAD_DECEL = -MAX_SPEED / 1.8;
export const OFF_ROAD_LIMIT = MAX_SPEED / 3.6;
export const CENTRIFUGAL = 0.34;
export const STEER_RATE = 2.3;
export const KPH_PER_UNIT = 1 / 50; // speedometer scaling only

// ---------------------------------------------------------------- nitro
export const NITRO_MAX = 2.4;
export const NITRO_REGEN = 0.2;
export const NITRO_BOOST = 1.3;

// ---------------------------------------------------------------- combat
export const MAX_HEALTH = 100;
export const RESPAWN_HEALTH = 65;
export const ATTACK_REACH_Z = 950;
export const ATTACK_REACH_X = 0.66;
export const PUNCH_DAMAGE = 13;
export const KICK_DAMAGE = 20;
export const CLUB_DAMAGE = 34;
export const PUNCH_COOLDOWN = 0.42;
export const KICK_COOLDOWN = 0.75;
export const ATTACK_ANIM = 0.3;
export const CRASH_TIME = 3.4;
export const INVULN_TIME = 2;
export const WEAPON_USES = 12;
export const WEAPON_RESPAWN = 18;
export const WEAPON_PICKUP_Z = 500;
export const WEAPON_PICKUP_X = 0.3;

// attack kinds
export const ATK_NONE = 0;
export const ATK_PUNCH = 1;
export const ATK_KICK = 2;
export const ATK_CLUB = 3;

// ---------------------------------------------------------------- hazards
export const TRAFFIC_COUNT = 30;
export const TRAFFIC_HIT_Z = 430;
export const TRAFFIC_HIT_X = 0.46;
export const HIT_COOLDOWN = 0.9;
export const SCENERY_HIT_X = 1.18; // beyond this the shoulder gets deadly

// ---------------------------------------------------------------- race flow
export const COUNTDOWN_TIME = 5;
export const RESULTS_TIME = 16;
export const FINISH_GRACE = 45;
export const MAX_RACE_TIME = 240;
export const START_SPACING_Z = 420;

// ---------------------------------------------------------------- presentation
export const RIDER_COLORS = [
  { name: 'Crimson', body: '#e03a42', trim: '#ffd3d6', suit: '#2b2f36' },
  { name: 'Azure', body: '#2f83e0', trim: '#cfe6ff', suit: '#1d2230' },
  { name: 'Lime', body: '#5fc236', trim: '#e0ffcd', suit: '#26301f' },
  { name: 'Amber', body: '#f0a022', trim: '#ffe6b8', suit: '#332616' },
  { name: 'Violet', body: '#9a54e0', trim: '#ecd7ff', suit: '#291b33' },
  { name: 'Teal', body: '#1fb8ae', trim: '#d0fffb', suit: '#16302e' },
  { name: 'Bone', body: '#ded8c8', trim: '#ffffff', suit: '#3a382f' },
  { name: 'Coal', body: '#454b55', trim: '#aab4c0', suit: '#1b1e23' }
];

export const ROAD_COLORS = {
  LIGHT: { road: '#6e6e72', grass: '#3f7a2f', rumble: '#d5d5da', lane: '#f2f2f2' },
  DARK: { road: '#68686c', grass: '#38702a', rumble: '#bd3a3a', lane: null },
  START: { road: '#f2f2f2', grass: '#3f7a2f', rumble: '#f2f2f2', lane: null },
  FINISH: { road: '#1b1b1f', grass: '#3f7a2f', rumble: '#1b1b1f', lane: null }
};

// scenery sprite ids
export const SCENERY = {
  TREE: 0,
  PALM: 1,
  BOULDER: 2,
  BILLBOARD: 3,
  BUSH: 4,
  POLE: 5,
  BARREL: 6
};

// traffic sprite ids
export const TRAFFIC = {
  CAR: 0,
  VAN: 1,
  TRUCK: 2,
  BUS: 3
};
