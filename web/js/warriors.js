// NULLSECTOR — built-in daemons: editor starters, the single-player gauntlet ladder,
// and a handful of seed daemons so the online ladder is never empty.
//
// Every source here is verified by server/selftest.mjs. Keep them working.

// ---- editor starter templates ---------------------------------------------
export const STARTERS = {
  blank: `; A blank daemon. It just spins forever — safe, but it can never win.
; Delete this and write something with teeth.
home:
  GOTO home
`,

  bomber: `; DRIFTER — a bomber. It carpets the sector with mines while never
; stepping on its own body. Simple, fast, deadly against anything that sits still.
        SET B, 240        ; how many mines to lay per sweep
        SET A, 250        ; first target, way out ahead
loop:   BOMB A            ; drop a mine at ip + A
        SUB A, 1          ; walk the target back one cell
        REPEAT B, loop    ; B = B - 1; keep going until the sweep is done
        SET B, 240        ; ...then start the sweep over
        SET A, 250
        GOTO loop
`,

  scanner: `; SEEKER — a scanner. It never bombs blind: it sweeps a window around the
; sector, and the instant it senses the enemy it strikes the exact spot (AT).
        SET D, 2          ; where to start looking (grows as we search)
hunt:   SCAN D, 40        ; sense 40 cells starting D ahead -> sets FOUND and AT
        IFPOS FOUND, kill ; FOUND > 0 means we sensed the enemy (or a mine)
        ADD D, 36         ; nothing here — slide the search window forward
        SET A, D
        SUB A, 230
        IFNEG A, hunt     ; still inside the sector? keep hunting
        SET D, 2          ; wrapped all the way round — reset the window
        GOTO hunt
kill:   BOMB AT           ; AT always points at the target from wherever we are now
        SET D, 2
        GOTO hunt
`,
};

// ---- the gauntlet: ordered single-player opponents ------------------------
// difficulty rises down the list. Each is a real, self-consistent daemon.
export const GAUNTLET = [
  {
    id: 'sentinel',
    name: 'SENTINEL',
    tagline: 'It does nothing. Beating it teaches you to stay alive.',
    blurb: 'A dead-simple spinner that never attacks and never dies on its own. You can’t out-wait it — you have to reach out and end it. Build something that touches memory.',
    source: `home:\n  GOTO home\n`,
  },
  {
    id: 'mayfly',
    name: 'MAYFLY',
    tagline: 'Lives fast, dies young. Just outlast it.',
    blurb: 'Marches straight ahead until it runs off the edge of its own code into the void. Survive a few dozen cycles and the round is yours.',
    source: `  NOOP\n  NOOP\n  NOOP\n  NOOP\n`,
  },
  {
    id: 'worm',
    name: 'WORM',
    tagline: 'An imp. Immortal, but toothless.',
    blurb: 'One instruction that copies itself forward forever, crawling around the ring. It will never die — so it will never lose. To beat it you must land a mine on the cell it’s about to step into.',
    source: `  COPY 0, 1\n`,
  },
  {
    id: 'drifter',
    name: 'DRIFTER',
    tagline: 'A workmanlike bomber. Out-tempo it or get buried.',
    blurb: 'Lays a stride-1 minefield across the whole sector without ever hitting itself. If you sit still, you die. Move, replicate, or bomb faster.',
    source: `        SET B, 240\n        SET A, 250\nloop:   BOMB A\n        SUB A, 1\n        REPEAT B, loop\n        SET B, 240\n        SET A, 250\n        GOTO loop\n`,
  },
  {
    id: 'seeker',
    name: 'SEEKER',
    tagline: 'A scanner that hunts. It will find you.',
    blurb: 'Sweeps the ring for your signature and strikes the exact cell. Decoys and constant motion are your friends here.',
    source: `        SET D, 2\nhunt:   SCAN D, 40\n        IFPOS FOUND, kill\n        ADD D, 36\n        SET A, D\n        SUB A, 230\n        IFNEG A, hunt\n        SET D, 2\n        GOTO hunt\nkill:   BOMB AT\n        SET D, 2\n        GOTO hunt\n`,
  },
  {
    id: 'revenant',
    name: 'REVENANT',
    tagline: 'The boss. A hunter-killer core-clear.',
    blurb: 'It carpets the sector like a bomber but keeps one eye open — the moment it senses you, it drops everything and strikes your exact position. Fast, thorough, and mean.',
    source: `        SET B, 244\n        SET A, 250\nloop:   SCAN 3, 16\n        IFPOS FOUND, strike\n        BOMB A\n        SUB A, 1\n        REPEAT B, loop\n        SET B, 244\n        SET A, 250\n        GOTO loop\nstrike: BOMB AT\n        GOTO loop\n`,
  },
];

// ---- seed daemons for the online ladder (so it isn't empty on day one) ----
export const LADDER_SEEDS = [
  { name: 'DRIFTER',  author: 'house', source: STARTERS.bomber },
  { name: 'SEEKER',   author: 'house', source: STARTERS.scanner },
  { name: 'REVENANT', author: 'house', source: GAUNTLET[5].source },
  { name: 'WORM',     author: 'house', source: `  COPY 0, 1\n` },
];
