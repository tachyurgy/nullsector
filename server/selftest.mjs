// Headless correctness harness for the NULLSECTOR VM + assembler.
// Run: node server/selftest.mjs
import { assemble } from '../web/js/assembler.js';
import { runRound, runBattle, DEATH } from '../web/js/vm.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } };

function build(src) {
  const r = assemble(src);
  if (!r.ok) { console.log('ASM ERRORS for:\n' + src + '\n', r.errors); throw new Error('assemble failed'); }
  return r.program;
}

// --- assembler basics ---
const bombErr = assemble('BOMB');
ok(!bombErr.ok, 'BOMB with no operand should error');
const badReg = assemble('SET FOUND, 3');
ok(!badReg.ok, 'writing FOUND should error');
const label = assemble('loop:\n GOTO loop');
ok(label.ok && label.program[0].a.v === 0, 'GOTO loop compiles to offset 0');
const fwd = assemble('GOTO end\n NOOP\nend:\n NOOP');
ok(fwd.ok && fwd.program[0].a.v === 2, 'forward label offset = 2');

// --- a lone NOOP walks into void and dies ---
{
  const duck = build('NOOP');
  const turtle = build('loop:\n GOTO loop');
  const res = runRound(duck, turtle, { start1: 10, start2: 150, seed: 1 });
  ok(res.winner === 2, 'turtle should outlive a one-line duck');
  ok(res.killer && res.killer.reason === DEATH.VOID, 'duck dies on void');
}

// --- imp is a single self-copying line that never dies ---
{
  const imp = build('COPY 0, 1');
  const res = runRound(imp, imp, { start1: 5, start2: 130, seed: 7, maxCycles: 400 });
  ok(res.winner === 0, 'imp vs imp is a tie (both immortal)');
}

// --- a bomber kills a sitting turtle ---
// Sweeps a "safe band" (offsets ~11..250) with stride-1 mines, never touching its
// own 8-cell body, so it clears the core without blowing itself up. 3 cycles/mine.
const DWARF = `
        SET B, 240
        SET A, 250
loop:   BOMB A
        SUB A, 1
        REPEAT B, loop
        SET B, 240
        SET A, 250
        GOTO loop`;
{
  const dwarf = build(DWARF);
  const turtle = build('loop:\n GOTO loop');
  const b = runBattle(dwarf, turtle, { rounds: 8, seed: 42 });
  ok(b.w >= 5, `dwarf should usually clear a turtle (got ${b.w}W ${b.l}L ${b.t}T)`);
}

// --- a scanner locates and bombs ---
// Never blind-bombs (so it can't suicide): it sweeps a scan cursor around the whole
// core and only attacks the exact spot SCAN reports (AT), which is always the enemy.
const SCANNER = `
        SET D, 2
hunt:   SCAN D, 40
        IFPOS FOUND, strike
        ADD D, 36
        SET A, D
        SUB A, 230
        IFNEG A, hunt
        SET D, 2
        GOTO hunt
strike: BOMB AT
        SET D, 2
        GOTO hunt`;
{
  const scan = build(SCANNER);
  const turtle = build('loop:\n GOTO loop');
  const b = runBattle(scan, turtle, { rounds: 8, seed: 3 });
  ok(b.w >= 5, `scanner should clear a turtle (got ${b.w}W ${b.l}L ${b.t}T)`);
}

// --- determinism: same inputs -> identical journal length + winner ---
{
  const dwarf = build(DWARF);
  const scan = build(SCANNER);
  const a = runRound(dwarf, scan, { seed: 999 });
  const c = runRound(dwarf, scan, { seed: 999 });
  ok(a.winner === c.winner && a.cycles === c.cycles, 'runs are deterministic for a fixed seed');
}

// --- round-robin sanity: print a little tournament table ---
const field = { DWARF, SCANNER, IMP: 'COPY 0, 1', TURTLE: 'loop:\n GOTO loop', DUCK: 'NOOP' };
const names = Object.keys(field);
const progs = Object.fromEntries(names.map((n) => [n, build(field[n])]));
console.log('\nRound-robin (rows = wins/losses/ties vs each column, best-of-9):');
process.stdout.write('        ' + names.map((n) => n.padStart(9)).join('') + '\n');
for (const a of names) {
  let row = a.padEnd(8);
  for (const b of names) {
    if (a === b) { row += '        ·'; continue; }
    const r = runBattle(progs[a], progs[b], { rounds: 9, seed: 12345 });
    row += `${r.w}/${r.l}/${r.t}`.padStart(9);
  }
  console.log(row);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
