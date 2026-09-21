import { MAX_PLAYERS, RIDER_COLORS } from '/shared/constants.js';
import { formatTime, ordinal } from '/shared/util.js';
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { InputController } from './input.js';
import { Net } from './net.js';

const el = (id) => document.getElementById(id);

const dom = {
  menu: el('menu'),
  lobby: el('lobby'),
  results: el('results'),
  countdown: el('countdown'),
  conn: el('connState'),
  nameInput: el('nameInput'),
  codeInput: el('codeInput'),
  quickPlay: el('quickPlay'),
  createRoom: el('createRoom'),
  joinRoom: el('joinRoom'),
  roomList: el('roomList'),
  menuError: el('menuError'),
  lobbyCode: el('lobbyCode'),
  lobbyPlayers: el('lobbyPlayers'),
  lobbyHint: el('lobbyHint'),
  readyBtn: el('readyBtn'),
  startBtn: el('startBtn'),
  leaveBtn: el('leaveBtn'),
  botToggle: el('botToggle'),
  botToggleWrap: el('botToggleWrap'),
  resultsList: el('resultsList'),
  resultsHint: el('resultsHint')
};

const net = new Net();
const audio = new AudioEngine();
const input = new InputController();
const game = new Game({ canvas: el('stage'), net, audio, input });

const state = {
  me: null,
  room: null,
  ready: false,
  muted: false,
  inRace: false
};

input.attach();
input.onMute = () => toggleMute();
input.onEscape = () => {
  if (state.room) leaveRoom();
};

dom.nameInput.value = localStorage.getItem('roadriot.name') || '';

// ---------------------------------------------------------------- helpers
function showOverlay(which) {
  dom.menu.classList.toggle('hidden', which !== 'menu');
  dom.lobby.classList.toggle('hidden', which !== 'lobby');
  dom.results.classList.toggle('hidden', which !== 'results');
}

function setError(message) {
  dom.menuError.textContent = message || '';
}

function toggleMute() {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
}

async function ensureAudio() {
  await audio.unlock();
  audio.setMuted(state.muted);
}

function playerName() {
  const raw = dom.nameInput.value.trim();
  const name = raw.length >= 2 ? raw : `Rider${Math.floor(Math.random() * 90 + 10)}`;
  localStorage.setItem('roadriot.name', name);
  return name;
}

// ---------------------------------------------------------------- joining
async function join(code) {
  setError('');
  await ensureAudio();
  const response = await net.join(playerName(), code || null);
  if (response.error) {
    setError(response.error);
    return;
  }
  state.me = response.you;
  state.ready = false;

  const room = response.room;
  if (room.state === 'countdown' || room.state === 'racing') {
    // dropped into a race already in progress
    showOverlay(null);
    state.room = room;
    state.inRace = true;
    game.prepare(room.seed, room.players, state.me.index);
    audio.startMusic();
    if (room.state === 'racing') game.beginRacing();
    return;
  }
  applyRoom(room);
}

dom.quickPlay.addEventListener('click', () => join(null));
dom.createRoom.addEventListener('click', () => join(null));
dom.joinRoom.addEventListener('click', () => {
  const code = dom.codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    setError('Enter the 4 character room code.');
    return;
  }
  join(code);
});
dom.codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dom.joinRoom.click();
});

dom.readyBtn.addEventListener('click', () => {
  state.ready = !state.ready;
  net.setReady(state.ready);
  renderLobby();
});
dom.startBtn.addEventListener('click', () => net.startRace());
dom.leaveBtn.addEventListener('click', () => leaveRoom());
dom.botToggle.addEventListener('change', () => net.setBots(dom.botToggle.checked));

function leaveRoom() {
  net.leave();
  state.room = null;
  state.me = null;
  state.ready = false;
  state.inRace = false;
  game.stop();
  audio.stopMusic();
  showOverlay('menu');
  refreshRoomList();
}

// ---------------------------------------------------------------- lobby ui
function applyRoom(room) {
  state.room = room;
  if (room.state === 'lobby') {
    if (state.inRace) {
      state.inRace = false;
      game.stop();
      audio.stopMusic();
    }
    state.ready = room.players.find((p) => p.id === state.me?.id)?.ready ?? false;
    showOverlay('lobby');
  }
  renderLobby();
}

