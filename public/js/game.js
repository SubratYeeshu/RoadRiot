import {
  ATK_CLUB,
  ATK_KICK,
  INPUT_SEND_MS,
  INTERP_DELAY_MS,
  KPH_PER_UNIT,
  MAX_HEALTH,
  MAX_SPEED,
  NITRO_MAX,
  RIDER_COLORS,
  TICK_DT
} from '/shared/constants.js';
import { clamp, deltaZ, formatTime, lerp, ordinal, wrap } from '/shared/util.js';
import { createTrack } from '/shared/track.js';
import { resetRider, stepRider } from '/shared/physics.js';
import { decodeRider } from '/shared/netcode.js';
import { Renderer } from './renderer.js';

const SNAPSHOT_BUFFER = 24;

function blankRider(meta) {
  const r = {
    index: meta.index,
    name: meta.name,
    colorIndex: meta.colorIndex,
    bot: meta.bot
  };
  resetRider(r, meta.index, null);
  return r;
}

export class Game {
  constructor({ canvas, net, audio, input }) {
    this.renderer = new Renderer(canvas);
    this.net = net;
    this.audio = audio;
    this.input = input;

    this.track = null;
    this.localIndex = -1;
    this.meta = new Map();
    this.riders = new Map();
    this.local = null;
    this.pending = [];
    this.snapshots = [];
    this.pickupState = [];
    this.raceTime = 0;
    this.racing = false;
    this.active = false;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.lastInputSent = 0;
    this.lastInput = null;
    this.hudTimer = 0;
    this.smooth = { progress: 0, x: 0 };

    this.dom = {
      hud: document.getElementById('hud'),
      place: document.getElementById('hudPlace'),
      total: document.getElementById('hudTotal'),
      time: document.getElementById('hudTime'),
      ping: document.getElementById('hudPing'),
      speed: document.getElementById('hudSpeed'),
      health: document.getElementById('hudHealth'),
      nitro: document.getElementById('hudNitro'),
      weapon: document.getElementById('hudWeapon'),
      standings: document.getElementById('hudStandings'),
      rail: document.getElementById('hudRail'),
      feed: document.getElementById('hudFeed'),
      centerMsg: document.getElementById('centerMsg'),
      flash: document.getElementById('damageFlash')
    };
    this.pips = new Map();
  }

  // ------------------------------------------------------------------ setup
  prepare(seed, ridersMeta, localIndex) {
    this.track = createTrack(seed);
    this.renderer.setTheme(seed);
    this.localIndex = localIndex;
    this.meta.clear();
    this.riders.clear();
    this.pending.length = 0;
    this.snapshots.length = 0;
    this.pickupState = this.track.pickups.map(() => 1);
    this.raceTime = 0;
    this.racing = false;
    this.smooth.progress = 0;
    this.smooth.x = 0;

    ridersMeta.forEach((m) => {
      this.meta.set(m.index, m);
      const rider = blankRider(m);
      resetRider(rider, m.index, this.track);
      rider.name = m.name;
      rider.colorIndex = m.colorIndex;
      this.riders.set(m.index, rider);
      if (m.index === localIndex) this.local = rider;
    });

    if (!this.local) {
      const spectator = blankRider({ index: 0, name: 'Spectator', colorIndex: 0, bot: false });
      resetRider(spectator, 0, this.track);
      this.local = spectator;
    }

    this.buildRail();
    this.dom.total.textContent = String(ridersMeta.length);
    this.dom.hud.classList.remove('hidden');
    this.start();
  }

