import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { MAX_PLAYERS, TICK_DT } from '../shared/constants.js';
import { Room, makeRoomCode, sanitizeName } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 200;

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
  );
  next();
});

app.use(express.static(path.join(ROOT, 'public'), { maxAge: '5m', extensions: ['html'] }));
app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: '5m' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e4
});

class RoomManager {
  constructor(ioServer) {
    this.io = ioServer;
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  stats() {
    return { rooms: this.rooms.size, players: this.socketRoom.size };
  }

  getOrCreate(code) {
    let room = this.rooms.get(code);
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) return null;
      room = new Room(this.io, code);
      this.rooms.set(code, room);
    }
    return room;
  }

  findOpenRoom() {
    for (const room of this.rooms.values()) {
      if (room.state === 'lobby' && room.isJoinable() && room.playerCount > 0) return room;
    }
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    return this.getOrCreate(code);
  }

  join(socket, name, code) {
    this.leave(socket);
    const room = code ? this.getOrCreate(code) : this.findOpenRoom();
    if (!room) return { error: 'Server is at capacity, try again shortly.' };
    if (room.isFull()) return { error: `Room ${room.code} is full (${MAX_PLAYERS} players max).` };

    const rider = room.addPlayer(socket.id, name);
    if (!rider) return { error: 'Could not find a free slot in that room.' };

    socket.join(room.code);
    this.socketRoom.set(socket.id, room.code);
    room.broadcastLobby();
    return { rider, room };
  }

  leave(socket) {
    const code = this.socketRoom.get(socket.id);
    if (!code) return;
    this.socketRoom.delete(socket.id);
    socket.leave(code);
    const room = this.rooms.get(code);
    if (!room) return;
    room.removePlayer(socket.id);
    if (room.playerCount === 0) this.rooms.delete(code);
    else room.broadcastLobby();
  }

  roomOf(socket) {
    const code = this.socketRoom.get(socket.id);
    return code ? this.rooms.get(code) : null;
  }

  update(dt) {
    for (const [code, room] of this.rooms) {
      room.update(dt);
      if (room.playerCount === 0 && Date.now() - room.lastActivity > 60000) this.rooms.delete(code);
    }
  }
}

const manager = new RoomManager(io);

app.get('/healthz', (_req, res) => res.json({ ok: true, ...manager.stats() }));
app.get('/api/rooms', (_req, res) => {
  const list = [];
  for (const room of manager.rooms.values()) {
    if (room.playerCount > 0) {
      list.push({ code: room.code, players: room.playerCount, max: MAX_PLAYERS, state: room.state });
    }
  }
  res.json({ rooms: list });
});

function rateLimited(socket, key, perSecond) {
  const now = Date.now();
  socket.data.buckets = socket.data.buckets || {};
  const bucket = socket.data.buckets[key] || { tokens: perSecond, last: now };
  bucket.tokens = Math.min(perSecond, bucket.tokens + ((now - bucket.last) / 1000) * perSecond);
  bucket.last = now;
  socket.data.buckets[key] = bucket;
  if (bucket.tokens < 1) return true;
  bucket.tokens -= 1;
  return false;
}

io.on('connection', (socket) => {
  socket.on('room:join', (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (rateLimited(socket, 'join', 2)) return respond({ error: 'Slow down a moment.' });

    const name = sanitizeName(payload?.name);
    const rawCode = typeof payload?.code === 'string' ? payload.code.toUpperCase().trim() : '';
    if (rawCode && !/^[A-Z0-9]{4}$/.test(rawCode)) return respond({ error: 'Room codes are 4 letters/numbers.' });

    const result = manager.join(socket, name, rawCode || null);
    if (result.error) return respond({ error: result.error });

    respond({
      you: { id: socket.id, index: result.rider.index, name: result.rider.name },
      room: result.room.lobbyPayload()
    });
  });

  socket.on('room:leave', () => manager.leave(socket));

  socket.on('room:ready', (ready) => {
    if (rateLimited(socket, 'ready', 6)) return;
    manager.roomOf(socket)?.setReady(socket.id, !!ready);
    manager.roomOf(socket)?.broadcastLobby();
  });

  socket.on('room:start', () => {
    if (rateLimited(socket, 'start', 2)) return;
    manager.roomOf(socket)?.forceStart(socket.id);
  });

  socket.on('room:bots', (enabled) => {
    if (rateLimited(socket, 'bots', 4)) return;
    const room = manager.roomOf(socket);
    if (!room) return;
    room.setBotFill(socket.id, !!enabled);
    room.broadcastLobby();
  });

  socket.on('input', (raw) => {
    if (rateLimited(socket, 'input', 90)) return;
    manager.roomOf(socket)?.setInput(socket.id, raw);
  });

  socket.on('ping:probe', (sentAt, ack) => {
    if (typeof ack === 'function') ack(sentAt);
  });

  socket.on('disconnect', () => manager.leave(socket));
});

let last = process.hrtime.bigint();
let accumulator = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  let elapsed = Number(now - last) / 1e9;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;
  accumulator += elapsed;
  while (accumulator >= TICK_DT) {
    manager.update(TICK_DT);
    accumulator -= TICK_DT;
  }
}, 1000 / 120);

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ROAD RIOT server running');
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const addr of localAddresses()) console.log(`  Network:  http://${addr}:${PORT}`);
  console.log(`  Capacity: ${MAX_PLAYERS} riders per room`);
  console.log('');
});
