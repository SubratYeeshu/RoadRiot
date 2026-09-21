import {
  ATK_CLUB,
  ATK_KICK,
  ATK_NONE,
  ATK_PUNCH,
  ATTACK_ANIM,
  ATTACK_REACH_X,
  ATTACK_REACH_Z,
  COUNTDOWN_TIME,
  FINISH_GRACE,
  MAX_PLAYERS,
  MAX_RACE_TIME,
  MAX_SPEED,
  RESULTS_TIME,
  SNAPSHOT_EVERY,
  WEAPON_PICKUP_X,
  WEAPON_PICKUP_Z,
  WEAPON_RESPAWN,
  WEAPON_USES
} from '../shared/constants.js';
import { clamp, deltaZ, hashString } from '../shared/util.js';
import { createTrack, segmentAt, trafficX, trafficZ } from '../shared/track.js';
import {
  attackCooldown,
  attackDamage,
  createRider,
  damageRider,
  neutralInput,
  resetRider,
  sanitizeInput,
  separateRiders,
  stepRider
} from '../shared/physics.js';
import { encodeRider } from '../shared/netcode.js';

const BOT_NAMES = ['Viper', 'Ratchet', 'Mongrel', 'Sledge', 'Havoc', 'Diesel', 'Kestrel', 'Tarmac'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function sanitizeName(raw, fallback = 'Rider') {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
  return cleaned.length >= 2 ? cleaned : fallback;
}

export class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.seed = hashString(`${code}-${Date.now()}`);
    this.track = createTrack(this.seed);
    this.riders = [];
    this.inputs = new Map();
    this.state = 'lobby';
    this.timer = 0;
    this.raceTime = 0;
    this.tick = 0;
    this.firstFinishAt = null;
    this.hostId = null;
    this.botFill = true;
    this.lastActivity = Date.now();
  }

  get humans() {
    return this.riders.filter((r) => !r.bot);
  }

  get playerCount() {
    return this.humans.length;
  }

  isFull() {
    return this.humans.length >= MAX_PLAYERS;
  }

  isJoinable() {
    return !this.isFull();
  }

  freeIndex() {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!this.riders.some((r) => r.index === i)) return i;
    }
    return -1;
  }

  addPlayer(socketId, name) {
    this.removeBotIfNeeded();
    const index = this.freeIndex();
    if (index < 0) return null;
    const rider = createRider({ id: socketId, index, name, colorIndex: index });
    resetRider(rider, index, this.track);
    this.riders.push(rider);
    this.inputs.set(socketId, neutralInput());
    if (!this.hostId) this.hostId = socketId;
    this.lastActivity = Date.now();
    this.syncBots();
    return rider;
  }

  removePlayer(socketId) {
    const idx = this.riders.findIndex((r) => r.id === socketId);
    if (idx >= 0) this.riders.splice(idx, 1);
    this.inputs.delete(socketId);
    if (this.hostId === socketId) {
      const nextHost = this.humans[0];
      this.hostId = nextHost ? nextHost.id : null;
    }
    if (this.humans.length === 0) {
      this.riders = [];
      this.inputs.clear();
      this.state = 'lobby';
    } else {
      this.syncBots();
    }
    this.lastActivity = Date.now();
  }

  removeBotIfNeeded() {
    if (this.riders.length < MAX_PLAYERS) return;
    const bot = this.riders.find((r) => r.bot);
    if (bot) {
      this.riders.splice(this.riders.indexOf(bot), 1);
      this.inputs.delete(bot.id);
    }
  }

  syncBots() {
    const humans = this.humans.length;
    if (humans === 0) {
      this.riders = this.riders.filter((r) => !r.bot);
      return;
    }
    const wanted = this.botFill ? Math.max(0, MAX_PLAYERS - humans) : 0;
    let bots = this.riders.filter((r) => r.bot);

    while (bots.length > wanted) {
      const bot = bots.pop();
      this.riders.splice(this.riders.indexOf(bot), 1);
      this.inputs.delete(bot.id);
    }
    while (bots.length < wanted) {
      const index = this.freeIndex();
      if (index < 0) break;
      const id = `bot:${this.code}:${index}`;
      const bot = createRider({ id, index, name: BOT_NAMES[index % BOT_NAMES.length], colorIndex: index });
      bot.bot = true;
      bot.ready = true;
      bot.skill = 0.82 + (index % 5) * 0.045;
      resetRider(bot, index, this.track);
      this.riders.push(bot);
      this.inputs.set(id, neutralInput());
      bots = this.riders.filter((r) => r.bot);
    }
    this.riders.sort((a, b) => a.index - b.index);
  }

  setBotFill(socketId, enabled) {
    if (socketId !== this.hostId || this.state !== 'lobby') return;
    this.botFill = !!enabled;
    this.syncBots();
  }

  setReady(socketId, ready) {
    const rider = this.riders.find((r) => r.id === socketId);
    if (!rider || this.state !== 'lobby') return;
    rider.ready = !!ready;
    this.lastActivity = Date.now();
    const humans = this.humans;
    if (humans.length > 0 && humans.every((r) => r.ready)) this.beginCountdown();
  }

  forceStart(socketId) {
    if (socketId !== this.hostId || this.state !== 'lobby') return;
    this.beginCountdown();
  }

  setInput(socketId, raw) {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    const rider = this.riders.find((r) => r.id === socketId);
    if (!rider || rider.bot) return;
    const clean = sanitizeInput(raw);
    const prev = this.inputs.get(socketId);
    // keep an unconsumed attack so a fast tap is never dropped between ticks
    if (prev && prev.atk !== ATK_NONE && clean.atk === ATK_NONE) clean.atk = prev.atk;
    this.inputs.set(socketId, clean);
    rider.lastSeq = clean.seq;
  }

  beginCountdown() {
    this.seed = hashString(`${this.code}-${Date.now()}-${Math.random()}`);
    this.track = createTrack(this.seed);
    this.raceTime = 0;
    this.tick = 0;
    this.firstFinishAt = null;
    this.riders.sort((a, b) => a.index - b.index);
    this.riders.forEach((r, i) => {
      resetRider(r, i, this.track);
      this.inputs.set(r.id, neutralInput());
    });
    this.state = 'countdown';
    this.timer = COUNTDOWN_TIME;
    this.broadcastLobby();
    this.io.to(this.code).emit('race:countdown', {
      seed: this.seed,
      duration: COUNTDOWN_TIME,
      riders: this.riders.map((r) => this.riderMeta(r))
    });
  }

  beginRace() {
    this.state = 'racing';
    this.raceTime = 0;
    this.io.to(this.code).emit('race:start', { seed: this.seed });
    this.broadcastLobby();
  }

  endRace() {
    this.state = 'results';
    this.timer = RESULTS_TIME;
    const standings = [...this.riders]
      .sort(this.placeComparator.bind(this))
      .map((r, i) => ({
        place: i + 1,
        name: r.name,
        index: r.index,
        bot: r.bot,
        finished: r.finished,
        time: r.finished ? r.finishTime : null,
        takedowns: r.takedowns
      }));
    const winner = this.riders.find((r) => r.index === standings[0]?.index);
    if (winner) winner.wins++;
    this.io.to(this.code).emit('race:results', { standings, returnIn: RESULTS_TIME });
    this.broadcastLobby();
  }

  returnToLobby() {
    this.state = 'lobby';
    this.riders.forEach((r) => {
      r.ready = r.bot;
      resetRider(r, r.index, this.track);
    });
    this.broadcastLobby();
  }

  placeComparator(a, b) {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  }

  updatePlaces() {
    const order = [...this.riders].sort(this.placeComparator.bind(this));
    order.forEach((r, i) => {
      r.place = i + 1;
    });
  }

  botThink(bot) {
    const track = this.track;
    const time = this.raceTime;
    const seg = segmentAt(track, bot.z);
    const input = this.inputs.get(bot.id) || neutralInput();
    input.seq++;
    input.accel = 1;
    input.brake = 0;
    input.atk = ATK_NONE;

    let targetX = clamp(bot.x, -0.8, 0.8) - seg.curve * 0.08;

    for (const car of track.traffic) {
      const cz = trafficZ(car, time, track.trackLength);
      const dz = deltaZ(bot.z, cz, track.trackLength);
      const lookahead = car.oncoming ? 4200 : 2800;
      if (dz > 0 && dz < lookahead) {
        const cx = trafficX(car, time);
        if (Math.abs(cx - bot.x) < 0.55) targetX = cx + (bot.x >= cx ? 0.62 : -0.62);
      }
    }

    let victim = null;
    let bestScore = Infinity;
    for (const other of this.riders) {
      if (other === bot || other.crashTimer > 0 || other.finished) continue;
      const dz = deltaZ(bot.z, other.z, track.trackLength);
      if (dz < -300 || dz > 1600) continue;
      const score = Math.abs(dz) + Math.abs(other.x - bot.x) * 900;
      if (score < bestScore) {
        bestScore = score;
        victim = other;
      }
    }
    if (victim) {
      const dz = deltaZ(bot.z, victim.z, track.trackLength);
      if (Math.abs(dz) < ATTACK_REACH_Z && Math.abs(victim.x - bot.x) < ATTACK_REACH_X) {
        if (bot.attackCooldown <= 0) input.atk = Math.random() < 0.4 ? ATK_KICK : ATK_PUNCH;
      } else if (Math.abs(victim.x - bot.x) < 0.9) {
        targetX = victim.x + (bot.x >= victim.x ? 0.28 : -0.28);
      }
    }

    targetX = clamp(targetX, -0.92, 0.92);
    input.steer = clamp((targetX - bot.x) * 3.2, -1, 1);
    const capped = bot.speed > MAX_SPEED * bot.skill;
    if (capped) input.accel = 0;
    input.nitro = !capped && bot.speed > MAX_SPEED * 0.6 && Math.random() < 0.02 ? 1 : input.nitro;
    if (bot.nitro <= 0.05) input.nitro = 0;
    this.inputs.set(bot.id, input);
  }

  resolveCombat(events) {
    const track = this.track;
    for (const rider of this.riders) {
      const input = this.inputs.get(rider.id);
      if (!input) continue;
      const requested = input.atk;
      input.atk = ATK_NONE;
      if (!requested || rider.crashTimer > 0 || rider.finished || rider.attackCooldown > 0) continue;

      const hasClub = rider.weapon === 1 && rider.weaponUses > 0;
      const kind = hasClub ? ATK_CLUB : requested;
      rider.attack = kind;
      rider.attackTimer = ATTACK_ANIM;
      rider.attackCooldown = attackCooldown(requested) * (hasClub ? 1.15 : 1);

      let target = null;
      let bestScore = Infinity;
      for (const other of this.riders) {
        if (other === rider || other.crashTimer > 0 || other.finished || other.invuln > 0) continue;
        const dz = deltaZ(rider.z, other.z, track.trackLength);
        if (Math.abs(dz) > ATTACK_REACH_Z) continue;
        const dx = other.x - rider.x;
        if (Math.abs(dx) > ATTACK_REACH_X) continue;
        const score = Math.abs(dz) + Math.abs(dx) * 700;
        if (score < bestScore) {
          bestScore = score;
          target = other;
        }
      }

      rider.attackSide = target ? (target.x >= rider.x ? 1 : -1) : input.steer >= 0 ? 1 : -1;
      if (!target) {
        events.push({ type: 'swing', src: rider.index, kind });
        continue;
      }

      const wasUp = target.crashTimer === 0;
      damageRider(target, attackDamage(requested, hasClub), hasClub ? 'club' : requested === ATK_KICK ? 'kick' : 'punch', events);
      events.push({ type: 'attack', src: rider.index, target: target.index, kind });
      if (hasClub) {
        rider.weaponUses--;
        if (rider.weaponUses <= 0) rider.weapon = 0;
      }
      if (wasUp && target.crashTimer > 0) rider.takedowns++;
    }
  }

  resolvePickups(events) {
    for (const pickup of this.track.pickups) {
      if (pickup.taken) {
        if (this.raceTime >= pickup.respawnAt) pickup.taken = false;
        continue;
      }
      for (const rider of this.riders) {
        if (rider.crashTimer > 0 || rider.finished || rider.weapon === 1) continue;
        if (Math.abs(rider.progress - pickup.z) > WEAPON_PICKUP_Z) continue;
        if (Math.abs(rider.x - pickup.x) > WEAPON_PICKUP_X) continue;
        rider.weapon = 1;
        rider.weaponUses = WEAPON_USES;
        pickup.taken = true;
        pickup.respawnAt = this.raceTime + WEAPON_RESPAWN;
        events.push({ type: 'pickup', target: rider.index, pickup: pickup.id });
        break;
      }
    }
  }

  simulate(dt, events) {
    this.raceTime += dt;
    for (const rider of this.riders) {
      if (rider.bot) this.botThink(rider);
    }
    this.resolveCombat(events);
    for (const rider of this.riders) {
      const input = this.inputs.get(rider.id) || neutralInput();
      stepRider(rider, input, this.track, dt, this.raceTime, events);
    }
    for (let i = 0; i < this.riders.length; i++) {
      for (let j = i + 1; j < this.riders.length; j++) {
        separateRiders(this.riders[i], this.riders[j], this.track, dt);
      }
    }
    this.resolvePickups(events);
    this.updatePlaces();

    const finishedHumans = this.humans.every((r) => r.finished);
    const anyFinished = this.riders.some((r) => r.finished);
    if (anyFinished && this.firstFinishAt === null) this.firstFinishAt = this.raceTime;
    const graceOver = this.firstFinishAt !== null && this.raceTime - this.firstFinishAt > FINISH_GRACE;
    if ((finishedHumans && this.humans.length > 0) || graceOver || this.raceTime > MAX_RACE_TIME) {
      this.endRace();
    }
  }

  update(dt) {
    if (this.humans.length === 0) return;
    const events = [];

    if (this.state === 'countdown') {
      this.timer -= dt;
      if (this.timer <= 0) this.beginRace();
    } else if (this.state === 'racing') {
      this.simulate(dt, events);
    } else if (this.state === 'results') {
      this.timer -= dt;
      if (this.timer <= 0) this.returnToLobby();
    }

    if (this.state === 'racing') {
      this.tick++;
      if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot(events);
      else if (events.length) this.io.to(this.code).emit('race:events', events);
    }
  }

  broadcastSnapshot(events) {
    this.io.volatile.to(this.code).emit('race:snapshot', {
      t: Math.round(this.raceTime * 1000) / 1000,
      k: this.tick,
      p: this.riders.map(encodeRider),
      w: this.track.pickups.map((p) => (p.taken ? 0 : 1)),
      e: events
    });
  }

  riderMeta(r) {
    return {
      id: r.bot ? null : r.id,
      index: r.index,
      name: r.name,
      colorIndex: r.colorIndex,
      bot: !!r.bot,
      ready: !!r.ready,
      wins: r.wins | 0,
      host: r.id === this.hostId
    };
  }

  lobbyPayload() {
    return {
      code: this.code,
      state: this.state,
      seed: this.seed,
      botFill: this.botFill,
      countdown: this.state === 'countdown' ? Math.max(0, this.timer) : 0,
      players: this.riders.map((r) => this.riderMeta(r))
    };
  }

  broadcastLobby() {
    this.io.to(this.code).emit('room:update', this.lobbyPayload());
  }
}
