// NULLSECTOR — front-end controller. The client does ALL the game processing:
// it assembles daemons, runs battles against rivals' "ghosts" (their source text),
// and only talks to the tiny server to fetch ghosts + report ladder results.

import { OPS, OPCODES, READ_REGS, MAX_INSTRUCTIONS, runRound, runBattle, makeRng } from './vm.js';
import { assemble } from './assembler.js';
import { SectorView } from './arena.js';
import { STARTERS, GAUNTLET } from './warriors.js';
import { SFX } from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('ns_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ns_' + k, JSON.stringify(v)); } catch {} },
};

// ---------------------------------------------------------------- code editor
class CodePane {
  constructor(ta, gutter, status, errbox, onChange) {
    this.ta = ta; this.gutter = gutter; this.status = status; this.errbox = errbox; this.onChange = onChange;
    this.ta.addEventListener('input', () => this._changed());
    this.ta.addEventListener('scroll', () => { this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this._key(e));
    this.result = null;
  }
  _key(e) {
    if (e.key === 'Tab') { e.preventDefault(); const s = this.ta.selectionStart, en = this.ta.selectionEnd;
      this.ta.value = this.ta.value.slice(0, s) + '  ' + this.ta.value.slice(en); this.ta.selectionStart = this.ta.selectionEnd = s + 2; this._changed(); }
  }
  set(v) { this.ta.value = v; this._changed(); }
  get() { return this.ta.value; }
  _changed() {
    const lines = this.ta.value.split('\n').length;
    this.gutter.innerHTML = '';
    for (let i = 1; i <= lines; i++) this.gutter.appendChild(el('div', null, String(i)));
    this.result = assemble(this.ta.value);
    this._renderStatus();
    if (this.onChange) this.onChange(this.result);
  }
  _renderStatus() {
    const r = this.result;
    this.errbox.innerHTML = '';
    if (r.ok) {
      this.status.className = 'status ok';
      this.status.textContent = `✓ compiles · ${r.count}/${MAX_INSTRUCTIONS} cells`;
    } else {
      this.status.className = 'status err';
      this.status.textContent = `✗ ${r.errors.length} error${r.errors.length > 1 ? 's' : ''}`;
      for (const e of r.errors.slice(0, 12)) {
        const row = el('div', 'err-row');
        row.appendChild(el('span', 'err-line', `L${e.line}`));
        row.appendChild(el('span', 'err-msg', e.msg));
        row.addEventListener('click', () => this._goto(e.line));
        this.errbox.appendChild(row);
      }
    }
  }
  _goto(line) {
    const pos = this.ta.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    this.ta.focus(); this.ta.selectionStart = this.ta.selectionEnd = pos;
    const lh = this.ta.scrollHeight / this.ta.value.split('\n').length;
    this.ta.scrollTop = Math.max(0, (line - 4) * lh);
  }
}

// ---------------------------------------------------------------- app
const App = {
  init() {
    this.sfx = new SFX(store.get('sound', true));
    this.editor = new CodePane($('#code'), $('#gutter'), $('#status'), $('#errors'), (r) => this._onCode(r));
    this.sector = new SectorView($('#sector'), (s) => this._onSector(s));
    this.gaunt = store.get('gauntlet', {});
    this.handle = store.get('handle', '');
    this.opponent = GAUNTLET[0].id;

    this._buildContext();
    this._wireControls();
    this._wireTabs();
    this._loadInitial();
    this.setMode(store.get('mode', 'manual'));
    this._renderSoundBtn();
  },

  _loadInitial() {
    // shared daemon via URL hash?  #d=<name>~<base64 source>
    const h = location.hash;
    if (h.startsWith('#d=')) {
      try {
        const raw = decodeURIComponent(h.slice(3));
        const [name, b64] = raw.split('~');
        const src = decodeURIComponent(escape(atob(b64)));
        $('#wname').value = name || 'shared-daemon';
        this.editor.set(src);
        toast('Loaded a shared daemon from the link.');
        return;
      } catch {}
    }
    const last = store.get('last', null);
    $('#wname').value = (last && last.name) || 'my-daemon';
    this.editor.set((last && last.source) || STARTERS.bomber);
  },

  _onCode(r) {
    store.set('last', { name: $('#wname').value, source: this.editor.get() });
    $('#btn-fight').disabled = !r.ok;
    $('#btn-deploy').disabled = !r.ok;
  },

  // ---- tabs / modes ----
  _wireTabs() {
    document.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode)));
  },
  setMode(m) {
    this.mode = m; store.set('mode', m);
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    document.querySelectorAll('.ctx').forEach((c) => c.hidden = c.dataset.ctx !== m);
    if (m === 'ladder') this.loadLadder();
    if (m === 'gauntlet') this._renderGauntlet();
  },

  // ---- playback + editor controls ----
  _wireControls() {
    $('#wname').addEventListener('input', () => store.set('last', { name: $('#wname').value, source: this.editor.get() }));
    $('#btn-play').addEventListener('click', () => this._playPause());
    $('#btn-step').addEventListener('click', () => { if (this._ensureBattle()) this.sector.stepFwd(); });
    $('#btn-back').addEventListener('click', () => { if (this._ensureBattle()) this.sector.stepBack(); });
    $('#btn-end').addEventListener('click', () => { if (this._ensureBattle()) this.sector.toEnd(); });
    $('#scrub').addEventListener('input', (e) => this.sector.seek(+e.target.value));
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      this.sector.setSpeed(+b.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('#btn-fight').addEventListener('click', () => this.fight());
    $('#btn-deploy').addEventListener('click', () => this.deploy());
    $('#sound').addEventListener('click', () => { const on = this.sfx.toggle(); store.set('sound', on); this._renderSoundBtn(); });

    // load menu
    $('#btn-load').addEventListener('click', (e) => { e.stopPropagation(); $('#load-menu').hidden = !$('#load-menu').hidden; });
    document.addEventListener('click', () => { $('#load-menu').hidden = true; });
    $('#btn-share').addEventListener('click', () => this.share());
    $('#btn-save').addEventListener('click', () => this.saveNamed());

    // one-click example loaders in the Manual panel
    const exNames = { bomber: 'drifter', scanner: 'seeker', blank: 'turtle' };
    document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.example;
      this._loadSrc(exNames[key] || key, STARTERS[key]);
      toast('Loaded — now press ▶ under the sector to watch it fight.');
    }));
  },
  _renderSoundBtn() { $('#sound').textContent = this.sfx.on ? '🔊' : '🔇'; },

  // The central ▶ transport button. If a battle is already loaded, play/pause it.
  // Otherwise kick off a demo battle so the button always DOES something — the #1
  // onboarding trap was pressing play on a fresh page and having nothing happen.
  _playPause() {
    if (this.sector.result) { this.sector.toggle(); return; }
    this.demo();
  },

  // Ensure a battle is loaded before a step/scrub action; if not, run a demo one.
  // Returns true if the sector already had a battle (so the caller can act now),
  // false if we just kicked off a demo (which starts playing on its own).
  _ensureBattle() {
    if (this.sector.result) return true;
    this.demo();
    return false;
  },

  // Assemble the current daemon and fight a lively opponent, then play it.
  // If the editor doesn't compile, fall back to a starter so the game still runs.
  demo() {
    let src = this.editor.get();
    let r = assemble(src);
    let youName = ($('#wname').value || 'YOU').toUpperCase().slice(0, 10);
    if (!r.ok) {
      // Load the DRIFTER example so pressing play always shows a real battle.
      this._loadSrc('drifter', STARTERS.bomber);
      r = assemble(STARTERS.bomber);
      youName = 'DRIFTER';
      toast('Your daemon had errors — running the DRIFTER example battle. Edit the code and press ▶ again.');
    }
    // In Arena, honour the chosen opponent; otherwise pick a busy foe to watch.
    const foeId = (this.mode === 'arena' && this.opponent) ? this.opponent : 'seeker';
    const foe = GAUNTLET.find((g) => g.id === foeId) || GAUNTLET.find((g) => g.id !== 'sentinel') || GAUNTLET[0];
    const foeProg = assemble(foe.source).program;
    this.playBattle(r.program, foeProg, { you: youName, foe: foe.name });
  },

  _onSector(s) {
    // scrubber + counters
    const scrub = $('#scrub');
    scrub.max = s.total; scrub.value = s.step;
    $('#cyc').textContent = `${s.step} / ${s.total}`;
    $('#btn-play').textContent = s.playing ? '❚❚' : '▶';
    // SFX
    if (s.cur && s.playing) {
      if (s.cur.op === 'SCAN') this.sfx.scan();
      if (s.cur.writes && s.cur.writes.some((w) => w.kind === 'mine')) this.sfx.bomb();
    }
    // HUD register cards
    this._renderHud(s.cur);
    // result banner
    if (s.done && s.result) this._renderResult(s.result);
    else $('#banner').hidden = true;
    if (s.done && this._pendingSfx) { this._pendingSfx(); this._pendingSfx = null; }
  },

  _renderHud(cur) {
    const cards = { 1: $('#hud1'), 2: $('#hud2') };
    if (!cur) return;
    const c = cards[cur.p]; if (!c) return;
    const regs = cur.regs || [0, 0, 0, 0];
    $('.regs', c).innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach((n, i) => {
      const r = el('span', 'reg'); r.innerHTML = `<b>${n}</b>${regs[i] ?? 0}`; $('.regs', c).appendChild(r);
    });
    const f = cur.found ?? 0;
    const fr = el('span', 'reg found'); fr.innerHTML = `<b>FOUND</b>${f}`; $('.regs', c).appendChild(fr);
    $('.act', c).textContent = cur.op ? `${cur.op}${cur.note ? ' — ' + cur.note : ''}` : '—';
  },

  _renderResult(res) {
    const b = $('#banner'); b.hidden = false;
    const youWin = this._youAre === 1 ? res.winner === 1 : res.winner === 2;
    let cls = 'tie', txt = 'STALEMATE — time expired';
    if (res.winner !== 0) {
      const reason = res.killer ? res.killer.reason : '';
      if (youWin) { cls = 'win'; txt = `VICTORY — enemy ${reason}`; }
      else { cls = 'lose'; txt = `DEFEAT — you ${reason}`; }
    }
    b.className = 'banner ' + cls; b.textContent = txt;
    if (!this._resultSounded) {
      this._resultSounded = true;
      if (cls === 'win') this.sfx.win(); else if (cls === 'lose') this.sfx.lose(); else this.sfx.tie();
    }
  },

  // ---- running battles ----
  _assembleMine() {
    const r = assemble(this.editor.get());
    if (!r.ok) { toast('Fix the errors first.'); this.setMode(this.mode); return null; }
    return r.program;
  },

  // pick one representative round to watch, with YOU always daemon 1 (cyan).
  _showcase(you, foe) {
    let best = null, bestScore = -1;
    for (let seed = 1; seed <= 16; seed++) {
      const res = runRound(you, foe, { seed, firstPlayer: (seed % 2) ? 1 : 2 });
      const score = (res.killer ? 100 : 0) + Math.min(res.cycles, 400) / 400;
      if (score > bestScore) { bestScore = score; best = res; }
      if (res.killer && res.cycles > 40 && res.cycles < 700) { best = res; break; }
    }
    return best;
  },

  playBattle(you, foe, labels) {
    this._youAre = 1; this._resultSounded = false;
    const res = this._showcase(you, foe);
    this.sector.load(res, { 1: labels.you, 2: labels.foe });
    this.sector.setSpeed(45);
    document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x.dataset.speed === '45'));
    setTimeout(() => this.sector.play(), 120);
    return res;
  },

  fight() {
    const you = this._assembleMine(); if (!you) return;
    const foe = GAUNTLET.find((g) => g.id === this.opponent) || GAUNTLET[0];
    const foeProg = assemble(foe.source).program;
    const rec = runBattle(you, foeProg, { rounds: 9, seed: 7 });
    $('#arena-record').innerHTML =
      `vs <b>${foe.name}</b> — best of 9: <span class="w">${rec.w}W</span> <span class="l">${rec.l}L</span> <span class="t">${rec.t}T</span>`;
    this.playBattle(you, foeProg, { you: ($('#wname').value || 'YOU').toUpperCase().slice(0, 10), foe: foe.name });
  },

  // ---- context panels ----
  _buildContext() {
    // opponent picker (arena)
    const sel = $('#opp');
    GAUNTLET.forEach((g) => { const o = el('option', null, g.name); o.value = g.id; sel.appendChild(o); });
    sel.addEventListener('change', () => { this.opponent = sel.value; $('#opp-blurb').textContent = (GAUNTLET.find(g=>g.id===sel.value)||{}).blurb || ''; });
    $('#opp-blurb').textContent = GAUNTLET[0].blurb;

    // load menu
    const menu = $('#load-menu');
    const addItem = (label, fn) => { const i = el('div', 'menu-item', label); i.addEventListener('click', fn); menu.appendChild(i); };
    addItem('▸ Starter: DRIFTER (bomber)', () => this._loadSrc('drifter', STARTERS.bomber));
    addItem('▸ Starter: SEEKER (scanner)', () => this._loadSrc('seeker', STARTERS.scanner));
    addItem('▸ Starter: blank turtle', () => this._loadSrc('turtle', STARTERS.blank));
    menu.appendChild(el('div', 'menu-sep'));
    GAUNTLET.forEach((g) => addItem(`⌁ Study: ${g.name}`, () => this._loadSrc(g.name.toLowerCase(), g.source)));
    const saved = store.get('saved', {});
    if (Object.keys(saved).length) {
      menu.appendChild(el('div', 'menu-sep'));
      Object.entries(saved).forEach(([n, s]) => addItem(`★ ${n}`, () => this._loadSrc(n, s)));
    }

    // manual (ISA reference)
    this._renderManual();
    // ladder handle
    $('#handle').value = this.handle;
    $('#handle').addEventListener('input', () => { this.handle = $('#handle').value.trim(); store.set('handle', this.handle); });
  },

  _loadSrc(name, src) { $('#wname').value = name; this.editor.set(src); $('#load-menu').hidden = true; toast(`Loaded ${name}.`); },

  _renderManual() {
    const box = $('#isa');
    OPCODES.forEach((op) => {
      const row = el('div', 'isa-row');
      const sig = OPS[op].args.map((a) => ({ wreg: 'reg', rreg: 'reg', val: 'n', off: 'off' }[a])).join(', ');
      row.appendChild(el('code', 'isa-op', sig ? `${op} ${sig}` : op));
      row.appendChild(el('span', 'isa-doc', OPS[op].doc));
      box.appendChild(row);
    });
  },

  _renderGauntlet() {
    const box = $('#gauntlet-list'); box.innerHTML = '';
    let unlocked = 0;
    GAUNTLET.forEach((g, i) => {
      const done = !!this.gaunt[g.id];
      const open = i === 0 || this.gaunt[GAUNTLET[i - 1].id];
      if (open) unlocked = i;
      const card = el('div', 'foe' + (done ? ' done' : '') + (open ? '' : ' locked'));
      const head = el('div', 'foe-head');
      head.appendChild(el('span', 'foe-name', `${i + 1}. ${g.name}`));
      head.appendChild(el('span', 'foe-badge', done ? '✓ CLEARED' : open ? 'OPEN' : '🔒'));
      card.appendChild(head);
      card.appendChild(el('div', 'foe-tag', g.tagline));
      if (open) {
        const btn = el('button', 'btn small', done ? 'Rematch' : 'Fight');
        btn.addEventListener('click', () => this.fightGauntlet(g));
        card.appendChild(btn);
      }
      box.appendChild(card);
    });
  },

  fightGauntlet(g) {
    const you = this._assembleMine(); if (!you) return;
    const foeProg = assemble(g.source).program;
    const rec = runBattle(you, foeProg, { rounds: 9, seed: 11 });
    const won = rec.w > rec.l;
    if (won && !this.gaunt[g.id]) { this.gaunt[g.id] = true; store.set('gauntlet', this.gaunt); toast(`${g.name} cleared! Next foe unlocked.`); }
    $('#gauntlet-record').innerHTML =
      `vs <b>${g.name}</b>: <span class="w">${rec.w}W</span> <span class="l">${rec.l}L</span> <span class="t">${rec.t}T</span> — ${won ? '<span class=w>CLEARED</span>' : 'not yet — win the majority'}`;
    this.playBattle(you, foeProg, { you: ($('#wname').value || 'YOU').toUpperCase().slice(0, 10), foe: g.name });
    setTimeout(() => this._renderGauntlet(), 60);
  },

  // ---- online ladder ----
  async api(path, opts) {
    const r = await fetch('/api' + path, opts);
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  },

  async loadLadder() {
    const box = $('#ladder-table');
    box.innerHTML = '<div class="muted">loading ladder…</div>';
    try {
      const rows = await this.api('/ladder');
      this._renderLadder(rows);
    } catch (e) {
      box.innerHTML = '<div class="muted">Ladder server offline — Arena and Gauntlet still work locally. Deploy a server to enable the global ladder.</div>';
    }
  },

  _renderLadder(rows) {
    const box = $('#ladder-table'); box.innerHTML = '';
    const t = el('table', 'ltable');
    t.innerHTML = '<thead><tr><th>#</th><th>DAEMON</th><th>PILOT</th><th>ELO</th><th>W/L/T</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach((r, i) => {
      const tr = el('tr');
      if (this.handle && r.author === this.handle) tr.className = 'me';
      tr.innerHTML = `<td>${i + 1}</td><td class="dn">${esc(r.name)}</td><td>${esc(r.author)}</td><td class="elo">${r.rating}</td><td class="wlt">${r.w}/${r.l}/${r.t}</td>`;
      tr.addEventListener('click', () => this.sparGhost(r.id, r.name));
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t);
    if (!rows.length) box.appendChild(el('div', 'muted', 'No daemons yet — be the first to deploy.'));
  },

  async sparGhost(id, name) {
    const you = this._assembleMine(); if (!you) return;
    try {
      const g = await this.api('/ghost/' + id);
      const foe = assemble(g.source); if (!foe.ok) return toast('That ghost failed to load.');
      const rec = runBattle(you, foe.program, { rounds: 9, seed: 5 });
      toast(`Sparred ${name}: ${rec.w}W ${rec.l}L ${rec.t}T`);
      this.playBattle(you, foe.program, { you: ($('#wname').value || 'YOU').toUpperCase().slice(0, 10), foe: name });
    } catch { toast('Could not fetch that ghost.'); }
  },

  async deploy() {
    const you = this._assembleMine(); if (!you) return;
    if (!this.handle) { this.handle = (prompt('Pick a pilot handle (shown on the ladder):', '') || '').trim(); if (!this.handle) return; store.set('handle', this.handle); $('#handle').value = this.handle; }
    const name = ($('#wname').value || 'daemon').slice(0, 24);
    $('#deploy-status').textContent = 'uploading daemon…';
    let sub;
    try {
      sub = await this.api('/daemon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, author: this.handle, source: this.editor.get() }) });
    } catch { $('#deploy-status').textContent = 'Ladder server offline — could not deploy.'; return; }
    // client runs every ghost battle locally
    const results = [];
    let wins = 0, tot = 0;
    for (const ghost of sub.ghosts) {
      const gp = assemble(ghost.source);
      if (!gp.ok) continue;
      const rec = runBattle(you, gp.program, { rounds: 7, seed: sub.seed ^ ghost.id });
      results.push({ opponentId: ghost.id, w: rec.w, l: rec.l, t: rec.t });
      wins += rec.w; tot += rec.w + rec.l + rec.t;
      $('#deploy-status').textContent = `fighting ghosts… ${results.length}/${sub.ghosts.length}`;
    }
    try {
      const out = await this.api('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ daemonId: sub.id, results }) });
      $('#deploy-status').innerHTML = `Deployed <b>${esc(name)}</b> — Elo <b>${out.rating}</b>, rank <b>#${out.rank}</b> of ${out.total}. (${wins}/${tot} rounds won)`;
      this.sfx.win();
      this._renderLadder(out.ladder);
      if (sub.ghosts.length) {
        const top = assemble(sub.ghosts[0].source);
        if (top.ok) this.playBattle(you, top.program, { you: name.toUpperCase().slice(0, 10), foe: sub.ghosts[0].name });
      }
    } catch { $('#deploy-status').textContent = 'Deployed, but reporting results failed.'; }
  },

  // ---- misc ----
  share() {
    const src = this.editor.get(); const name = $('#wname').value || 'daemon';
    const b64 = btoa(unescape(encodeURIComponent(src)));
    const url = location.origin + location.pathname + '#d=' + encodeURIComponent(`${name}~${b64}`);
    navigator.clipboard?.writeText(url).then(() => toast('Share link copied to clipboard.'), () => prompt('Copy this link:', url));
  },
  saveNamed() {
    const name = ($('#wname').value || '').trim(); if (!name) return toast('Name your daemon first.');
    const saved = store.get('saved', {}); saved[name] = this.editor.get(); store.set('saved', saved);
    toast(`Saved “${name}” locally.`);
  },
};

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(msg) {
  let t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

window.addEventListener('DOMContentLoaded', () => App.init());
