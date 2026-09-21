import {
  SEGMENT_LENGTH,
  RUMBLE_LENGTH,
  ROAD_COLORS,
  SCENERY,
  TRAFFIC,
  TRAFFIC_COUNT,
  MAX_SPEED,
  WEAPON_USES
} from './constants.js';
import { mulberry32, easeIn, easeInOut, randInt, randChoice, wrap } from './util.js';

const ROAD = {
  LENGTH: { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 },
  HILL: { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 },
  CURVE: { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 }
};

const TARGET_SEGMENTS = 2800;

class TrackBuilder {
  constructor(rng) {
    this.rng = rng;
    this.segments = [];
  }

  lastY() {
    const n = this.segments.length;
    return n === 0 ? 0 : this.segments[n - 1].p2.world.y;
  }

  addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: { world: { x: 0, y: this.lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
      p2: { world: { x: 0, y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
      curve,
      scenery: [],
      pickups: [],
      color: Math.floor(n / RUMBLE_LENGTH) % 2 ? ROAD_COLORS.DARK : ROAD_COLORS.LIGHT
    });
  }

  addRoad(enter, hold, leave, curve, y) {
    const startY = this.lastY();
    const endY = startY + y * SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) {
      this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    }
  }

  addStraight(num = ROAD.LENGTH.MEDIUM) {
    this.addRoad(num, num, num, 0, 0);
  }

  addCurve(num = ROAD.LENGTH.MEDIUM, curve = ROAD.CURVE.MEDIUM, height = ROAD.HILL.NONE) {
    this.addRoad(num, num, num, curve, height);
  }

  addHill(num = ROAD.LENGTH.MEDIUM, height = ROAD.HILL.MEDIUM) {
    this.addRoad(num, num, num, 0, height);
  }

  addLowRollingHills(num = ROAD.LENGTH.SHORT, height = ROAD.HILL.LOW) {
    this.addRoad(num, num, num, 0, height / 2);
    this.addRoad(num, num, num, 0, -height);
    this.addRoad(num, num, num, ROAD.CURVE.EASY, height);
    this.addRoad(num, num, num, 0, 0);
    this.addRoad(num, num, num, -ROAD.CURVE.EASY, height / 2);
    this.addRoad(num, num, num, 0, 0);
  }

  addSCurves() {
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.NONE);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.EASY, -ROAD.HILL.LOW);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.MEDIUM);
    this.addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
  }

  addDownhillToEnd(num = 200) {
    this.addRoad(num, num, num, -ROAD.CURVE.EASY, -this.lastY() / SEGMENT_LENGTH);
  }
}