  buildRail() {
    const rail = this.dom.rail;
    rail.textContent = '';
    this.pips.clear();
    for (const [index, meta] of this.meta) {
      const pip = document.createElement('span');
      pip.className = index === this.localIndex ? 'pip me' : 'pip';
      pip.style.background = RIDER_COLORS[meta.colorIndex % RIDER_COLORS.length].body;
      pip.style.top = '0%';
      rail.appendChild(pip);
      this.pips.set(index, pip);
    }
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.lastFrame = performance.now();
    this.audio.startEngine();
    const loop = (now) => {
      if (!this.active) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.active = false;
    this.racing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.audio.stopEngine();
    this.dom.hud.classList.add('hidden');
  }

  beginRacing() {
    this.racing = true;
    this.raceTime = 0;
    this.pending.length = 0;
  }

  // ------------------------------------------------------------------ network
  onSnapshot(snap) {
    const clientTime = performance.now();
    this.snapshots.push({ clientTime, t: snap.t, riders: snap.p });
    if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();

    if (snap.w) this.pickupState = snap.w;
    this.raceTime = this.raceTime === 0 ? snap.t : lerp(this.raceTime, snap.t, 0.25);

    const mine = snap.p.find((arr) => arr[0] === this.localIndex);
    if (mine && this.local) this.reconcile(mine);

    if (snap.e && snap.e.length) this.onEvents(snap.e);
  }

  reconcile(encoded) {
    const beforeProgress = this.local.progress;
    const beforeX = this.local.x;

    decodeRider(encoded, this.local);
    const ackSeq = this.local.lastSeq;
    this.pending = this.pending.filter((p) => p.input.seq > ackSeq);
    for (const p of this.pending) {
      stepRider(this.local, p.input, this.track, p.dt, p.time);
    }

    // soften the correction so a late packet does not teleport the bike
    const dProgress = beforeProgress - this.local.progress;
    const dX = beforeX - this.local.x;
    if (Math.abs(dProgress) < 4000) this.smooth.progress = clamp(dProgress, -1200, 1200);
    if (Math.abs(dX) < 0.6) this.smooth.x = dX;
  }

  onEvents(events) {
    for (const e of events) {
      if (e.type === 'attack') this.onAttackEvent(e);
      else if (e.type === 'crash') this.onCrashEvent(e);
      else if (e.type === 'hit') this.onHitEvent(e);
      else if (e.type === 'pickup' && e.target === this.localIndex) {
        this.audio.playPickup();
        this.pushFeed('Club acquired — swing with PUNCH');
      } else if (e.type === 'finish' && e.target === this.localIndex) {
        this.audio.playFinish();
        this.showCenter('FINISH!');
      }
    }
  }

  nameOf(index) {
    return this.meta.get(index)?.name || 'Rider';
  }

  panFor(index) {
    const other = this.riders.get(index);
    if (!other || !this.local) return 0;
    return clamp((other.x - this.local.x) * 1.6, -1, 1);
  }

  audibleDistance(index) {
    const other = this.riders.get(index);
    if (!other || !this.local || !this.track) return 1;
    const d = Math.abs(deltaZ(this.local.z, other.z, this.track.trackLength));
    return clamp(1 - d / 6000, 0, 1);
  }

  onAttackEvent(e) {
    const vol = e.src === this.localIndex || e.target === this.localIndex ? 1 : this.audibleDistance(e.src);
    if (vol < 0.08) return;
    const pan = e.src === this.localIndex ? 0 : this.panFor(e.src);
    if (e.kind === ATK_CLUB) this.audio.playClub(pan);
    else this.audio.playPunch(e.kind === ATK_KICK ? 1.15 : 0.9 * vol + 0.1, pan);
    if (e.src === this.localIndex) this.pushFeed(`You hit ${this.nameOf(e.target)}`);
    else if (e.target === this.localIndex) this.pushFeed(`${this.nameOf(e.src)} hit you!`);
  }

  onHitEvent(e) {
    if (e.target !== this.localIndex) return;
    this.renderer.addShake(0.35);
    this.flashDamage();
  }

  onCrashEvent(e) {
    if (e.target === this.localIndex) {
      this.audio.playCrash();
      this.renderer.addShake(1.2);
      this.flashDamage();
      this.showCenter('WIPEOUT');
      this.pushFeed('You went down — remount in a moment');
    } else if (this.audibleDistance(e.target) > 0.1) {
      this.audio.playScrape();
      this.pushFeed(`${this.nameOf(e.target)} crashed`);
    }
  }

  flashDamage() {
    const el = this.dom.flash;
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 90);
  }

  showCenter(text, ms = 1600) {
    const el = this.dom.centerMsg;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._centerTimer);
    this._centerTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  pushFeed(text) {
    const el = document.createElement('div');
    el.textContent = text;
    this.dom.feed.appendChild(el);
    while (this.dom.feed.children.length > 5) this.dom.feed.removeChild(this.dom.feed.firstChild);
    setTimeout(() => el.remove(), 4200);
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;

    const input = this.input.sample(dt);
    this.lastInput = input;

    if (this.racing) {
      this.raceTime += dt;
      this.accumulator += dt;
      let guard = 0;
      while (this.accumulator >= TICK_DT && guard++ < 8) {
        this.accumulator -= TICK_DT;
        const tickInput = { ...input, seq: input.seq };
        stepRider(this.local, tickInput, this.track, TICK_DT, this.raceTime);
        this.pending.push({ input: tickInput, dt: TICK_DT, time: this.raceTime });
        if (this.pending.length > 180) this.pending.shift();
      }

      if (now - this.lastInputSent >= INPUT_SEND_MS) {
        this.lastInputSent = now;
        this.net.sendInput(input);
      }
    }

    this.local.braking = !!input.brake;
    this.interpolateRemotes(now);
    this.smooth.progress *= Math.max(0, 1 - dt * 6);
    this.smooth.x *= Math.max(0, 1 - dt * 6);

    this.renderScene();
    this.updateAudio();

    this.hudTimer += dt;
    if (this.hudTimer > 0.06) {
      this.hudTimer = 0;
      this.updateHud();
    }
  }

