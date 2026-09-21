// Compact array-based snapshot encoding shared by server and client so the two
// never disagree about field ordering.

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function encodeRider(r) {
  return [
    r.index,
    r1(r.z),
    r3(r.x),
    r1(r.speed),
    r1(r.health),
    r3(r.nitro),
    r3(r.crashTimer),
    r3(r.invuln),
    r.attack | 0,
    r3(r.attackTimer),
    r.attackSide | 0,
    r.weapon | 0,
    r.weaponUses | 0,
    r.place | 0,
    r.finished ? 1 : 0,
    r3(r.finishTime),
    r.lastSeq | 0,
    r1(r.progress),
    r3(r.wobble),
    r.boosting ? 1 : 0,
    r3(r.lean),
    r.takedowns | 0
  ];
}

export function decodeRider(a, target) {
  const r = target || {};
  r.index = a[0];
  r.z = a[1];
  r.x = a[2];
  r.speed = a[3];
  r.health = a[4];
  r.nitro = a[5];
  r.crashTimer = a[6];
  r.invuln = a[7];
  r.attack = a[8];
  r.attackTimer = a[9];
  r.attackSide = a[10];
  r.weapon = a[11];
  r.weaponUses = a[12];
  r.place = a[13];
  r.finished = a[14] === 1;
  r.finishTime = a[15];
  r.lastSeq = a[16];
  r.progress = a[17];
  r.wobble = a[18];
  r.boosting = a[19];
  r.lean = a[20];
  r.takedowns = a[21];
  return r;
}

export function copyRiderState(from, to) {
  to.z = from.z;
  to.x = from.x;
  to.speed = from.speed;
  to.health = from.health;
  to.nitro = from.nitro;
  to.crashTimer = from.crashTimer;
  to.invuln = from.invuln;
  to.attack = from.attack;
  to.attackTimer = from.attackTimer;
  to.attackSide = from.attackSide;
  to.weapon = from.weapon;
  to.weaponUses = from.weaponUses;
  to.place = from.place;
  to.finished = from.finished;
  to.finishTime = from.finishTime;
  to.progress = from.progress;
  to.wobble = from.wobble;
  to.boosting = from.boosting;
  to.lean = from.lean;
  to.takedowns = from.takedowns;
  return to;
}
