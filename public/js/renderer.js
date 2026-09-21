import {
  CAMERA_HEIGHT,
  DRAW_DISTANCE,
  FIELD_OF_VIEW,
  FOG_DENSITY,
  LANES,
  MAX_SPEED,
  RIDER_COLORS,
  ROAD_WIDTH,
  SEGMENT_LENGTH,
  ATK_CLUB,
  ATK_KICK
} from '/shared/constants.js';
import { lerp, percentRemaining, wrap } from '/shared/util.js';
import { trafficX, trafficZ } from '/shared/track.js';
import { buildSprites, makeCanvas } from './sprites.js';

const THEMES = [
  {
    name: 'noon',
    sky: ['#4ea3e8', '#a9d8f5'],
    fog: '#bcd9ea',
    sun: '#fff6c9',
    hill: ['#5c7f9c', '#48697f'],
    tree: '#1f4a2a',
    tint: null
  },
  {
    name: 'dusk',
    sky: ['#31285a', '#f2703c'],
    fog: '#e0906a',
    sun: '#ffd27a',
    hill: ['#4a3358', '#33253f'],
    tree: '#20202f',
    tint: 'rgba(255,140,70,0.1)'
  },
  {
    name: 'night',
    sky: ['#070b1c', '#1a2c50'],
    fog: '#1d2c47',
    sun: '#dfe8ff',
    hill: ['#141f36', '#0d1526'],
    tree: '#0a1020',
    tint: 'rgba(20,30,70,0.32)'
  }
];

function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
  p.camera.x = (p.world.x || 0) - cameraX;
  p.camera.y = (p.world.y || 0) - cameraY;
  p.camera.z = (p.world.z || 0) - cameraZ;
  p.screen.scale = cameraDepth / p.camera.z;
  p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (p.screen.scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
}

function exponentialFog(distance, density) {
  return 1 / Math.pow(Math.E, distance * distance * density);
}

