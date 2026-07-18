// NULLSECTOR — a 2026 core-combat virtual machine.
//
// Two "daemons" (little programs) are injected into a 256-cell circular memory
// "sector" and run one instruction at a time, alternating. The mental model is
// deliberately tiny:
//
//   * Each daemon is a single walker with an instruction pointer (IP) and four
//     scratch registers A B C D. No stack. No multiprocessing. No spawning.
//   * A daemon DIES for exactly one reason: its IP lands on something that is not
//     real code — a MINE, or an unwritten VOID cell. The survivor wins.
//   * Every address is RELATIVE to where you are right now. "BOMB 7" drops a mine
//     seven cells ahead of you. Memory wraps around, so there are no edges.
//
// That's the entire game. Everything else is strategy.
//
// The VM is 100% deterministic: (programA, programB, seed) -> outcome is a pure
// function. That is what lets the CLIENT run every battle locally against a rival's
// stored "ghost" (just their source text) while a tiny server keeps an honest,
// auditable Elo ladder without ever simulating anything itself.

export const CORE_SIZE = 256;
export const MAX_INSTRUCTIONS = 30;    // longest a daemon may be
export const NUM_REGS = 4;             // A B C D
export const DEFAULT_MAX_CYCLES = 1200;
export const LIT_MIN = -255;           // literal bounds at assembly time
export const LIT_MAX = 255;

// Registers. 0..3 are the writable scratch registers A B C D.
// FOUND / AT are read-only result registers written by SCAN.
export const REGS = ['A', 'B', 'C', 'D'];
export const READ_REGS = ['A', 'B', 'C', 'D', 'FOUND', 'AT'];
export const REG_FOUND = 4;
export const REG_AT = 5;

// Operand roles used by the assembler and the docs:
//   'wreg' — a writable register (A-D)               e.g. SET >A<, 5
//   'rreg' — any readable register (A-D, FOUND, AT)  e.g. IFPOS >FOUND<, kill
//   'val'  — an immediate literal OR a readable reg   e.g. SET A, >5<  /  ADD A, >B<
//   'off'  — a relative offset: literal, register, or a label in source
export const OPS = {
  NOOP:   { args: [],                doc: 'Do nothing for a cycle. Handy as padding or a decoy.' },
  SET:    { args: ['wreg', 'val'],   doc: 'Put a value into a register.  SET A, 10' },
  ADD:    { args: ['wreg', 'val'],   doc: 'Add to a register.  ADD A, 1' },
  SUB:    { args: ['wreg', 'val'],   doc: 'Subtract from a register.  SUB A, 1' },
  GOTO:   { args: ['off'],           doc: 'Jump. Use a label.  GOTO loop' },
  IFZERO: { args: ['rreg', 'off'],   doc: 'If the register is 0, jump.  IFZERO A, done' },
  IFPOS:  { args: ['rreg', 'off'],   doc: 'If the register is > 0, jump.  IFPOS FOUND, kill' },
  IFNEG:  { args: ['rreg', 'off'],   doc: 'If the register is < 0, jump.  IFNEG A, back' },
  REPEAT: { args: ['wreg', 'off'],   doc: 'Countdown loop: subtract 1; if still non-zero, jump.  REPEAT B, loop' },
  SCAN:   { args: ['off', 'val'],    doc: 'Sweep <len> cells starting <off> ahead. Sets FOUND (0 clear / 1 enemy / 2 mine) and AT (offset to it).  SCAN 1, 40' },
  BOMB:   { args: ['off'],           doc: 'Plant a MINE at ip+off. Anything that later executes it dies — including you, so mind your own path.  BOMB 7' },
  COPY:   { args: ['off', 'off'],    doc: 'Copy the cell at ip+src to ip+dst. The engine of replication (and of stamping mines).  COPY 0, 20' },
};
export const OPCODES = Object.keys(OPS);

// Cell kinds live in memory. null === VOID (never written; lethal to execute).
export const KIND = { CODE: 'code', MINE: 'mine', DATA: 'data' };

// Why a daemon died — used for flavour in the kill-cam.
export const DEATH = {
  VOID: 'dereferenced void — ran off into unwritten memory',
  MINE: 'detonated a logic bomb',
  TIE:  'time expired',
};

