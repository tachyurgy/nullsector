# NULLSECTOR — Releases

## 2026-07-18 — "Ghosts in the Machine" — genre-history article
- **Live:** <https://nullsector.levelbrook.com/history.html> — a long-form, illustrated
  history of the programming battle game ("an ode to the genre"), linked from the game's
  header via a new ✦ HISTORY tab. Same Docker-on-Box-B deploy as v0.1.0.
- **Changed:** added `web/history.html` — a self-contained article tracing the lineage
  from Darwin (Bell Labs, 1961) → Core War (Dewdney, 1984) → the warrior bestiary +
  rock-paper-scissors metagame → the robot games (RobotWar/CRobots/Robocode) → the
  modern age (TIS-100/Screeps/Battlecode/etc.) → NULLSECTOR's place in the line. All
  imagery is bespoke inline SVG (animated memory ring, Darwin arena, MARS core dump,
  RPS triangle, robot arena) — zero external assets, matching the game's procedural
  ethos. Added a `✦ HISTORY` nav link in `web/index.html` + `.tabs .tablink` style.
- **Verified:** load-bearing historical facts web-verified before writing; Playwright
  render at 1180px — 0 console/page errors, all figures draw, in-game HISTORY link present
  and routes 200.

## 2026-07-17 — v0.1.0 — first build + live deploy
- **Live:** <https://nullsector.levelbrook.com> — Docker container behind kamal-proxy on
  Hetzner Box B (`5.78.227.227`), TLS auto-issued by Let's Encrypt. SQLite ladder on a
  named volume (`nullsector_data`). Redeploy: `git pull` on the box + `docker build -t
  nullsector . && docker rm -f nullsector && docker run -d --name nullsector --restart
  unless-stopped --network kamal -v nullsector_data:/data nullsector` then
  `docker exec kamal-proxy kamal-proxy deploy nullsector --target nullsector:8787 --host
  nullsector.levelbrook.com --tls`.
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
