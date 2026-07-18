# NULLSECTOR — Releases

## 2026-07-17 — v0.1.0 — first build
- **What:** NULLSECTOR, a core-combat programming game. Client-side deterministic VM,
  256-cell sector visualiser, four modes (Manual / Arena / Gauntlet / Ladder), and a
  zero-game-compute ghost/Elo server on `node:sqlite`.
- **Changed:** original 12-op register ISA (a from-scratch 2026 redesign — single
  process, one death rule, live `AT` scan pointer), assembler with labels + error
  reporting, six-foe AI gauntlet, canvas replay with IP comets / mine glyphs / scan
  sweeps / kill-cam, synthesized SFX.
- **How:** static `web/` + `node server/server.mjs`.
- **Verified:** `node server/selftest.mjs` — 10/10 VM tests pass, balance matrix shows
  a real bomber▸scanner▸turtle meta; Playwright browser run — 0 console errors, a live
  Arena fight (9W/0L), and a full ladder deploy (client fights all ghosts → Elo 1026).