const mod = (n) => ((n % CORE_SIZE) + CORE_SIZE) % CORE_SIZE;
// Nearest signed representative of a wrapped distance, in -128..127.
const signedOff = (n) => { const m = mod(n); return m > CORE_SIZE / 2 ? m - CORE_SIZE : m; };

// mulberry32 — tiny deterministic PRNG so battles + replays reproduce exactly.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- cells -----------------------------------------------------------------
const codeCell = (op, a, b, owner) => ({ kind: KIND.CODE, op, a, b, owner });
const mineCell = (owner) => ({ kind: KIND.MINE, op: null, a: null, b: null, owner });
const cloneCell = (c, owner) => (c == null ? null : { ...c, owner });

// operand = { t: 'imm'|'reg', v }  (reg index into READ_REGS; imm is a number)

class Daemon {
  constructor(num, memory, startIp, program) {
    this.num = num;                 // 1 or 2
    this.memory = memory;
    this.ip = mod(startIp);
    this.regs = [0, 0, 0, 0];       // A B C D
    this.found = 0;
    this.targetAddr = this.ip;      // absolute; AT is derived live from ip
    this.len = program.length;
    let pos = this.ip;
    for (const inst of program) {
      memory[pos] = codeCell(inst.op, inst.a ?? null, inst.b ?? null, num);
      pos = mod(pos + 1);
    }
  }

  readReg(i) {
    if (i < NUM_REGS) return this.regs[i];
    if (i === REG_FOUND) return this.found;
    if (i === REG_AT) return signedOff(this.targetAddr - this.ip); // LIVE: relative to now
    return 0;
  }
  resolve(operand) { return operand.t === 'reg' ? this.readReg(operand.v) : operand.v; }

  // Execute one instruction. Returns null while alive, or a DEATH.* reason.
  // Records what happened onto `tr` for the replay/visualiser.
  step(tr) {
    const m = this.memory;
    const c = m[this.ip];
    tr.ip = this.ip;
    tr.owner = this.num;
    tr.op = null; tr.reads = null; tr.writes = []; tr.jumped = false; tr.note = '';

    if (c == null) return DEATH.VOID;
    if (c.kind === KIND.MINE) { tr.op = 'MINE'; return DEATH.MINE; }
    if (c.kind !== KIND.CODE || c.op == null) return DEATH.VOID; // DATA is lethal too

    const op = c.op;
    tr.op = op;
    tr.a = c.a; tr.b = c.b;
    const R = this.regs;

    const jump = (off) => { this.ip = mod(this.ip + off); tr.jumped = true; };
    const next = () => { this.ip = mod(this.ip + 1); };

    switch (op) {
      case 'NOOP': next(); break;

      case 'SET': R[c.a.v] = this.resolve(c.b); next(); break;
      case 'ADD': R[c.a.v] += this.resolve(c.b); next(); break;
      case 'SUB': R[c.a.v] -= this.resolve(c.b); next(); break;

      case 'GOTO': jump(this.resolve(c.a)); break;

      case 'IFZERO': if (this.readReg(c.a.v) === 0) jump(this.resolve(c.b)); else next(); break;
      case 'IFPOS':  if (this.readReg(c.a.v) >  0) jump(this.resolve(c.b)); else next(); break;
      case 'IFNEG':  if (this.readReg(c.a.v) <  0) jump(this.resolve(c.b)); else next(); break;

      case 'REPEAT':
        R[c.a.v] -= 1;
        if (R[c.a.v] !== 0) jump(this.resolve(c.b)); else next();
        break;

      case 'SCAN': {
        const off = this.resolve(c.a);
        const len = this.resolve(c.b);
        const dir = len >= 0 ? 1 : -1;
        const steps = Math.abs(len);
        let k = off;              // accumulated relative offset from ip
        let found = 0, hitAddr = null;
        const startAddr = mod(this.ip + off);
        for (let i = 0; i < steps; i++) {
          const addr = mod(this.ip + k);
          const cell = m[addr];
          if (cell != null && cell.owner !== this.num) {   // ignore your own cells
            found = cell.kind === KIND.MINE ? 2 : 1;
            hitAddr = addr;
            break;
          }
          k += dir;
        }
        this.found = found;
        this.targetAddr = found ? hitAddr : mod(this.ip + off + len); // AT points here
        tr.reads = { first: startAddr, len: steps, dir, hit: hitAddr, found };
        tr.note = found === 0 ? 'scan: clear' : found === 2 ? 'scan: MINE ahead' : 'scan: enemy found';
        next();
        break;
      }

      case 'BOMB': {
        const addr = mod(this.ip + this.resolve(c.a));
        m[addr] = mineCell(this.num);
        tr.writes.push({ addr, kind: KIND.MINE, owner: this.num });
        tr.note = 'planted mine';
        next();
        break;
      }

      case 'COPY': {
        const src = mod(this.ip + this.resolve(c.a));
        const dst = mod(this.ip + this.resolve(c.b));
        m[dst] = cloneCell(m[src], this.num);
        tr.reads = { first: src, len: 1, dir: 1, hit: src, found: 0, copy: true };
        tr.writes.push({ addr: dst, kind: m[dst] ? m[dst].kind : 'void', owner: this.num });
        tr.note = 'copied cell';
        next();
        break;
      }

      default: return DEATH.VOID; // unknown opcode == garbage == death
    }

    tr.regs = R.slice();
    tr.found = this.found; tr.at = this.readReg(REG_AT);
    return null;
  }
}

