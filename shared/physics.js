import {
  ACCEL,
  ATK_CLUB,
  ATK_KICK,
  ATK_NONE,
  ATK_PUNCH,
  ATTACK_ANIM,
  BRAKING,
  CENTRIFUGAL,
  COAST_DECEL,
  CLUB_DAMAGE,
  CRASH_TIME,
  HIT_COOLDOWN,
  INVULN_TIME,
  KICK_COOLDOWN,
  KICK_DAMAGE,
  MAX_HEALTH,
  MAX_SPEED,
  NITRO_BOOST,
  NITRO_MAX,
  NITRO_REGEN,
  OFF_ROAD_DECEL,
  OFF_ROAD_LIMIT,
  PUNCH_COOLDOWN,
  PUNCH_DAMAGE,
  RESPAWN_HEALTH,
  SCENERY_HIT_X,
  START_SPACING_Z,
  STEER_RATE,
  TRAFFIC_HIT_X,
  TRAFFIC_HIT_Z
} from './constants.js';
import { clamp, deltaZ, wrap } from './util.js';
import { segmentAt, trafficX, trafficZ } from './track.js';

export function neutralInput() {
  return { seq: 0, steer: 0, accel: 0, brake: 0, nitro: 0, atk: ATK_NONE };
}

/** Never trust the wire: coerce and clamp everything coming from a client. */
export function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return neutralInput();
  const seq = Number(raw.seq);
  const steer = Number(raw.steer);
  const atk = Number(raw.atk);
  return {
    seq: Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : 0,
    steer: Number.isFinite(steer) ? clamp(steer, -1, 1) : 0,
    accel: raw.accel ? 1 : 0,
    brake: raw.brake ? 1 : 0,
    nitro: raw.nitro ? 1 : 0,
    atk: atk === ATK_PUNCH || atk === ATK_KICK ? atk : ATK_NONE
  };
}

export function createRider({ id, index, name, colorIndex }) {
  const rider = {
    id,
    index,
    name,
    colorIndex,
    bot: false,
    ready: false,
    connected: true,
    wins: 0
  };
  resetRider(rider, index, null);
  return rider;
}

export function resetRider(r, index, track) {
  const row = Math.floor(index / 4);
  const col = index % 4;
  r.startZ = track ? wrap(-row * START_SPACING_Z, track.trackLength) : 0;
  r.startOffsetZ = -row * START_SPACING_Z;
  r.x = -0.66 + col * 0.44 + (row ? 0.1 : -0.1);
  r.progress = 0;
  r.z = r.startZ;
  r.speed = 0;
  r.health = MAX_HEALTH;
  r.nitro = NITRO_MAX;
  r.weapon = 0;
  r.weaponUses = 0;
  r.attack = ATK_NONE;
  r.attackTimer = 0;
  r.attackCooldown = 0;
  r.attackSide = 1;
  r.crashTimer = 0;
  r.invuln = 0;
  r.hitCooldown = 0;
  r.wobble = 0;
  r.lean = 0;
  r.place = index + 1;
  r.finished = false;
  r.finishTime = 0;
  r.lastSeq = 0;
  r.takedowns = 0;
}

export function crashRider(r, reason, events) {
  if (r.crashTimer > 0 || r.finished) return false;
  r.crashTimer = CRASH_TIME;
  r.health = 0;
  r.attack = ATK_NONE;
  r.attackTimer = 0;
  r.weapon = 0;
  r.weaponUses = 0;
  r.wobble = 0;
  r.speed *= 0.25;
  if (events) events.push({ type: 'crash', target: r.index, reason });
  return true;
}

export function damageRider(r, amount, reason, events) {
  if (r.crashTimer > 0 || r.finished || r.invuln > 0) return false;
  r.health -= amount;
  r.wobble += amount * 0.012 * (Math.sin(r.progress * 0.013 + r.index) >= 0 ? 1 : -1);
  r.speed *= 1 - Math.min(0.28, amount * 0.006);
  if (events) events.push({ type: 'hit', target: r.index, amount, reason });
  if (r.health <= 0) crashRider(r, reason, events);
  return true;
}

export function attackDamage(kind, hasClub) {
  if (hasClub) return CLUB_DAMAGE;
  return kind === ATK_KICK ? KICK_DAMAGE : PUNCH_DAMAGE;
}

export function attackCooldown(kind) {
  return kind === ATK_KICK ? KICK_COOLDOWN : PUNCH_COOLDOWN;
}

function collideTraffic(r, track, time, dt, events) {
  if (r.hitCooldown > 0 || r.crashTimer > 0) return;
  for (const car of track.traffic) {
    const cz = trafficZ(car, time, track.trackLength);
    const dz = deltaZ(r.z, cz, track.trackLength);
    if (Math.abs(dz) > TRAFFIC_HIT_Z) continue;
    const cx = trafficX(car, time);
    if (Math.abs(cx - r.x) > TRAFFIC_HIT_X) continue;

    const closing = car.oncoming ? r.speed + Math.abs(car.speed) : Math.abs(r.speed - car.speed);
    r.hitCooldown = HIT_COOLDOWN;
    r.x += (r.x < cx ? -1 : 1) * 0.22;
    if (car.oncoming || closing > MAX_SPEED * 0.66) {
      r.speed *= 0.2;
      crashRider(r, 'traffic', events);
    } else {
      r.speed = Math.min(r.speed, Math.abs(car.speed) * 0.7);
      damageRider(r, 14, 'traffic', events);
    }
    return;
  }
}

