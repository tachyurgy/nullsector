# NULLSECTOR

**A core-combat programming game.** Write a tiny assembly *daemon*, inject it into a
256-cell memory *sector*, and duel the *ghosts* of rival pilots for rank on a global
Elo ladder.

It's a modern, deliberately-approachable take on the 1984 classic *Core War* — no
multiprocessing, no addressing-mode soup, no stacks. Just one walker, four registers,
and a single rule for death.

## The one rule

> Your instruction pointer dies the moment it lands on something that isn't real
> code — a **MINE** or an unwritten **VOID** cell. The survivor wins.

Every address is **relative to where you are right now**. `BOMB 7` drops a mine 7 cells
ahead. Memory wraps, so there are no edges.

```
; SEEKER — a scanner. It hunts, then strikes the exact spot.
        SET D, 2
hunt:   SCAN D, 40        ; sense 40 cells ahead -> sets FOUND and AT
        IFPOS FOUND, kill ; sensed the enemy?
        ADD D, 36         ; no — slide the search window
        SET A, D
        SUB A, 230
        IFNEG A, hunt
        SET D, 2
        GOTO hunt
kill:   BOMB AT           ; AT is a live pointer to the target, from anywhere
        SET D, 2
        GOTO hunt
```

## Architecture — front-end heavy, teeny back-end

The **client does 100% of the game processing.** The browser holds the entire
deterministic VM. When you climb the ladder, it fetches each rival's **ghost** (just
their source text), runs every battle locally, and reports the outcome.

The **server does no simulation at all.** It only:

1. stores daemons in SQLite,
2. hands back ghosts,
3. keeps an Elo ladder from client-reported results.

Because the VM is a pure function of `(daemonA, daemonB, seed)`, every result is
deterministic and **auditable** — the server *could* re-verify any battle, but doesn't
need to, so it burns effectively zero compute.

```
web/                     static front-end (no build step, no dependencies)
  index.html
  css/style.css
  js/vm.js               the VM — single source of truth for the rules
  js/assembler.js        friendly labelled source  <->  instructions
  js/arena.js            canvas sector visualiser + replay
  js/warriors.js         starters + the gauntlet AI + ladder seeds
  js/app.js              UI controller (editor, modes, ladder client)
  js/audio.js            synthesized SFX
server/
  server.mjs             ~180 lines, zero runtime deps (node:sqlite + node:http)
  selftest.mjs           headless VM correctness + balance harness
```

## Run it

```bash
node server/selftest.mjs      # prove the VM + show the balance matrix
node server/server.mjs        # serve the game + ladder on :8787
```

Then open <http://localhost:8787>. Requires Node 22+ (for built-in `node:sqlite`).

The front-end is fully static — you can also host `web/` on any static host; the
Arena and Gauntlet work offline, and the ladder lights up wherever the server runs.

## Modes

- **Manual** — the rules, the instruction set, and three ways to win.
- **Arena** — spar any opponent and watch the replay.
- **Gauntlet** — a six-foe single-player ladder, each teaching a strategy.
- **Ladder** — deploy to the global Elo board and fight everyone's ghosts.

## Instruction set

`NOOP · SET · ADD · SUB · GOTO · IFZERO · IFPOS · IFNEG · REPEAT · SCAN · BOMB · COPY`
— twelve ops, four registers (`A B C D`) plus two read-only scan results (`FOUND`,
`AT`). See the in-game **Manual** for details.

## License

MIT.