function buildLayout(builder) {
  const rng = builder.rng;
  builder.addStraight(ROAD.LENGTH.SHORT); // grid + launch straight
  builder.addLowRollingHills();

  while (builder.segments.length < TARGET_SEGMENTS) {
    const pick = randInt(rng, 0, 8);
    const dir = rng() < 0.5 ? -1 : 1;
    switch (pick) {
      case 0:
        builder.addStraight(randChoice(rng, [ROAD.LENGTH.SHORT, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.LONG]));
        break;
      case 1:
        builder.addSCurves();
        break;
      case 2:
        builder.addCurve(ROAD.LENGTH.MEDIUM, dir * ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
        break;
      case 3:
        builder.addCurve(ROAD.LENGTH.LONG, dir * ROAD.CURVE.EASY, -ROAD.HILL.LOW);
        break;
      case 4:
        builder.addHill(ROAD.LENGTH.MEDIUM, randChoice(rng, [ROAD.HILL.LOW, ROAD.HILL.MEDIUM, ROAD.HILL.HIGH]) * dir);
        break;
      case 5:
        builder.addLowRollingHills();
        break;
      case 6:
        builder.addCurve(ROAD.LENGTH.SHORT, dir * ROAD.CURVE.HARD, ROAD.HILL.MEDIUM * dir);
        break;
      case 7:
        builder.addCurve(ROAD.LENGTH.MEDIUM, dir * ROAD.CURVE.HARD, ROAD.HILL.NONE);
        break;
      default:
        builder.addStraight(ROAD.LENGTH.MEDIUM);
    }
  }

  builder.addDownhillToEnd(200);
  builder.addStraight(ROAD.LENGTH.LONG); // run-off after the finish banner
}

function paintStartAndFinish(segments, finishIndex) {
  for (let n = 0; n < RUMBLE_LENGTH * 2; n++) segments[n].color = ROAD_COLORS.START;
  for (let n = 0; n < RUMBLE_LENGTH * 2; n++) {
    const idx = finishIndex - n;
    if (idx >= 0) segments[idx].color = ROAD_COLORS.FINISH;
  }
}

function addScenery(segments, rng) {
  const heavy = [SCENERY.TREE, SCENERY.PALM, SCENERY.BOULDER, SCENERY.POLE, SCENERY.BILLBOARD];
  const light = [SCENERY.BUSH, SCENERY.BARREL];

  for (let n = 12; n < segments.length; n++) {
    // dense roadside props
    if (n % 4 === 0 || rng() < 0.22) {
      const side = rng() < 0.5 ? -1 : 1;
      const type = rng() < 0.75 ? randChoice(rng, heavy) : randChoice(rng, light);
      const offset = side * (1.25 + rng() * 2.6);
      segments[n].scenery.push({ type, offset, solid: heavy.includes(type) });
    }
    // far background filler
    if (rng() < 0.16) {
      const side = rng() < 0.5 ? -1 : 1;
      segments[n].scenery.push({
        type: rng() < 0.6 ? SCENERY.TREE : SCENERY.PALM,
        offset: side * (3.4 + rng() * 4),
        solid: false
      });
    }
  }
}

function buildTraffic(segments, rng, trackLength) {
  const traffic = [];
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const oncoming = rng() < 0.15;
    const type = randChoice(rng, [TRAFFIC.CAR, TRAFFIC.CAR, TRAFFIC.VAN, TRAFFIC.TRUCK, TRAFFIC.BUS]);
    const lane = oncoming ? -0.95 + rng() * 0.3 : -0.55 + rng() * 1.35;
    const base = oncoming ? 0.42 : 0.3;
    traffic.push({
      id: i,
      type,
      oncoming,
      x: lane,
      z0: rng() * trackLength,
      speed: (oncoming ? -1 : 1) * MAX_SPEED * (base + rng() * 0.22),
      sway: rng() * Math.PI * 2
    });
  }
  return traffic;
}

function buildPickups(segments, rng, raceDistance) {
  const pickups = [];
  const count = Math.max(8, Math.floor(raceDistance / 60000));
  for (let i = 0; i < count; i++) {
    const z = (0.05 + (i + rng() * 0.6) / count * 0.9) * raceDistance;
    pickups.push({
      id: i,
      z: Math.min(z, raceDistance - 4000),
      x: -0.75 + rng() * 1.5,
      uses: WEAPON_USES,
      taken: false,
      respawnAt: 0
    });
  }
  return pickups;
}

/**
 * Builds the full course. Identical seed -> byte-identical track on server and client.
 */
export function createTrack(seed) {
  const rng = mulberry32(seed);
  const builder = new TrackBuilder(rng);
  buildLayout(builder);

  const segments = builder.segments;
  const trackLength = segments.length * SEGMENT_LENGTH;
  const finishIndex = segments.length - ROAD.LENGTH.LONG * 3 - 1;
  const raceDistance = finishIndex * SEGMENT_LENGTH;

  paintStartAndFinish(segments, finishIndex);
  addScenery(segments, rng);

  const track = {
    seed,
    segments,
    trackLength,
    finishIndex,
    raceDistance,
    traffic: buildTraffic(segments, rng, trackLength),
    pickups: buildPickups(segments, rng, raceDistance)
  };

  for (const p of track.pickups) {
    const seg = segmentAt(track, p.z);
    seg.pickups.push(p);
  }

  return track;
}

export function segmentAt(track, z) {
  const idx = Math.floor(wrap(z, track.trackLength) / SEGMENT_LENGTH) % track.segments.length;
  return track.segments[idx];
}

export function trafficZ(car, time, trackLength) {
  return wrap(car.z0 + car.speed * time, trackLength);
}

export function trafficX(car, time) {
  return car.x + Math.sin(car.sway + time * 0.35) * 0.06;
}