function collideScenery(r, seg, events) {
  if (r.crashTimer > 0 || Math.abs(r.x) < SCENERY_HIT_X) return;
  for (const prop of seg.scenery) {
    if (!prop.solid) continue;
    if (Math.abs(prop.offset - r.x) < 0.38 && r.speed > MAX_SPEED * 0.12) {
      r.speed *= 0.15;
      crashRider(r, 'scenery', events);
      return;
    }
  }
}

/**
 * Advances one rider by `dt`. Pure and deterministic given (rider, input, track, time),
 * which is what lets the browser predict locally and reconcile against the server.
 */
export function stepRider(r, input, track, dt, time, events) {
  r.hitCooldown = Math.max(0, r.hitCooldown - dt);
  r.invuln = Math.max(0, r.invuln - dt);
  r.attackCooldown = Math.max(0, r.attackCooldown - dt);
  r.attackTimer = Math.max(0, r.attackTimer - dt);
  if (r.attackTimer === 0 && r.attack !== ATK_NONE) r.attack = ATK_NONE;

  if (r.crashTimer > 0) {
    r.crashTimer = Math.max(0, r.crashTimer - dt);
    r.speed = Math.max(0, r.speed + COAST_DECEL * 2.4 * dt);
    r.lean = 0;
    r.wobble = 0;
    if (r.crashTimer === 0) {
      r.health = RESPAWN_HEALTH;
      r.invuln = INVULN_TIME;
      r.x = clamp(r.x, -0.78, 0.78);
      r.speed = MAX_SPEED * 0.2;
    }
    advancePosition(r, track, dt);
    return;
  }

  const seg = segmentAt(track, r.z);
  const speedPercent = r.speed / MAX_SPEED;
  const steerStep = dt * STEER_RATE * Math.min(1, speedPercent + 0.15);

  let topSpeed = MAX_SPEED;
  let accel = ACCEL;
  const wantsNitro = !!input.nitro && r.nitro > 0 && !!input.accel && !r.finished && r.speed > MAX_SPEED * 0.25;
  if (wantsNitro) {
    r.nitro = Math.max(0, r.nitro - dt);
    topSpeed = MAX_SPEED * NITRO_BOOST;
    accel = ACCEL * 2.1;
  } else {
    r.nitro = Math.min(NITRO_MAX, r.nitro + NITRO_REGEN * dt);
  }
  r.boosting = wantsNitro ? 1 : 0;

  if (r.finished) {
    r.speed += COAST_DECEL * 1.5 * dt;
  } else if (input.brake) {
    r.speed += BRAKING * dt;
  } else if (input.accel) {
    r.speed += (r.speed > topSpeed ? COAST_DECEL * 2 : accel) * dt;
  } else {
    r.speed += COAST_DECEL * dt;
  }

  // steering (wobble from punches fights the rider for a moment)
  r.wobble *= Math.max(0, 1 - dt * 1.6);
  if (Math.abs(r.wobble) < 0.002) r.wobble = 0;
  const steer = r.finished ? 0 : clamp(input.steer + r.wobble * 3, -1, 1);
  r.lean = steer;
  r.x += steerStep * steer;
  r.x -= steerStep * speedPercent * seg.curve * CENTRIFUGAL;

  // shoulder / dirt
  const offRoad = Math.abs(r.x) > 1;
  if (offRoad) {
    if (r.speed > OFF_ROAD_LIMIT) r.speed += OFF_ROAD_DECEL * dt;
    r.x += (r.x > 0 ? -1 : 1) * dt * 0.1;
    collideScenery(r, seg, events);
  }

  r.x = clamp(r.x, -2.1, 2.1);
  r.speed = clamp(r.speed, 0, MAX_SPEED * NITRO_BOOST);

  advancePosition(r, track, dt);
  collideTraffic(r, track, time, dt, events);

  if (!r.finished && r.progress >= track.raceDistance) {
    r.finished = true;
    r.finishTime = time;
    if (events) events.push({ type: 'finish', target: r.index });
  }
}

function advancePosition(r, track, dt) {
  r.progress += r.speed * dt;
  r.z = wrap(r.startZ + r.progress, track.trackLength);
}

/** Bike-to-bike shoving so packs jostle instead of ghosting through each other. */
export function separateRiders(a, b, track, dt) {
  const dz = deltaZ(a.z, b.z, track.trackLength);
  if (Math.abs(dz) > 260) return;
  const dx = b.x - a.x;
  if (Math.abs(dx) > 0.24) return;
  const push = (0.24 - Math.abs(dx)) * dt * 3.2;
  const dir = dx === 0 ? (a.index < b.index ? -1 : 1) : Math.sign(dx);
  a.x -= dir * push;
  b.x += dir * push;
  const avg = (a.speed + b.speed) / 2;
  a.speed = a.speed * 0.985 + avg * 0.015;
  b.speed = b.speed * 0.985 + avg * 0.015;
}

export const ATTACK_ANIM_TIME = ATTACK_ANIM;
export const ATK = { NONE: ATK_NONE, PUNCH: ATK_PUNCH, KICK: ATK_KICK, CLUB: ATK_CLUB };
export const HEALTH_MAX = MAX_HEALTH;
