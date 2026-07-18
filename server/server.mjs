// NULLSECTOR — the teeny ghost/ladder server.
//
// It does NO game processing. The browser runs every battle locally against rivals'
// ghosts (their source text). This server only: (1) stores daemons in SQLite,
// (2) hands back ghosts, (3) keeps an Elo ladder from client-reported, deterministic
// (hence auditable) results. That's the whole job.
//
//   GET  /api/ladder            -> [{id,name,author,rating,w,l,t}]  (rating desc)
//   GET  /api/ghost/:id         -> {id,name,author,source,rating}
//   POST /api/daemon            -> {name,author,source}  ->  {id, seed, ghosts:[...]}
//   POST /api/report            -> {daemonId, results:[{opponentId,w,l,t}]} -> standings
//
// Run:  node server/server.mjs      (PORT env optional, default 8787)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { assemble } from '../web/js/assembler.js';
import { elo } from '../web/js/vm.js';
import { LADDER_SEEDS } from '../web/js/warriors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..', 'web');
const PORT = process.env.PORT || 8787;

// ---- db --------------------------------------------------------------------
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'ladder.db');
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS daemons(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1000,
    w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL, updated INTEGER NOT NULL,
    UNIQUE(author, name)
  );
`);

function seedLadder() {
  const n = db.prepare('SELECT COUNT(*) c FROM daemons').get().c;
  if (n > 0) return;
  const now = Date.now();
  const ins = db.prepare('INSERT INTO daemons(name,author,source,rating,created,updated) VALUES(?,?,?,?,?,?)');
  for (const s of LADDER_SEEDS) if (assemble(s.source).ok) ins.run(s.name, s.author, s.source, 1000, now, now);
  console.log(`seeded ${LADDER_SEEDS.length} house daemons`);
}
seedLadder();

const qAll = db.prepare('SELECT id,name,author,rating,w,l,t FROM daemons ORDER BY rating DESC, updated ASC');
const qGhost = db.prepare('SELECT id,name,author,source,rating FROM daemons WHERE id=?');
const qById = db.prepare('SELECT * FROM daemons WHERE id=?');
const qByKey = db.prepare('SELECT * FROM daemons WHERE author=? AND name=?');
const insDaemon = db.prepare('INSERT INTO daemons(name,author,source,rating,created,updated) VALUES(?,?,?,1000,?,?)');
const updSource = db.prepare('UPDATE daemons SET source=?, updated=? WHERE id=?');
const updRating = db.prepare('UPDATE daemons SET rating=?, w=?, l=?, t=?, updated=? WHERE id=?');

// ---- helpers ---------------------------------------------------------------
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
const clip = (s, n) => String(s == null ? '' : s).slice(0, n).trim();
function body(req) {
  return new Promise((resolve, reject) => {
    let d = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new Error('too big')); req.destroy(); } d += c; });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const full = path.normalize(path.join(WEB, p));
  if (!full.startsWith(WEB) || !existsSync(full)) { res.writeHead(404); return res.end('not found'); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(500); res.end('error'); }
}

// ---- api -------------------------------------------------------------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (req.method === 'GET' && parts[1] === 'ladder') return send(res, 200, qAll.all());

  if (req.method === 'GET' && parts[1] === 'ghost') {
    const g = qGhost.get(Number(parts[2]));
    return g ? send(res, 200, g) : send(res, 404, { error: 'no such ghost' });
  }

  if (req.method === 'POST' && parts[1] === 'daemon') {
    const b = await body(req);
    const name = clip(b.name, 24), author = clip(b.author, 24), source = clip(b.source, 8000);
    if (!name || !author) return send(res, 400, { error: 'name and author required' });
    const asm = assemble(source);
    if (!asm.ok) return send(res, 400, { error: 'daemon does not compile', details: asm.errors });
    const now = Date.now();
    let row = qByKey.get(author, name);
    let id;
    if (row) { updSource.run(source, now, row.id); id = row.id; }
    else { const r = insDaemon.run(name, author, source, now, now); id = Number(r.lastInsertRowid); }
    const ghosts = qGhost ? db.prepare('SELECT id,name,author,source FROM daemons WHERE id!=? ORDER BY rating DESC').all(id) : [];
    return send(res, 200, { id, seed: (now & 0x7fffffff) >>> 0, ghosts });
  }

  if (req.method === 'POST' && parts[1] === 'report') {
    const b = await body(req);
    const me = qById.get(Number(b.daemonId));
    if (!me) return send(res, 404, { error: 'unknown daemon' });
    const now = Date.now();
    let rating = me.rating, w = me.w, l = me.l, t = me.t;
    const results = Array.isArray(b.results) ? b.results.slice(0, 500) : [];
    const tx = db.prepare('BEGIN'); tx.run();
    try {
      for (const r of results) {
        const opp = qById.get(Number(r.opponentId));
        if (!opp || opp.id === me.id) continue;
        const ww = Math.max(0, r.w | 0), ll = Math.max(0, r.l | 0), tt = Math.max(0, r.t | 0);
        const n = ww + ll + tt; if (!n || n > 64) continue; // sanity clamp
        const score = (ww + 0.5 * tt) / n;
        const [na, nb] = elo(rating, opp.rating, score);
        rating = na; w += ww; l += ll; t += tt;
        updRating.run(nb, opp.w + ll, opp.l + ww, opp.t + tt, now, opp.id); // mirror counts for the opponent
      }
      updRating.run(rating, w, l, t, now, me.id);
      db.prepare('COMMIT').run();
    } catch (e) { db.prepare('ROLLBACK').run(); return send(res, 500, { error: 'report failed' }); }

    const ladder = qAll.all();
    const rank = ladder.findIndex((d) => d.id === me.id) + 1;
    return send(res, 200, { rating, rank, total: ladder.length, ladder });
  }

  return send(res, 404, { error: 'no such endpoint' });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/up') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res);
  } catch (e) { send(res, 400, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`NULLSECTOR ladder on http://localhost:${PORT}`));