function buildHills(theme) {
  const c = makeCanvas(1600, 280);
  const ctx = c.getContext('2d');
  for (let layer = 0; layer < 2; layer++) {
    ctx.fillStyle = theme.hill[layer];
    ctx.beginPath();
    ctx.moveTo(0, 280);
    let x = 0;
    let y = 190 + layer * 30;
    while (x < 1600) {
      const w = 130 + ((x * 37 + layer * 91) % 160);
      const h = 60 + ((x * 53 + layer * 17) % 90) - layer * 18;
      ctx.lineTo(x + w / 2, y - h);
      ctx.lineTo(x + w, y);
      x += w;
    }
    ctx.lineTo(1600, 280);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function buildTreeLine(theme) {
  const c = makeCanvas(1600, 150);
  const ctx = c.getContext('2d');
  ctx.fillStyle = theme.tree;
  for (let x = -20; x < 1620; x += 17) {
    const h = 54 + ((x * 41) % 62);
    ctx.beginPath();
    ctx.moveTo(x, 150);
    ctx.lineTo(x + 11, 150 - h);
    ctx.lineTo(x + 22, 150);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(0, 134, 1600, 16);
  return c;
}

function buildClouds() {
  const c = makeCanvas(1600, 170);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  for (let i = 0; i < 26; i++) {
    const x = (i * 137) % 1600;
    const y = 20 + ((i * 53) % 80);
    const r = 16 + ((i * 29) % 26);
    for (let b = 0; b < 4; b++) {
      ctx.beginPath();
      ctx.arc(x + b * r * 0.72, y + ((b % 2) * r) / 3, r * (1 - b * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sprites = buildSprites();
    this.cameraDepth = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
    this.playerZOffset = CAMERA_HEIGHT * this.cameraDepth;
    this.width = 0;
    this.height = 0;
    this.offsets = { clouds: 0, hills: 0, trees: 0 };
    this.lastPosition = 0;
    this.shake = 0;
    this.setTheme(0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setTheme(seed) {
    this.theme = THEMES[Math.abs(seed) % THEMES.length];
    this.layers = {
      hills: buildHills(this.theme),
      trees: buildTreeLine(this.theme),
      clouds: buildClouds()
    };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  polygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  renderSegment(segment) {
    const ctx = this.ctx;
    const W = this.width;
    const { p1, p2, color, fog } = segment;
    const y1 = p1.screen.y;
    const y2 = p2.screen.y;
    const x1 = p1.screen.x;
    const x2 = p2.screen.x;
    const w1 = p1.screen.w;
    const w2 = p2.screen.w;

    const r1 = w1 / Math.max(6, 2 * LANES);
    const r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES);
    const l2 = w2 / Math.max(32, 8 * LANES);

    ctx.fillStyle = color.grass;
    ctx.fillRect(0, y2, W, y1 - y2);

    this.polygon(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, color.rumble);
    this.polygon(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, color.rumble);
    this.polygon(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, color.road);

    if (color.lane) {
      const lw1 = (w1 * 2) / LANES;
      const lw2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lw1;
      let lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < LANES; lane++) {
        this.polygon(lx1 - l1, y1, lx1 + l1, y1, lx2 + l2, y2, lx2 - l2, y2, color.lane);
        lx1 += lw1;
        lx2 += lw2;
      }
    }

    if (fog < 1) {
      ctx.globalAlpha = 1 - fog;
      ctx.fillStyle = this.theme.fog;
      ctx.fillRect(0, y2, W, y1 - y2);
      ctx.globalAlpha = 1;
    }
  }

  drawSprite(spr, scale, destX, destY, offsetX, offsetY, clipY, alpha) {
    const destW = spr.worldWidth * scale * (this.width / 2);
    if (destW < 1.2) return;
    const destH = destW * (spr.canvas.height / spr.canvas.width);
    const x = destX + destW * (offsetX || 0);
    const y = destY + destH * (offsetY || 0);
    const clipH = clipY ? Math.max(0, y + destH - clipY) : 0;
    if (clipH >= destH) return;
    const ctx = this.ctx;
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
    ctx.drawImage(
      spr.canvas,
      0,
      0,
      spr.canvas.width,
      spr.canvas.height - (spr.canvas.height * clipH) / destH,
      x,
      y,
      destW,
      destH - clipH
    );
    ctx.globalAlpha = 1;
  }

  renderBackground(playerY, deltaPos, curve) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const horizon = H * 0.5 - playerY * 0.00035 * H;

    const grad = ctx.createLinearGradient(0, 0, 0, horizon + 60);
    grad.addColorStop(0, this.theme.sky[0]);
    grad.addColorStop(1, this.theme.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, horizon + 60);

    const sunX = W * 0.72;
    const sunY = horizon - H * 0.16;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, H * 0.16);
    sunGrad.addColorStop(0, this.theme.sun);
    sunGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(sunX - H * 0.2, sunY - H * 0.2, H * 0.4, H * 0.4);

    this.offsets.clouds = wrap(this.offsets.clouds + curve * deltaPos * 0.00003 + deltaPos * 0.0000025, 1);
    this.offsets.hills = wrap(this.offsets.hills + curve * deltaPos * 0.00009, 1);
    this.offsets.trees = wrap(this.offsets.trees + curve * deltaPos * 0.00028, 1);

    this.drawLayer(this.layers.clouds, this.offsets.clouds, horizon - H * 0.34, H * 0.24);
    this.drawLayer(this.layers.hills, this.offsets.hills, horizon - H * 0.26, H * 0.28);
    this.drawLayer(this.layers.trees, this.offsets.trees, horizon - H * 0.07, H * 0.1);
  }

  drawLayer(layer, offset, y, height) {
    const ctx = this.ctx;
    const W = this.width;
    const scale = height / layer.height;
    const tileW = layer.width * scale;
    let x = -wrap(offset, 1) * tileW;
    while (x < W) {
      ctx.drawImage(layer, x, y, tileW, height);
      x += tileW;
    }
  }

  riderFrame(frames, rider) {
    if (rider.crashTimer > 0) return frames.crash;
    if (rider.attack) {
      const side = rider.attackSide >= 0 ? 'R' : 'L';
      if (rider.attack === ATK_CLUB) return frames[`club${side}`];
      if (rider.attack === ATK_KICK) return frames[`kick${side}`];
      return frames[`punch${side}`];
    }
    if (rider.lean < -0.3) return frames.leanL;
    if (rider.lean > 0.3) return frames.leanR;
    return frames.ride;
  }

  collectEntities(scene, baseIndex, segmentCount) {
    const buckets = new Map();
    const push = (z, item) => {
      const segIndex = Math.floor(wrap(z, scene.track.trackLength) / SEGMENT_LENGTH) % segmentCount;
      const n = (segIndex - baseIndex + segmentCount) % segmentCount;
      if (n >= DRAW_DISTANCE) return;
      let list = buckets.get(n);
      if (!list) buckets.set(n, (list = []));
      item.z = z;
      list.push(item);
    };

    for (const car of scene.track.traffic) {
      const z = trafficZ(car, scene.time, scene.track.trackLength);
      push(z, { kind: 'traffic', car, x: trafficX(car, scene.time) });
    }
    for (const rider of scene.riders) {
      if (rider.index === scene.localIndex) continue;
      push(rider.z, { kind: 'rider', rider, x: rider.x });
    }
    for (const pickup of scene.track.pickups) {
      if (scene.pickupState && scene.pickupState[pickup.id] === 0) continue;
      push(wrap(pickup.z, scene.track.trackLength), { kind: 'pickup', x: pickup.x });
    }
    push(scene.track.finishIndex * SEGMENT_LENGTH, { kind: 'finish', x: 0 });
    return buckets;
  }

  render(scene) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const track = scene.track;
    const segments = track.segments;
    const count = segments.length;
    const cameraDepth = this.cameraDepth;

    const position = wrap(scene.camera.z - this.playerZOffset, track.trackLength);
    let deltaPos = position - this.lastPosition;
    if (Math.abs(deltaPos) > track.trackLength / 2) deltaPos = 0;
    this.lastPosition = position;

    const baseIndex = Math.floor(position / SEGMENT_LENGTH) % count;
    const baseSegment = segments[baseIndex];
    const basePercent = percentRemaining(position, SEGMENT_LENGTH);
    const playerIndex = Math.floor(wrap(scene.camera.z, track.trackLength) / SEGMENT_LENGTH) % count;
    const playerSegment = segments[playerIndex];
    const playerPercent = percentRemaining(wrap(scene.camera.z, track.trackLength), SEGMENT_LENGTH);
    const playerY = lerp(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * 9;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
      this.shake = Math.max(0, this.shake - 0.035);
    }

    ctx.fillStyle = this.theme.fog;
    ctx.fillRect(0, 0, W, H);
    this.renderBackground(playerY, deltaPos, baseSegment.curve);

    let maxy = H;
    let x = 0;
    let dx = -(baseSegment.curve * basePercent);

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const segment = segments[(baseIndex + n) % count];
      segment.looped = segment.index < baseSegment.index;
      segment.fog = exponentialFog(n / DRAW_DISTANCE, FOG_DENSITY);
      segment.clip = maxy;

      const camZ = position - (segment.looped ? track.trackLength : 0);
      project(segment.p1, scene.camera.x * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, camZ, cameraDepth, W, H, ROAD_WIDTH);
      project(segment.p2, scene.camera.x * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, camZ, cameraDepth, W, H, ROAD_WIDTH);

      x += dx;
      dx += segment.curve;

      if (segment.p1.camera.z <= cameraDepth) continue;
      if (segment.p2.screen.y >= segment.p1.screen.y) continue;
      if (segment.p2.screen.y >= maxy) continue;

      this.renderSegment(segment);
      maxy = segment.p2.screen.y;
    }

    const buckets = this.collectEntities(scene, baseIndex, count);

    for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
      const segment = segments[(baseIndex + n) % count];
      if (!segment.p1.screen.scale) continue;
      const fogAlpha = 0.22 + 0.78 * segment.fog;

      for (const prop of segment.scenery) {
        const spr = this.sprites.scenery[prop.type];
        if (!spr) continue;
        const scale = segment.p1.screen.scale;
        const sx = segment.p1.screen.x + (scale * prop.offset * ROAD_WIDTH * W) / 2;
        this.drawSprite(spr, scale, sx, segment.p1.screen.y, prop.offset < 0 ? -1 : 0, -1, segment.clip, fogAlpha);
      }

      const items = buckets.get(n);
      if (!items) continue;
      items.sort((a, b) => b.z - a.z);
      for (const item of items) {
        const percent = percentRemaining(item.z, SEGMENT_LENGTH);
        const scale = lerp(segment.p1.screen.scale, segment.p2.screen.scale, percent);
        const sy = lerp(segment.p1.screen.y, segment.p2.screen.y, percent);
        const sx = lerp(segment.p1.screen.x, segment.p2.screen.x, percent) + (scale * item.x * ROAD_WIDTH * W) / 2;

        if (item.kind === 'traffic') {
          const set = this.sprites.traffic[item.car.type];
          const spr = set[item.car.oncoming ? 'front' : 'rear'][item.car.id % set.rear.length];
          this.drawSprite(spr, scale, sx, sy, -0.5, -1, segment.clip, fogAlpha);
        } else if (item.kind === 'pickup') {
          const bob = Math.sin(scene.time * 4 + item.z) * 0.08;
          this.drawSprite(this.sprites.pickup, scale, sx, sy, -0.5, -1 + bob, segment.clip, fogAlpha);
        } else if (item.kind === 'finish') {
          this.drawSprite(this.sprites.finish, scale, sx, sy, -0.5, -1, segment.clip, fogAlpha);
        } else if (item.kind === 'rider') {
          const rider = item.rider;
          const blink = rider.invuln > 0 && Math.floor(scene.time * 12) % 2 === 0;
          if (!blink) {
            const frames = this.sprites.riders[rider.colorIndex % this.sprites.riders.length];
            this.drawSprite(this.riderFrame(frames, rider), scale, sx, sy, -0.5, -1, segment.clip, fogAlpha);
          }
          this.drawNameTag(rider, scale, sx, sy, segment.clip);
        }
      }
    }

    this.renderLocalRider(scene, playerSegment, playerPercent);
    this.renderEffects(scene);
    ctx.restore();
  }

  drawNameTag(rider, scale, sx, sy, clipY) {
    const size = scale * 60000;
    if (size < 9 || size > 42) return;
    const ctx = this.ctx;
    const spr = this.sprites.riders[rider.colorIndex % this.sprites.riders.length].ride;
    const destW = spr.worldWidth * scale * (this.width / 2);
    const destH = destW * (spr.canvas.height / spr.canvas.width);
    const y = sy - destH - size * 0.6;
    if (clipY && y > clipY) return;
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = rider.name || '';
    const w = ctx.measureText(label).width + size * 0.7;
    ctx.fillStyle = 'rgba(8,11,16,0.55)';
    ctx.fillRect(sx - w / 2, y - size * 0.62, w, size * 1.24);
    ctx.fillStyle = RIDER_COLORS[rider.colorIndex % RIDER_COLORS.length].body;
    ctx.fillRect(sx - w / 2, y + size * 0.5, w, size * 0.12);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillText(label, sx, y);
  }

  renderLocalRider(scene, playerSegment, playerPercent) {
    const local = scene.local;
    if (!local) return;
    const W = this.width;
    const H = this.height;
    const scale = this.cameraDepth / this.playerZOffset;
    const camY = lerp(playerSegment.p1.camera.y || 0, playerSegment.p2.camera.y || 0, playerPercent);
    const speedPercent = local.speed / MAX_SPEED;
    const bounce = Math.sin(scene.time * 22) * speedPercent * 1.6 * (local.crashTimer > 0 ? 0 : 1);
    const destY = H / 2 - (scale * camY * H) / 2 + bounce;

    const blink = local.invuln > 0 && Math.floor(scene.time * 12) % 2 === 0;
    if (blink) return;
    const frames = this.sprites.riders[local.colorIndex % this.sprites.riders.length];
    const frame = local.braking && local.crashTimer <= 0 && !local.attack ? frames.brake : this.riderFrame(frames, local);
    this.drawSprite(frame, scale, W / 2, destY, -0.5, -1);
  }

  renderEffects(scene) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const local = scene.local;
    if (!local) return;
    const speedPercent = Math.min(1.3, local.speed / MAX_SPEED);

    if (this.theme.tint) {
      ctx.fillStyle = this.theme.tint;
      ctx.fillRect(0, 0, W, H);
    }

    if (local.boosting || speedPercent > 0.82) {
      const strength = local.boosting ? 0.5 : (speedPercent - 0.82) * 1.6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = local.boosting ? 'rgba(120,200,255,0.5)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + scene.time * 3;
        const r0 = H * (0.26 + (i % 3) * 0.05);
        const r1 = r0 + H * 0.3 * strength;
        ctx.globalAlpha = strength;
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(a) * r0 * 1.7, H / 2 + Math.sin(a) * r0);
        ctx.lineTo(W / 2 + Math.cos(a) * r1 * 1.7, H / 2 + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }

    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, `rgba(0,0,0,${0.3 + speedPercent * 0.22})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}
