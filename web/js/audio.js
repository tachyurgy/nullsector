// NULLSECTOR — tiny synthesized SFX (Web Audio, no assets). Throttled so a fast
// replay doesn't machine-gun the speakers.
export class SFX {
  constructor(on = true) { this.on = on; this.ctx = null; this._last = 0; }
  toggle() { this.on = !this.on; if (this.on) this._ensure(); return this.on; }
  _ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _tone(freq, dur, type = 'square', gain = 0.06, slideTo = null) {
    if (!this.on) return; this._ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  _throttle(ms) { const n = performance.now(); if (n - this._last < ms) return false; this._last = n; return true; }

  bomb() { if (this._throttle(55)) this._tone(150, 0.09, 'triangle', 0.05, 60); }
  scan() { if (this._throttle(70)) this._tone(880, 0.03, 'sine', 0.02); }
  win() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'square', 0.06), i * 90)); }
  lose() { [330, 220, 150].forEach((f, i) => setTimeout(() => this._tone(f, 0.2, 'sawtooth', 0.05), i * 110)); }
  tie() { this._tone(440, 0.25, 'sine', 0.04); }
}
