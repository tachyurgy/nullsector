# NULLSECTOR — Releases

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