  interpolateRemotes(now) {
    if (this.snapshots.length === 0) return;
    const target = now - INTERP_DELAY_MS;
    let older = this.snapshots[0];
    let newer = this.snapshots[this.snapshots.length - 1];
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].clientTime <= target && this.snapshots[i + 1].clientTime >= target) {
        older = this.snapshots[i];
        newer = this.snapshots[i + 1];
        break;
      }
    }
    const span = newer.clientTime - older.clientTime;
    const alpha = span > 0 ? clamp((target - older.clientTime) / span, 0, 1) : 1;

    for (const encoded of newer.riders) {
      const index = encoded[0];
      if (index === this.localIndex) continue;
      const rider = this.riders.get(index);
      if (!rider) continue;
      const prev = older.riders.find((a) => a[0] === index);
      decodeRider(encoded, rider);
      if (!prev) continue;
      const prevZ = prev[1];
      rider.z = wrap(prevZ + deltaZ(prevZ, encoded[1], this.track.trackLength) * alpha, this.track.trackLength);
      rider.x = lerp(prev[2], encoded[2], alpha);
      rider.lean = lerp(prev[20], encoded[20], alpha);
      rider.speed = lerp(prev[3], encoded[3], alpha);
    }
  }

  renderScene() {
    if (!this.track) return;
    const cameraZ = wrap(this.local.z + this.smooth.progress, this.track.trackLength);
    this.renderer.render({
      track: this.track,
      camera: { z: cameraZ, x: this.local.x + this.smooth.x },
      local: this.local,
      riders: [...this.riders.values()],
      localIndex: this.localIndex,
      time: this.raceTime,
      pickupState: this.pickupState
    });
  }

  updateAudio() {
    const local = this.local;
    this.audio.updateEngine({
      speedPercent: local.speed / MAX_SPEED,
      boosting: !!local.boosting,
      throttle: !!this.lastInput?.accel,
      offRoad: Math.abs(local.x) > 1,
      crashed: local.crashTimer > 0
    });

    const rivals = [];
    for (const rider of this.riders.values()) {
      if (rider.index === this.localIndex) continue;
      const d = Math.abs(deltaZ(local.z, rider.z, this.track.trackLength));
      if (d > 7000) continue;
      rivals.push({
        index: rider.index,
        speedPercent: rider.speed / MAX_SPEED,
        pan: clamp((rider.x - local.x) * 1.4, -1, 1),
        volume: clamp(1 - d / 7000, 0, 1),
        d
      });
    }
    rivals.sort((a, b) => a.d - b.d);
    this.audio.updateRivals(rivals);
  }

  updateHud() {
    const local = this.local;
    const dom = this.dom;
    dom.speed.textContent = String(Math.round(local.speed * KPH_PER_UNIT));
    dom.time.textContent = formatTime(this.raceTime);
    dom.ping.textContent = String(this.net.ping || 0);
    dom.place.textContent = ordinal(local.place || 1);
    dom.health.style.width = `${clamp((local.health / MAX_HEALTH) * 100, 0, 100)}%`;
    dom.nitro.style.width = `${clamp((local.nitro / NITRO_MAX) * 100, 0, 100)}%`;

    if (local.weapon === 1 && local.weaponUses > 0) {
      dom.weapon.textContent = `CLUB x${local.weaponUses}`;
      dom.weapon.classList.remove('hidden');
    } else {
      dom.weapon.classList.add('hidden');
    }

    const ordered = [...this.riders.values()].sort((a, b) => (a.place || 99) - (b.place || 99));
    dom.standings.textContent = '';
    for (const rider of ordered.slice(0, 8)) {
      const row = document.createElement('div');
      if (rider.index === this.localIndex) row.className = 'me';
      const swatch = document.createElement('i');
      swatch.style.background = RIDER_COLORS[rider.colorIndex % RIDER_COLORS.length].body;
      const label = document.createElement('span');
      label.textContent = `${rider.place || '-'}. ${rider.name}`;
      row.append(swatch, label);
      dom.standings.appendChild(row);

      const pip = this.pips.get(rider.index);
      if (pip) {
        const pct = clamp((rider.progress / this.track.raceDistance) * 100, 0, 100);
        pip.style.top = `${100 - pct}%`;
      }
    }
  }
}
