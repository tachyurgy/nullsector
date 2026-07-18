// NULLSECTOR — the Sector visualiser. Replays a battle journal onto a 16x16 grid
// (256 memory cells), with instruction-pointer comets, write flashes, scan sweeps
// and a kill-cam. Pure canvas, no dependencies.

import { KIND } from './vm.js';

export const PALETTE = {
  bg: '#0a0e15',
  grid: '#141d2b',
  gridLine: '#1c2838',
  you: '#22d3ee',      // daemon 1
  enemy: '#f472b6',    // daemon 2
  mine: '#ff5468',
  data: '#f0b429',
  void: '#0e1622',
  text: '#c9d6e3',
};

const GRID = 16; // 16x16 = 256

export class SectorView {
  constructor(canvas, onUpdate) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onUpdate = onUpdate || (() => {});
    this.result = null;
    this.mem = [];
    this.flash = new Map();      // addr -> {t, owner} recent write glow
    this.step = 0;               // index into journal (0 = before anything)
    this.playing = false;
    this.speed = 45;             // journal steps per second
    this.ipByDaemon = { 1: null, 2: null };
    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this.sideLabels = { 1: 'YOU', 2: 'ENEMY' };
    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.draw(); });
  }

  _resize() {
    const rect = this.cv.getBoundingClientRect();
    const size = Math.max(240, Math.min(rect.width, rect.height || rect.width));
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = size * dpr;
    this.cv.height = size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.px = size;
    this.cell = size / GRID;
  }

  load(result, sideLabels) {
    this.pause();
    this.result = result;
    this.sideLabels = sideLabels || { 1: 'YOU', 2: 'ENEMY' };
    this.seek(0);
  }

  // Rebuild memory + ip state up to journal index `i` (inclusive of writes/moves).
  seek(i) {
    if (!this.result) return;
    const J = this.result.journal;
    i = Math.max(0, Math.min(i, J.length));
    this.step = i;
    this.mem = this.result.layout.map((c) => (c ? { ...c } : null));
    this.flash.clear();
    this.ipByDaemon = { 1: this.result.start1, 2: this.result.start2 };
    for (let k = 0; k < i; k++) {
      const tr = J[k];
      for (const w of (tr.writes || [])) {
        this.mem[w.addr] = w.kind === 'void' ? null : { kind: w.kind, op: w.kind === KIND.MINE ? null : w.op, owner: w.owner };
        if (k >= i - 24) this.flash.set(w.addr, { t: (24 - (i - k)) / 24, owner: w.owner });
      }
      this.ipByDaemon[tr.p] = tr.newIp;
    }
    this.cur = i > 0 ? J[i - 1] : null;
    this.draw();
    this._emit();
  }

  setSpeed(s) { this.speed = s; }

  play() {
    if (!this.result || this.playing) return;
    if (this.step >= this.result.journal.length) this.seek(0);
    this.playing = true;
    this._last = performance.now();
    this._acc = 0;
    const tick = (now) => {
      if (!this.playing) return;
      const dt = (now - this._last) / 1000; this._last = now;
      this._acc += dt * this.speed;
      let advanced = false;
      while (this._acc >= 1 && this.step < this.result.journal.length) {
        this._advance(); this._acc -= 1; advanced = true;
      }
      // decay flashes for smooth glow even between steps
      this._decayFlashes(dt);
      this.draw();
      if (advanced) this._emit();
      if (this.step >= this.result.journal.length) { this.playing = false; this._emit(); return; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  pause() { this.playing = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
  toggle() { this.playing ? this.pause() : this.play(); }

  stepFwd() { this.pause(); if (this.step < this.result.journal.length) { this._advance(); this.draw(); this._emit(); } }
  stepBack() { this.pause(); this.seek(this.step - 1); }
  toEnd() { this.pause(); this.seek(this.result.journal.length); }

  _advance() {
    const tr = this.result.journal[this.step];
    for (const w of (tr.writes || [])) {
      this.mem[w.addr] = w.kind === 'void' ? null : { kind: w.kind, op: w.kind === KIND.MINE ? null : w.op, owner: w.owner };
      this.flash.set(w.addr, { t: 1, owner: w.owner });
    }
    this.ipByDaemon[tr.p] = tr.newIp;
    this.cur = tr;
    this.step++;
  }

  _decayFlashes(dt) {
    for (const [addr, f] of this.flash) { f.t -= dt * 1.6; if (f.t <= 0) this.flash.delete(addr); }
  }

  _emit() {
    const J = this.result ? this.result.journal : [];
    const done = this.step >= J.length;
    this.onUpdate({
      step: this.step, total: J.length, playing: this.playing, done,
      cur: this.cur, result: this.result,
    });
  }

  // ---- drawing -------------------------------------------------------------
  draw() {
    const ctx = this.ctx, s = this.cell, px = this.px;
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = PALETTE.bg; ctx.fillRect(0, 0, px, px);

    // cells
    for (let a = 0; a < 256; a++) {
      const x = (a % GRID) * s, y = Math.floor(a / GRID) * s;
      const c = this.mem[a];
      let fill = PALETTE.void;
      if (c) {
        if (c.kind === KIND.MINE) fill = PALETTE.mine;
        else if (c.kind === KIND.DATA) fill = PALETTE.data;
        else fill = c.owner === 1 ? PALETTE.you : PALETTE.enemy;
      }
      // base
      ctx.fillStyle = c ? fill : PALETTE.void;
      ctx.globalAlpha = c ? (c.kind === KIND.MINE ? 0.92 : 0.82) : 1;
      this._roundRect(x + 1, y + 1, s - 2, s - 2, Math.min(3, s * 0.18));
      ctx.fill();
      ctx.globalAlpha = 1;

      // mine pip
      if (c && c.kind === KIND.MINE) {
        ctx.fillStyle = '#2a0710';
        ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, Math.max(1.4, s * 0.16), 0, 7); ctx.fill();
      }
    }

    // write flashes (glow)
    for (const [addr, f] of this.flash) {
      if (f.t <= 0) continue;
      const x = (addr % GRID) * s, y = Math.floor(addr / GRID) * s;
      ctx.save();
      ctx.globalAlpha = Math.min(1, f.t) * 0.9;
      ctx.shadowColor = f.owner === 1 ? PALETTE.you : PALETTE.enemy;
      ctx.shadowBlur = s * 0.9;
      ctx.strokeStyle = '#eaf6ff';
      ctx.lineWidth = 1.4;
      this._roundRect(x + 1, y + 1, s - 2, s - 2, Math.min(3, s * 0.18));
      ctx.stroke();
      ctx.restore();
    }

    // scan sweep for the current step
    if (this.cur && this.cur.reads && this.cur.op === 'SCAN') this._drawScan(this.cur);

    // instruction-pointer comets
    this._drawIp(this.ipByDaemon[2], PALETTE.enemy);
    this._drawIp(this.ipByDaemon[1], PALETTE.you);

    // kill-cam
    const done = this.result && this.step >= this.result.journal.length && this.result.killer;
    if (done) this._drawKill(this.result.killer.addr);
  }

  _drawScan(tr) {
    const ctx = this.ctx, s = this.cell;
    const r = tr.reads;
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < r.len; i++) {
      const a = (((r.first + i * r.dir) % 256) + 256) % 256;
      const x = (a % GRID) * s, y = Math.floor(a / GRID) * s;
      ctx.fillStyle = tr.p === 1 ? PALETTE.you : PALETTE.enemy;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
    if (r.hit != null) {
      const x = (r.hit % GRID) * s, y = Math.floor(r.hit / GRID) * s;
      ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
    }
    ctx.restore();
  }

  _drawIp(addr, color) {
    if (addr == null) return;
    const ctx = this.ctx, s = this.cell;
    const x = (addr % GRID) * s, y = Math.floor(addr / GRID) * s;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = s * 1.1;
    ctx.strokeStyle = color; ctx.lineWidth = 2.2;
    this._roundRect(x + 1.5, y + 1.5, s - 3, s - 3, Math.min(3, s * 0.18));
    ctx.stroke();
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, Math.max(1.6, s * 0.2), 0, 7); ctx.fill();
    ctx.restore();
  }

  _drawKill(addr) {
    const ctx = this.ctx, s = this.cell;
    const x = (addr % GRID) * s, y = Math.floor(addr / GRID) * s;
    const t = (performance.now() % 1000) / 1000;
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 7);
    ctx.shadowColor = PALETTE.mine; ctx.shadowBlur = s * 2;
    ctx.strokeStyle = PALETTE.mine; ctx.lineWidth = 3;
    const r = s * (0.5 + t * 0.8);
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, r, 0, 7); ctx.stroke();
    ctx.restore();
    if (this.playing === false) requestAnimationFrame(() => { if (!this.playing) this.draw(); });
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