// Two non-overlapping start positions; p2 loads after p1 with a random gap so
// neither side has a fixed advantage. rng() -> [0,1).
export function placeStarts(len1, len2, rng) {
  const span = CORE_SIZE - len1 - len2;
  const start1 = Math.floor(rng() * CORE_SIZE);
  const gap = span > 0 ? Math.floor(rng() * (span + 1)) : 0;
  return { start1, start2: mod(start1 + len1 + gap) };
}

// Run one round to completion; returns a compact journal that fully drives replay.
export function runRound(prog1, prog2, opts = {}) {
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const rng = opts.rng ?? makeRng(opts.seed ?? 1);
  const p1 = prog1.length ? prog1 : [{ op: 'NOOP' }];
  const p2 = prog2.length ? prog2 : [{ op: 'NOOP' }];
  let { start1, start2 } = opts;
  if (start1 == null || start2 == null) ({ start1, start2 } = placeStarts(p1.length, p2.length, rng));
  const firstPlayer = opts.firstPlayer ?? 1;

  const memory = new Array(CORE_SIZE).fill(null);
  const daemons = [new Daemon(1, memory, start1, p1), new Daemon(2, memory, start2, p2)];
  const layout = memory.map((c) => (c ? { kind: c.kind, op: c.op, owner: c.owner } : null));

  const journal = [];
  let winner = 0, killer = null;
  const order = firstPlayer === 1 ? [0, 1] : [1, 0];

  outer:
  for (let n = 1; n <= maxCycles; n++) {
    for (const idx of order) {
      const d = daemons[idx];
      const tr = { n, p: d.num };
      const death = d.step(tr);
      tr.newIp = d.ip;
      tr.death = death;
      journal.push(tr);
      if (death) {
        winner = 3 - d.num;
        killer = { addr: tr.ip, victim: d.num, reason: death };
        break outer;
      }
    }
  }

  return {
    coreSize: CORE_SIZE, maxCycles, start1, start2, firstPlayer,
    len1: p1.length, len2: p2.length,
    layout, journal, winner, killer, cycles: journal.length,
  };
}

// Best-of-K battle, swapping sides + re-placing each round to wash out luck.
// Returns {w,l,t} from A's perspective plus a decisive round to show off.
export function runBattle(progA, progB, opts = {}) {
  const rounds = opts.rounds ?? 7;
  const seed = opts.seed ?? 1;
  let w = 0, l = 0, t = 0, showcase = null, best = -1;
  for (let r = 0; r < rounds; r++) {
    const aFirst = r % 2 === 0;
    const rng = makeRng((seed ^ (r * 0x9e3779b1)) >>> 0);
    const res = runRound(aFirst ? progA : progB, aFirst ? progB : progA, { rng, maxCycles: opts.maxCycles });
    if (res.winner === 0) t++;
    else {
      const aWon = (res.winner === 1) === aFirst;
      if (aWon) w++; else l++;
    }
    const score = res.killer ? 2 : 1; // prefer a kill for the showcase
    if (score > best) { best = score; showcase = { ...res, aFirst }; }
  }
  return { w, l, t, showcase };
}

// Standard Elo. score = 1 win / 0.5 tie / 0 loss for A. Returns [newA, newB].
export function elo(ra, rb, score, k = 24) {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  return [Math.round(ra + k * (score - ea)), Math.round(rb + k * ((1 - score) - (1 - ea)))];
}
