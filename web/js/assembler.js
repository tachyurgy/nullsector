// NULLSECTOR assembler — friendly labelled source  <->  VM instruction arrays.
//
//   ; comments start with a semicolon
//   loop:              ; a label (may sit on its own line or before an instruction)
//     SCAN 1, 40
//     IFPOS FOUND, kill
//     BOMB 7
//     GOTO loop
//   kill:
//     BOMB AT
//     GOTO loop
//
// Operands are one of: a register (A B C D, or read-only FOUND / AT), an integer
// literal (-255..255), or — anywhere an offset is expected — a label, which
// compiles to a relative jump distance.

import { OPS, OPCODES, REGS, READ_REGS, MAX_INSTRUCTIONS, LIT_MIN, LIT_MAX } from './vm.js';

const REG_INDEX = {};
READ_REGS.forEach((r, i) => { REG_INDEX[r] = i; });
const WRITABLE = new Set(REGS);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INT = /^[+-]?\d+$/;

function parseOperand(tok) {
  const up = tok.toUpperCase();
  if (up in REG_INDEX) return { kind: 'reg', name: up, v: REG_INDEX[up] };
  if (INT.test(tok)) return { kind: 'imm', v: parseInt(tok, 10) };
  if (IDENT.test(tok)) return { kind: 'label', name: tok };
  return { kind: 'bad', text: tok };
}

// Split "SCAN 1, 40" -> { op:'SCAN', operands:['1','40'] }, honouring commas.
function splitInstruction(text) {
  const sp = text.indexOf(' ');
  if (sp === -1) return { op: text.toUpperCase(), operands: [] };
  const op = text.slice(0, sp).toUpperCase();
  const rest = text.slice(sp + 1).trim();
  const operands = rest.length ? rest.split(',').map((s) => s.trim()).filter((s) => s.length) : [];
  return { op, operands };
}

export function assemble(source) {
  const errors = [];
  const rawLines = source.replace(/\r/g, '').split('\n');

  // pass 1 — collect instructions + label positions
  const items = []; // { text, srcLine }
  const labels = {};
  rawLines.forEach((line, i) => {
    const noComment = line.split(';')[0];
    let rest = noComment.trim();
    if (!rest) return;
    // consume leading "label:" tokens (possibly several, possibly with code after)
    while (true) {
      const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (!m) break;
      const name = m[1];
      if (name.toUpperCase() in OPS) { errors.push({ line: i + 1, msg: `"${name}" is an opcode and can't be a label` }); break; }
      if (name in labels) errors.push({ line: i + 1, msg: `duplicate label "${name}"` });
      labels[name] = items.length; // points at the next instruction
      rest = m[2].trim();
      if (!rest) break;
    }
    if (rest) items.push({ text: rest, srcLine: i + 1 });
  });

  if (items.length === 0) errors.push({ line: 1, msg: 'empty program — a daemon needs at least one instruction' });
  if (items.length > MAX_INSTRUCTIONS) errors.push({ line: items[MAX_INSTRUCTIONS]?.srcLine ?? 1, msg: `too long: ${items.length} instructions (max ${MAX_INSTRUCTIONS})` });

  // pass 2 — build + validate each instruction
  const program = [];
  const lineMap = [];
  items.forEach((item, idx) => {
    const { op, operands } = splitInstruction(item.text);
    const spec = OPS[op];
    if (!spec) { errors.push({ line: item.srcLine, msg: `unknown opcode "${op}"` }); return; }
    if (operands.length !== spec.args.length) {
      errors.push({ line: item.srcLine, msg: `${op} expects ${spec.args.length} operand(s), got ${operands.length}` });
      return;
    }
    const built = { op, a: null, b: null };
    spec.args.forEach((role, ai) => {
      const p = parseOperand(operands[ai]);
      const slot = ai === 0 ? 'a' : 'b';
      const fail = (msg) => errors.push({ line: item.srcLine, msg });

      if (p.kind === 'bad') { fail(`can't parse operand "${p.text}"`); return; }

      if (role === 'wreg') {
        if (p.kind !== 'reg' || !WRITABLE.has(p.name)) fail(`${op} operand ${ai + 1} must be a register A-D`);
        else built[slot] = { t: 'reg', v: p.v };
      } else if (role === 'rreg') {
        if (p.kind !== 'reg') fail(`${op} operand ${ai + 1} must be a register`);
        else built[slot] = { t: 'reg', v: p.v };
      } else if (role === 'val') {
        if (p.kind === 'reg') built[slot] = { t: 'reg', v: p.v };
        else if (p.kind === 'imm') {
          if (p.v < LIT_MIN || p.v > LIT_MAX) fail(`value ${p.v} out of range (${LIT_MIN}..${LIT_MAX})`);
          built[slot] = { t: 'imm', v: p.v };
        } else fail(`${op} operand ${ai + 1} can't be a label`);
      } else if (role === 'off') {
        if (p.kind === 'reg') built[slot] = { t: 'reg', v: p.v };
        else if (p.kind === 'imm') {
          if (p.v < LIT_MIN || p.v > LIT_MAX) fail(`offset ${p.v} out of range (${LIT_MIN}..${LIT_MAX})`);
          built[slot] = { t: 'imm', v: p.v };
        } else { // label -> relative offset from this instruction
          if (!(p.name in labels)) fail(`undefined label "${p.name}"`);
          else built[slot] = { t: 'imm', v: labels[p.name] - idx };
        }
      }
    });
    program.push(built);
    lineMap.push(item.srcLine);
  });

  return { ok: errors.length === 0, program, errors, lineMap, count: program.length };
}

// Compiled instruction -> readable text (used to render ghosts we only have as code).
export function disassemble(program) {
  return program.map((inst) => {
    const spec = OPS[inst.op] || { args: [] };
    const parts = [];
    ['a', 'b'].slice(0, spec.args.length).forEach((slot) => {
      const o = inst[slot];
      if (!o) return;
      parts.push(o.t === 'reg' ? READ_REGS[o.v] : String(o.v));
    });
    return parts.length ? `${inst.op} ${parts.join(', ')}` : inst.op;
  }).join('\n');
}

export { OPCODES };
