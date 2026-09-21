import { RIDER_COLORS, SCENERY, TRAFFIC } from '/shared/constants.js';

// Every sprite in the game is drawn procedurally into an offscreen canvas at boot,
// so the build ships with zero image assets.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rr(ctx, x, y, w, h, r, fill) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
  if (fill) ctx.fillStyle = fill;
  ctx.fill();
}

function poly(ctx, points, fill) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------- rider frames
const RIDER_W = 170;
const RIDER_H = 190;

function drawArm(ctx, cx, ground, side, mode, pal) {
  const shoulderX = cx + side * 20;
  const shoulderY = ground - 96;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.body;
  ctx.lineWidth = 11;

  if (mode === 'punch') {
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(cx + side * 56, ground - 92);
    ctx.stroke();
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath();
    ctx.arc(cx + side * 60, ground - 92, 8, 0, Math.PI * 2);
    ctx.fill();
  } else if (mode === 'club') {
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(cx + side * 48, ground - 112);
    ctx.stroke();
    ctx.strokeStyle = '#7a4a22';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx + side * 44, ground - 112);
    ctx.lineTo(cx + side * 74, ground - 86);
    ctx.stroke();
    ctx.fillStyle = '#5c3617';
    ctx.beginPath();
    ctx.arc(cx + side * 76, ground - 84, 9, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.quadraticCurveTo(cx + side * 34, ground - 92, cx + side * 33, ground - 78);
    ctx.stroke();
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath();
    ctx.arc(cx + side * 33, ground - 76, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLeg(ctx, cx, ground, side, kicking, pal) {
  if (kicking) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = pal.suit;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(cx + side * 14, ground - 70);
    ctx.lineTo(cx + side * 58, ground - 56);
    ctx.stroke();
    rr(ctx, cx + side * 52, ground - 66, 20, 14, 5, '#191b1f');
    ctx.restore();
    return;
  }
  rr(ctx, cx + (side < 0 ? -27 : 13), ground - 74, 14, 40, 6, pal.suit);
  rr(ctx, cx + (side < 0 ? -29 : 14), ground - 38, 16, 11, 4, '#191b1f');
}

function drawRiderFrame(ctx, pal, number, opt) {
  const W = RIDER_W;
  const H = RIDER_H;
  const cx = W / 2;
  const ground = H - 14;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + 4, 34, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (opt.crash) {
    drawCrashFrame(ctx, cx, ground, pal);
    return;
  }

  ctx.save();
  ctx.translate(cx, ground);
  ctx.rotate((opt.lean || 0) * 0.15);
  ctx.translate(-cx, -ground);

  // rear wheel + drivetrain
  rr(ctx, cx - 15, ground - 46, 30, 46, 10, '#121418');
  rr(ctx, cx - 9, ground - 41, 18, 34, 7, '#272b32');
  rr(ctx, cx - 36, ground - 42, 18, 11, 5, '#c6ccd4');
  rr(ctx, cx + 18, ground - 42, 18, 11, 5, '#a8aeb7');

  // tail fairing
  poly(
    ctx,
    [
      [cx - 21, ground - 44],
      [cx + 21, ground - 44],
      [cx + 16, ground - 76],
      [cx - 16, ground - 76]
    ],
    pal.body
  );
  poly(
    ctx,
    [
      [cx - 21, ground - 44],
      [cx - 16, ground - 76],
      [cx - 10, ground - 76],
      [cx - 13, ground - 44]
    ],
    shade(pal.body, -34)
  );
  rr(ctx, cx - 9, ground - 52, 18, 8, 3, opt.brake ? '#ff5b5b' : '#95232a');

  // plate
  rr(ctx, cx - 12, ground - 73, 24, 15, 3, pal.trim);
  ctx.fillStyle = '#1b1e23';
  ctx.font = 'bold 12px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), cx, ground - 65);

  drawLeg(ctx, cx, ground, -1, opt.kick === -1, pal);
  drawLeg(ctx, cx, ground, 1, opt.kick === 1, pal);

  // torso
  poly(
    ctx,
    [
      [cx - 20, ground - 70],
      [cx + 20, ground - 70],
      [cx + 23, ground - 100],
      [cx - 23, ground - 100]
    ],
    pal.body
  );
  rr(ctx, cx - 5, ground - 101, 10, 32, 2, pal.trim);
  rr(ctx, cx - 24, ground - 102, 48, 7, 3, shade(pal.body, -28));

  drawArm(ctx, cx, ground, -1, opt.armL, pal);
  drawArm(ctx, cx, ground, 1, opt.armR, pal);

  // handlebars poking out past the rider
  rr(ctx, cx - 44, ground - 82, 16, 6, 3, '#3a3f47');
  rr(ctx, cx + 28, ground - 82, 16, 6, 3, '#3a3f47');

  // helmet
  ctx.fillStyle = '#1d2026';
  ctx.beginPath();
  ctx.arc(cx, ground - 112, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.arc(cx, ground - 112, 16, Math.PI, Math.PI * 2);
  ctx.fill();
  rr(ctx, cx - 11, ground - 112, 22, 7, 3, '#0c0e11');
  rr(ctx, cx - 13, ground - 118, 26, 4, 2, pal.trim);

  ctx.restore();
}

function drawCrashFrame(ctx, cx, ground, pal) {
  ctx.save();
  ctx.translate(cx, ground);
  ctx.rotate(-0.62);
  ctx.translate(-cx, -ground);
  rr(ctx, cx - 30, ground - 30, 56, 26, 10, pal.body);
  rr(ctx, cx - 40, ground - 26, 24, 24, 11, '#121418');
  rr(ctx, cx + 18, ground - 24, 20, 20, 9, '#121418');
  ctx.restore();

  ctx.save();
  ctx.translate(cx + 16, ground - 18);
  ctx.rotate(0.9);
  rr(ctx, -16, -12, 32, 24, 9, pal.suit);
  ctx.fillStyle = '#1d2026';
  ctx.beginPath();
  ctx.arc(-20, -6, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = pal.suit;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, -6);
  ctx.lineTo(30, -18);
  ctx.moveTo(8, 8);
  ctx.lineTo(32, 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(210,210,215,0.5)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 34, ground - 14 + Math.sin(a) * 9, 6 - i * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildRiderFrames(pal, number) {
  const frames = {};
  const defs = {
    ride: { lean: 0, armL: 'hold', armR: 'hold' },
    leanL: { lean: -1, armL: 'hold', armR: 'hold' },
    leanR: { lean: 1, armL: 'hold', armR: 'hold' },
    brake: { lean: 0, armL: 'hold', armR: 'hold', brake: true },
    punchL: { lean: -0.3, armL: 'punch', armR: 'hold' },
    punchR: { lean: 0.3, armL: 'hold', armR: 'punch' },
    kickL: { lean: -0.2, armL: 'hold', armR: 'hold', kick: -1 },
    kickR: { lean: 0.2, armL: 'hold', armR: 'hold', kick: 1 },
    clubL: { lean: -0.3, armL: 'club', armR: 'hold' },
    clubR: { lean: 0.3, armL: 'hold', armR: 'club' },
    crash: { crash: true }
  };
  for (const [name, opt] of Object.entries(defs)) {
    const canvas = makeCanvas(RIDER_W, RIDER_H);
    drawRiderFrame(canvas.getContext('2d'), pal, number, opt);
    frames[name] = { canvas, worldWidth: 620 };
  }
  return frames;
}

// ---------------------------------------------------------------- traffic
const TRAFFIC_DEFS = {
  [TRAFFIC.CAR]: { w: 150, h: 120, bodyW: 108, bodyH: 62, roofW: 74, roofH: 30, world: 1020 },
  [TRAFFIC.VAN]: { w: 160, h: 140, bodyW: 116, bodyH: 84, roofW: 104, roofH: 26, world: 1140 },
  [TRAFFIC.TRUCK]: { w: 170, h: 155, bodyW: 128, bodyH: 100, roofW: 96, roofH: 24, world: 1280 },
  [TRAFFIC.BUS]: { w: 180, h: 170, bodyW: 140, bodyH: 120, roofW: 132, roofH: 20, world: 1400 }
};

const TRAFFIC_PAINT = ['#c8443c', '#3f6fc0', '#d8ce54', '#4fae63', '#d9d9dd', '#8a5bbd', '#e08b34', '#4a4f57'];

function drawVehicle(ctx, def, paint, oncoming) {
  const { w, h, bodyW, bodyH, roofW, roofH } = def;
  const cx = w / 2;
  const ground = h - 6;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, ground + 1, bodyW / 2 + 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // wheels
  rr(ctx, cx - bodyW / 2 - 3, ground - 18, 16, 18, 5, '#15171b');
  rr(ctx, cx + bodyW / 2 - 13, ground - 18, 16, 18, 5, '#15171b');

  // roof / cabin
  rr(ctx, cx - roofW / 2, ground - bodyH - roofH, roofW, roofH + 10, 7, shade(paint, -18));
  // glass
  rr(ctx, cx - roofW / 2 + 6, ground - bodyH - roofH + 5, roofW - 12, roofH - 4, 4, oncoming ? '#9fd4ef' : '#1d2a35');

  // body
  rr(ctx, cx - bodyW / 2, ground - bodyH, bodyW, bodyH, 8, paint);
  rr(ctx, cx - bodyW / 2, ground - bodyH + bodyH * 0.55, bodyW, bodyH * 0.45, 6, shade(paint, -26));

  // bumper
  rr(ctx, cx - bodyW / 2 + 4, ground - 14, bodyW - 8, 10, 4, '#2c3037');

  if (oncoming) {
    rr(ctx, cx - bodyW / 2 + 8, ground - bodyH + 12, 22, 12, 5, '#fff6cf');
    rr(ctx, cx + bodyW / 2 - 30, ground - bodyH + 12, 22, 12, 5, '#fff6cf');
    ctx.fillStyle = 'rgba(255,246,207,0.25)';
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2 + 4, ground - 4);
    ctx.lineTo(cx + bodyW / 2 - 4, ground - 4);
    ctx.lineTo(cx + bodyW / 2 + 16, ground + 6);
    ctx.lineTo(cx - bodyW / 2 - 16, ground + 6);
    ctx.closePath();
    ctx.fill();
  } else {
    rr(ctx, cx - bodyW / 2 + 7, ground - bodyH + 14, 20, 11, 4, '#e2453f');
    rr(ctx, cx + bodyW / 2 - 27, ground - bodyH + 14, 20, 11, 4, '#e2453f');
    rr(ctx, cx - 16, ground - 30, 32, 11, 3, '#dfe2e6');
  }
}

function buildTrafficSprites() {
  const out = {};
  for (const [typeKey, def] of Object.entries(TRAFFIC_DEFS)) {
    out[typeKey] = { rear: [], front: [] };
    for (const paint of TRAFFIC_PAINT) {
      for (const dir of ['rear', 'front']) {
        const canvas = makeCanvas(def.w, def.h);
        drawVehicle(canvas.getContext('2d'), def, paint, dir === 'front');
        out[typeKey][dir].push({ canvas, worldWidth: def.world });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- scenery
function buildTree() {
  const c = makeCanvas(150, 210);
  const ctx = c.getContext('2d');
  rr(ctx, 66, 130, 18, 76, 4, '#5a4026');
  const greens = ['#1f5a25', '#27702c', '#2f8434'];
  for (let i = 0; i < 3; i++) {
    poly(
      ctx,
      [
        [75, 8 + i * 42],
        [136 - i * 8, 86 + i * 40],
        [14 + i * 8, 86 + i * 40]
      ],
      greens[i]
    );
  }
  return { canvas: c, worldWidth: 1950 };
}

function buildPalm() {
  const c = makeCanvas(170, 230);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#7b5a33';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(84, 228);
  ctx.quadraticCurveTo(70, 140, 86, 74);
  ctx.stroke();
  ctx.fillStyle = '#2b7d38';
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    ctx.save();
    ctx.translate(86, 72);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(38, 0, 40, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#c8912f';
  ctx.beginPath();
  ctx.arc(86, 74, 9, 0, Math.PI * 2);
  ctx.fill();
  return { canvas: c, worldWidth: 1950 };
}

function buildBoulder() {
  const c = makeCanvas(150, 110);
  const ctx = c.getContext('2d');
  poly(ctx, [[12, 106], [30, 44], [74, 16], [122, 46], [140, 106]], '#7e8189');
  poly(ctx, [[12, 106], [30, 44], [70, 34], [66, 106]], '#93969e');
  poly(ctx, [[66, 106], [70, 34], [122, 46], [140, 106]], '#63666d');
  return { canvas: c, worldWidth: 1280 };
}

function buildBillboard() {
  const c = makeCanvas(230, 180);
  const ctx = c.getContext('2d');
  rr(ctx, 42, 96, 14, 84, 2, '#4a4e55');
  rr(ctx, 176, 96, 14, 84, 2, '#4a4e55');
  rr(ctx, 16, 8, 200, 96, 6, '#1d222b');
  rr(ctx, 23, 15, 186, 82, 4, '#ff6a1f');
  ctx.fillStyle = '#1b1108';
  ctx.font = 'italic bold 34px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ROAD', 116, 42);
  ctx.fillStyle = '#ffe9b0';
  ctx.fillText('RIOT', 116, 76);
  return { canvas: c, worldWidth: 2600 };
}

function buildBush() {
  const c = makeCanvas(120, 80);
  const ctx = c.getContext('2d');
  const blobs = [[34, 52, 30], [72, 48, 26], [54, 34, 24], [94, 58, 20]];
  ctx.fillStyle = '#2c6b2c';
  for (const [x, y, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3a8a38';
  for (const [x, y, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x - 4, y - 6, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, worldWidth: 940 };
}

function buildPole() {
  const c = makeCanvas(110, 250);
  const ctx = c.getContext('2d');
  rr(ctx, 48, 30, 12, 220, 3, '#8a8f97');
  ctx.strokeStyle = '#8a8f97';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(54, 32);
  ctx.quadraticCurveTo(54, 10, 86, 12);
  ctx.stroke();
  rr(ctx, 74, 8, 30, 12, 5, '#d9dde2');
  rr(ctx, 78, 18, 22, 7, 3, '#ffe9a8');
  return { canvas: c, worldWidth: 700 };
}

function buildBarrel() {
  const c = makeCanvas(80, 110);
  const ctx = c.getContext('2d');
  rr(ctx, 12, 14, 56, 92, 10, '#e2642a');
  rr(ctx, 12, 40, 56, 16, 2, '#f2f2f2');
  rr(ctx, 12, 74, 56, 16, 2, '#f2f2f2');
  rr(ctx, 8, 6, 64, 14, 6, '#c4501f');
  return { canvas: c, worldWidth: 540 };
}

function buildPickup() {
  const c = makeCanvas(120, 120);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(60, 60, 4, 60, 60, 56);
  g.addColorStop(0, 'rgba(255,214,102,0.95)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 120, 120);
  ctx.save();
  ctx.translate(60, 60);
  ctx.rotate(-0.6);
  rr(ctx, -7, -38, 14, 62, 6, '#8a5526');
  rr(ctx, -13, -50, 26, 22, 9, '#5f3a19');
  ctx.fillStyle = '#c9ccd2';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(-9 + (i % 2) * 18, -44 + Math.floor(i / 2) * 11, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return { canvas: c, worldWidth: 640 };
}

function buildScenerySprites() {
  return {
    [SCENERY.TREE]: buildTree(),
    [SCENERY.PALM]: buildPalm(),
    [SCENERY.BOULDER]: buildBoulder(),
    [SCENERY.BILLBOARD]: buildBillboard(),
    [SCENERY.BUSH]: buildBush(),
    [SCENERY.POLE]: buildPole(),
    [SCENERY.BARREL]: buildBarrel()
  };
}

function buildFinishBanner() {
  const c = makeCanvas(600, 190);
  const ctx = c.getContext('2d');
  rr(ctx, 14, 40, 26, 150, 4, '#3b4049');
  rr(ctx, 560, 40, 26, 150, 4, '#3b4049');
  rr(ctx, 10, 10, 580, 74, 6, '#15181d');
  const sq = 18;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 32; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#f5f5f5' : '#15181d';
      ctx.fillRect(16 + x * sq, 16 + y * sq, sq, sq);
    }
  }
  ctx.fillStyle = '#ff6a1f';
  ctx.font = 'italic bold 40px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FINISH', 300, 60);
  return { canvas: c, worldWidth: 4600 };
}

export function buildSprites() {
  return {
    riders: RIDER_COLORS.map((pal, i) => buildRiderFrames(pal, i + 1)),
    traffic: buildTrafficSprites(),
    scenery: buildScenerySprites(),
    pickup: buildPickup(),
    finish: buildFinishBanner()
  };
}

export { makeCanvas, rr, poly, shade };
