// Small deterministic helpers. No randomness here uses Math.random so that the
// server and every client can rebuild an identical track from a single seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function approach(value, target, rate) {
  if (value < target) return Math.min(value + rate, target);
  if (value > target) return Math.max(value - rate, target);
  return target;
}

export function easeIn(a, b, percent) {
  return a + Math.pow(percent, 2) * (b - a);
}

export function easeOut(a, b, percent) {
  return a + (1 - Math.pow(1 - percent, 2)) * (b - a);
}

export function easeInOut(a, b, percent) {
  return a + (-Math.cos(percent * Math.PI) / 2 + 0.5) * (b - a);
}

export function wrap(value, length) {
  return ((value % length) + length) % length;
}

/** Shortest signed distance from `from` to `to` on a looping track. */
export function deltaZ(from, to, length) {
  let d = wrap(to - from, length);
  if (d > length / 2) d -= length;
  return d;
}

export function percentRemaining(n, total) {
  return (n % total) / total;
}

export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

export function randChoice(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function ordinal(n) {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}
