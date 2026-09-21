import { ATK_KICK, ATK_NONE, ATK_PUNCH } from '/shared/constants.js';

const KEY_MAP = {
  ArrowUp: 'accel',
  KeyW: 'accel',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ShiftLeft: 'nitro',
  ShiftRight: 'nitro',
  Space: 'punch',
  KeyJ: 'punch',
  KeyK: 'kick'
};

export class InputController {
  constructor() {
    this.held = new Set();
    this.pendingAttack = ATK_NONE;
    this.steerValue = 0;
    this.seq = 0;
    this.onEscape = null;
    this.onMute = null;
    this.enabled = false;
  }

  attach() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
    this.attachTouch();
  }

  onKey(event, down) {
    if (event.repeat) return;
    if (down && event.code === 'KeyM') this.onMute?.();
    if (down && event.code === 'Escape') this.onEscape?.();

    const action = KEY_MAP[event.code];
    if (!action) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();

    if (down) {
      this.held.add(action);
      if (action === 'punch') this.pendingAttack = ATK_PUNCH;
      if (action === 'kick') this.pendingAttack = ATK_KICK;
    } else {
      this.held.delete(action);
    }
  }

  attachTouch() {
    const panel = document.getElementById('touch');
    if (!panel) return;
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) panel.classList.remove('hidden');

    for (const btn of panel.querySelectorAll('.tbtn')) {
      const action = btn.dataset.key;
      const press = (e) => {
        e.preventDefault();
        btn.classList.add('pressed');
        this.held.add(action);
        if (action === 'punch') this.pendingAttack = ATK_PUNCH;
        if (action === 'kick') this.pendingAttack = ATK_KICK;
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove('pressed');
        this.held.delete(action);
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  readGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  /** Builds the input packet for this frame; attacks are edge triggered. */
  sample(dt) {
    let steer = 0;
    if (this.held.has('left')) steer -= 1;
    if (this.held.has('right')) steer += 1;
    let accel = this.held.has('accel') ? 1 : 0;
    let brake = this.held.has('brake') ? 1 : 0;
    let nitro = this.held.has('nitro') ? 1 : 0;
    let attack = this.pendingAttack;

    const pad = this.readGamepad();
    if (pad) {
      const axis = pad.axes[0] || 0;
      if (Math.abs(axis) > 0.18) steer = Math.max(-1, Math.min(1, axis));
      if (pad.buttons[7]?.pressed || pad.buttons[0]?.pressed) accel = 1;
      if (pad.buttons[6]?.pressed || pad.buttons[1]?.pressed) brake = 1;
      if (pad.buttons[5]?.pressed) nitro = 1;
      if (pad.buttons[2]?.pressed && !this.padPunch) attack = ATK_PUNCH;
      if (pad.buttons[3]?.pressed && !this.padKick) attack = ATK_KICK;
      this.padPunch = pad.buttons[2]?.pressed;
      this.padKick = pad.buttons[3]?.pressed;
    }

    // smooth the digital steer axis so the bike does not snap between extremes
    const rate = dt * 7;
    if (steer === 0) {
      this.steerValue += (0 - this.steerValue) * Math.min(1, rate * 1.4);
      if (Math.abs(this.steerValue) < 0.01) this.steerValue = 0;
    } else {
      this.steerValue += (steer - this.steerValue) * Math.min(1, rate);
    }

    this.pendingAttack = ATK_NONE;
    this.seq++;
    return {
      seq: this.seq,
      steer: Math.max(-1, Math.min(1, this.steerValue)),
      accel,
      brake,
      nitro,
      atk: attack
    };
  }
}