function renderLobby() {
  const room = state.room;
  if (!room) return;
  dom.lobbyCode.textContent = room.code;
  dom.lobbyPlayers.textContent = '';

  const isHost = room.players.some((p) => p.id === state.me?.id && p.host);
  dom.startBtn.classList.toggle('hidden', !isHost);
  dom.botToggleWrap.classList.toggle('hidden', !isHost);
  dom.botToggle.checked = !!room.botFill;

  for (const player of room.players) {
    const li = document.createElement('li');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = RIDER_COLORS[player.colorIndex % RIDER_COLORS.length].body;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = player.name;

    li.append(swatch, who);

    if (player.id && player.id === state.me?.id) li.appendChild(tag('you', 'you'));
    if (player.host) li.appendChild(tag('host'));
    if (player.bot) li.appendChild(tag('ai'));
    else li.appendChild(tag(player.ready ? 'ready' : 'waiting', player.ready ? 'ready' : ''));

    dom.lobbyPlayers.appendChild(li);
  }

  const humans = room.players.filter((p) => !p.bot).length;
  dom.readyBtn.textContent = state.ready ? 'CANCEL READY' : 'READY UP';
  dom.readyBtn.classList.toggle('on', state.ready);
  dom.lobbyHint.textContent = `${humans}/${MAX_PLAYERS} riders connected. Race starts when everyone is ready${
    isHost ? ', or hit START RACE.' : '.'
  }`;
}

function tag(text, variant) {
  const span = document.createElement('span');
  span.className = variant ? `tag ${variant}` : 'tag';
  span.textContent = text;
  return span;
}

// ---------------------------------------------------------------- room list
async function refreshRoomList() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    dom.roomList.textContent = '';
    for (const room of data.rooms.slice(0, 8)) {
      const chip = document.createElement('button');
      chip.className = 'room-chip';
      chip.textContent = `${room.code} · ${room.players}/${room.max} · ${room.state}`;
      chip.addEventListener('click', () => join(room.code));
      dom.roomList.appendChild(chip);
    }
  } catch {
    /* listing is optional */
  }
}
refreshRoomList();
setInterval(() => {
  if (!state.room) refreshRoomList();
}, 6000);

// ---------------------------------------------------------------- race flow
function startCountdownUi(seconds) {
  const node = dom.countdown;
  node.classList.remove('hidden');
  let remaining = Math.ceil(seconds);
  const tick = () => {
    if (remaining > 0) {
      node.textContent = String(remaining);
      audio.playBeep(false);
      if (remaining === 3) audio.say('Three');
      remaining--;
      setTimeout(tick, 1000);
    } else {
      node.textContent = 'GO!';
      audio.playBeep(true);
      audio.say('Go!');
      setTimeout(() => node.classList.add('hidden'), 900);
    }
  };
  tick();
}

net.on('room:update', (room) => {
  if (!state.me) return;
  applyRoom(room);
});

net.on('race:countdown', (payload) => {
  showOverlay(null);
  state.inRace = true;
  game.prepare(payload.seed, payload.riders, state.me?.index ?? -1);
  audio.startMusic();
  startCountdownUi(payload.duration);
});

net.on('race:start', () => {
  game.beginRacing();
});

net.on('race:snapshot', (snap) => game.onSnapshot(snap));
net.on('race:events', (events) => game.onEvents(events));

net.on('race:results', (payload) => {
  dom.resultsList.textContent = '';
  for (const row of payload.standings) {
    const li = document.createElement('li');
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = ordinal(row.place);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = RIDER_COLORS[row.index % RIDER_COLORS.length].body;

    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = row.name;

    const detail = document.createElement('span');
    detail.className = 'tag';
    detail.textContent = row.finished ? formatTime(row.time) : 'DNF';

    li.append(pos, swatch, who, detail);
    if (row.takedowns) li.appendChild(tag(`${row.takedowns} takedowns`));
    if (row.bot) li.appendChild(tag('ai'));
    dom.resultsList.appendChild(li);
  }
  dom.resultsHint.textContent = `Back to the lobby in ${payload.returnIn} seconds…`;
  showOverlay('results');
  audio.stopMusic();

  const mine = payload.standings.find((r) => r.index === state.me?.index);
  if (mine) audio.say(mine.place === 1 ? 'You win!' : `You finished ${ordinal(mine.place)}`);
});

net.on('connection', (connected) => {
  dom.conn.classList.toggle('hidden', connected);
  dom.conn.textContent = connected ? '' : 'Connection lost — retrying…';
  if (!connected) {
    state.room = null;
    state.inRace = false;
    game.stop();
  }
});

window.addEventListener('beforeunload', () => net.leave());
