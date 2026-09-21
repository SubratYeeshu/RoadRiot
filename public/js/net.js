/* global io */

export class Net {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.ping = 0;
    this.connected = false;
    this.handlers = new Map();

    this.socket.on('connect', () => {
      this.connected = true;
      this.emitLocal('connection', true);
      this.startPingLoop();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emitLocal('connection', false);
    });

    for (const evt of ['room:update', 'race:countdown', 'race:start', 'race:snapshot', 'race:events', 'race:results']) {
      this.socket.on(evt, (payload) => this.emitLocal(evt, payload));
    }
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  emitLocal(event, payload) {
    const handler = this.handlers.get(event);
    if (handler) handler(payload);
  }

  startPingLoop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const probe = () => {
      const sent = performance.now();
      this.socket.timeout(4000).emit('ping:probe', sent, (err) => {
        if (!err) this.ping = Math.round(performance.now() - sent);
      });
    };
    probe();
    this.pingTimer = setInterval(probe, 2500);
  }

  join(name, code) {
    return new Promise((resolve) => {
      this.socket.timeout(8000).emit('room:join', { name, code }, (err, response) => {
        if (err) return resolve({ error: 'Server did not respond. Is it still running?' });
        resolve(response || { error: 'Unexpected server response.' });
      });
    });
  }

  leave() {
    this.socket.emit('room:leave');
  }

  setReady(ready) {
    this.socket.emit('room:ready', ready);
  }

  setBots(enabled) {
    this.socket.emit('room:bots', enabled);
  }

  startRace() {
    this.socket.emit('room:start');
  }

  sendInput(input) {
    this.socket.volatile.emit('input', input);
  }
}
