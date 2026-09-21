#!/usr/bin/env node
/**
 * Experiment runner — set config, run match, run analysis, aggregate.
 *
 *   node tools/run_experiments.mjs tools/experiments/trade-bias.json
 *   node tools/run_experiments.mjs spec.json --server ws://localhost:8080 --no-analysis
 *
 * SPEC (JSON):
 * {
 *   "label": "trade-bias-sweep",
 *   "server": "ws://localhost:8080",
 *   "rounds": 4,                       // games per arm; colours swap each round
 *   "depth": 6,
 *   "moveLimit": 300,                  // half-moves before the game is abandoned
 *   "logMask": 4095,
 *   "arms": [
 *     { "name": "control",  "a": { "profile": "baseline" },
 *                           "b": { "profile": "baseline" } },
 *     { "name": "init-125", "a": { "profile": "baseline",
 *                                  "options": { "WeightInitiative": 125 } },
 *                           "b": { "profile": "baseline" } }
 *   ]
 * }
 *
 * ── WHY INSTANCE NAMES ARE ARM-SCOPED ────────────────────────────────────
 * The logger's session directory belongs to the SERVER PROCESS, so every arm
 * in one run shares it and games are numbered sequentially across arms. The
 * analyser keys everything on `eng`, so instances are named
 * `<arm>-A` / `<arm>-B`: one `eng` id ↔ one config set ↔ one transposition
 * table for the whole run. Reusing "A"/"B" across arms would merge two
 * different configs under one label and silently invalidate every comparison.
 *
 * ── ISOLATION ────────────────────────────────────────────────────────────
 * One socket per engine instance, which is the server's policy. Each arm opens
 * two sockets, plays its games, and closes them — so the next arm's engines
 * start with empty tables and empty killer/history/counter tables.
 * 
 * Driving the library
 * # one spec
 * node tools/run_experiments.mjs tools/experiments/trade-bias.json
 *
 * # the whole library, sequentially; each arm's engines get fresh tables
 * for f in tools/experiments/*.json; do
 *  node tools/run_experiments.mjs "$f" --no-analysis || break
 * done
 * python3 tools/analyze_logs.py engine/logs --label library --export-replay
 * python3 tools/aggregate_runs.py tools/runs
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import WebSocket from 'ws';

const DEFAULT_SERVER = 'ws://localhost:8080';
const DEFAULT_ROUNDS = 2;
const DEFAULT_DEPTH = 6;
const DEFAULT_MOVE_LIMIT = 300;
const CMD_TIMEOUT_MS = 15000;
const SEARCH_TIMEOUT_MS = 660000;

// ═══════════════════════════════════════════════════════════════════════════
// Shutdown
//
// An in-flight `go` carries a 660s timeout timer and an open socket, so the
// default SIGINT handling returned the prompt while the process lingered.
// Registered sockets are closed, pending requests rejected, partial results
// flushed — a Ctrl-C'd sweep still leaves usable arm-*.json files.
// ═══════════════════════════════════════════════════════════════════════════
const LIVE_SOCKETS = new Set();
let ABORTED = false;

function installShutdown(onFlush) {
  const shutdown = (signal) => {
    if (ABORTED) process.exit(130);
    ABORTED = true;
    console.error(`\n${signal} — tearing down ${LIVE_SOCKETS.size} socket(s)…`);
    for (const s of LIVE_SOCKETS) {
      try { s.abort(new Error(`${signal} received`)); } catch { /* teardown */ }
    }
    try { onFlush(); } catch (e) { console.error('flush failed:', e.message); }
    // unref'd timers are gone with the sockets; exit deterministically rather
    // than hoping the loop drains.
    setTimeout(() => process.exit(130), 150).unref();
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export function aborted() { return ABORTED; }

// ═══════════════════════════════════════════════════════════════════════════
// Minimal serialized UCI socket. Same policy as the browser client: one socket
// per engine instance, one command in flight at a time.
// ═══════════════════════════════════════════════════════════════════════════
class UciSocket {
  constructor(url, session, instance, profile) {
    this.url = url; this.session = session; this.instance = instance; this.profile = profile;
    this.ws = null; this.pending = null; this.chain = Promise.resolve();
  }

  get label() { return `${this.session}/${this.instance}`; }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      LIVE_SOCKETS.add(this);
      this.ws.on('open', () => {
        this.ws.send(`session ${this.session} ${this.instance} ${this.profile}`);
        resolve();
      });
      this.ws.on('message', (d) => this._onMessage(d.toString()));
      this.ws.on('error', (e) => { if (this.pending) this._reject(e); else reject(e); });
      this.ws.on('close', () => { if (this.pending) this._reject(new Error('socket closed')); });
    });
  }

  /** Reject anything in flight, then close. Safe to call twice. */
  abort(err) {
    if (this.pending) this._reject(err);
    this.close();
  }

  close() {
    LIVE_SOCKETS.delete(this);
    try { this.ws && this.ws.terminate ? this.ws.terminate() : this.ws.close(); }
    catch { /* teardown */ }
  }
  _resolve(v) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve(v); }
  _reject(e)  { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.reject(e); }

  _onMessage(text) {
    const p = this.pending;
    if (p === null) return;
    if (p.kind === 'block') { this._resolve(parseBlock(text)); return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (p.kind === 'ack' && (line === 'uciok' || line === 'readyok')) { this._resolve(line); return; }
      if (p.kind === 'bestmove' && line.startsWith('bestmove')) {
        this._resolve(line.split(/\s+/)[1]); return;
      }
    }
  }

  _enqueue(task) {
    const run = this.chain.then(task, task);
    this.chain = run.then(() => {}, () => {});
    return run;
  }

  _req(kind, command, timeout) {
    return this._enqueue(() => new Promise((resolve, reject) => {
      this.pending = {
        kind, resolve, reject,
        timer: setTimeout(() => { this.pending = null; reject(new Error(`timeout: ${command}`)); }, timeout),
      };
      this.ws.send(command);
    }));
  }

  fire(command) { return this._enqueue(() => { this.ws.send(command); }); }

  async handshake() {
    await this._req('ack', 'uci', CMD_TIMEOUT_MS);
    await this._req('ack', 'isready', CMD_TIMEOUT_MS);
  }

  async newGame() {
    await this.fire('ucinewgame');
    await this._req('ack', 'isready', CMD_TIMEOUT_MS);
  }

  setOption(name, value) { return this.fire(`setoption name ${name} value ${value}`); }
  gamestate() { return this._req('block', 'gamestate', CMD_TIMEOUT_MS); }
  makeMove(m) { return this._req('block', `makemove ${m}`, CMD_TIMEOUT_MS); }
  go(depth) { return this._req('bestmove', `go depth ${depth}`, SEARCH_TIMEOUT_MS); }
}

function parseBlock(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(' ');
    if (i === -1) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  if (typeof out.fen !== 'string') throw new Error(`not a gamestate block: ${text.slice(0, 80)}`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Match driving
// ═══════════════════════════════════════════════════════════════════════════
async function applyArmConfig(sock, cfg) {
  if (cfg.profile) await sock.setOption('Profile', cfg.profile);
  for (const [name, value] of Object.entries(cfg.options || {})) {
    await sock.setOption(name, String(value));
  }
  // A profile swap rebuilds the search engine; resync readiness before play.
  await sock.newGame();
}

/**
 * One game. The mover searches; the move is applied to BOTH boards, so each
 * engine keeps its own full history (threefold / 50-move are detected
 * independently, as they must be with two private boards).
 */
async function playGame(a, b, round, depth, moveLimit) {
  const aWhite = round % 2 === 0;
  const white = aWhite ? a : b;
  const black = aWhite ? b : a;

  await Promise.all([a.newGame(), b.newGame()]);
  let state = await white.gamestate();
  let plies = 0;

  while (state.status === 'ongoing' && plies < moveLimit) {
    if (ABORTED) throw new Error('aborted');
    const mover = state.turn === 'white' ? white : black;
    const shadow = state.turn === 'white' ? black : white;

    const move = await mover.go(depth);
    if (!move || move === '(none)') throw new Error(`${mover.label} returned no move`);

    const moverState = await mover.makeMove(move);
    const shadowState = await shadow.makeMove(move);
    if (moverState.fen !== shadowState.fen) {
      throw new Error(`board desync after ${move}: ${moverState.fen} vs ${shadowState.fen}`);
    }
    state = moverState;
    plies++;
  }

  const winnerSide = state.winner === 'white' ? 'white' : state.winner === 'black' ? 'black' : 'draw';
  const winnerEngine = winnerSide === 'draw' ? 'draw'
    : (winnerSide === 'white' ? white.instance : black.instance);
  return {
    round: round + 1,
    whiteEngine: white.instance, blackEngine: black.instance,
    status: plies >= moveLimit ? 'abandoned_move_limit' : state.status,
    winnerSide, winnerEngine, plies, finalFen: state.fen,
  };
}

async function runArm(spec, arm, outDir) {
  const session = `${spec.label}-${arm.name}`;
  const a = new UciSocket(spec.server, session, `${arm.name}-A`, arm.a.profile || 'baseline');
  const b = new UciSocket(spec.server, session, `${arm.name}-B`, arm.b.profile || 'baseline');

  console.log(`\n=== arm ${arm.name} (${spec.rounds} rounds, depth ${spec.depth}) ===`);
  await a.connect(); await b.connect();
  await a.handshake(); await b.handshake();

  if (spec.logMask !== undefined) {
    await a.setOption('LogMask', spec.logMask);
    await b.setOption('LogMask', spec.logMask);
  }
  await applyArmConfig(a, arm.a);
  await applyArmConfig(b, arm.b);

  const games = [];
  for (let r = 0; r < spec.rounds; r++) {
    if (ABORTED) break;
    const g = await playGame(a, b, r, spec.depth, spec.moveLimit);
    games.push(g);
    console.log(`  round ${g.round}: ${g.winnerEngine} (${g.status}, ${g.plies} plies)`);
  }

  a.close(); b.close();

  const tally = { [`${arm.name}-A`]: 0, [`${arm.name}-B`]: 0, draw: 0 };
  for (const g of games) tally[g.winnerEngine] = (tally[g.winnerEngine] ?? 0) + 1;

  const result = { arm: arm.name, config: { a: arm.a, b: arm.b }, tally, games };
  fs.writeFileSync(path.join(outDir, `arm-${arm.name}.json`), JSON.stringify(result, null, 2));
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
function runAnalysis(logsDir, outDir, label) {
  const py = process.env.PYTHON || 'python3';
  const args = ['tools/analyze_logs.py', logsDir, '-o', outDir, '--label', label, '--export-replay'];
  console.log(`\n$ ${py} ${args.join(' ')}`);
  const r = spawnSync(py, args, { stdio: 'inherit' });
  if (r.status !== 0) console.error(`[analysis] exited ${r.status} — logs kept at ${logsDir}`);
  return r.status === 0;
}

function runAggregate(root) {
  const py = process.env.PYTHON || 'python3';
  const r = spawnSync(py, ['tools/aggregate_runs.py', root], { stdio: 'inherit' });
  return r.status === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const specPath = argv.find(a => !a.startsWith('--'));
  if (!specPath) {
    console.error('usage: node tools/run_experiments.mjs <spec.json> [--server URL] [--no-analysis]');
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const serverArg = argv.find(a => a.startsWith('--server'));
  spec.server = serverArg ? serverArg.split('=')[1] || argv[argv.indexOf(serverArg) + 1] : (spec.server || DEFAULT_SERVER);
  spec.label = spec.label || path.basename(specPath, '.json');
  spec.rounds = spec.rounds ?? DEFAULT_ROUNDS;
  spec.depth = spec.depth ?? DEFAULT_DEPTH;
  spec.moveLimit = spec.moveLimit ?? DEFAULT_MOVE_LIMIT;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join('tools', 'runs', `${spec.label}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Partial results must survive a Ctrl-C: a 20-round sweep that is killed at
  // round 14 is still 14 games of data, and the logs are already on disk.
  const completed = [];
  installShutdown(() => {
    fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(
      { spec, arms: completed, aborted: true, finishedAt: new Date().toISOString() }, null, 2));
    console.error(`partial results written to ${outDir}`);
  });

  const arms = [];
  for (const arm of spec.arms) {
    if (ABORTED) break;
    try {
      const r = await runArm(spec, arm, outDir);
      arms.push(r); completed.push(r);
    } catch (err) {
      console.error(`[arm ${arm.name}] FAILED: ${err.message}`);
      const r = { arm: arm.name, error: err.message };
      arms.push(r); completed.push(r);
    }
  }

  fs.writeFileSync(path.join(outDir, 'run.json'),
    JSON.stringify({ spec, arms, finishedAt: new Date().toISOString() }, null, 2));

  if (!ABORTED && !argv.includes('--no-analysis')) {
    runAnalysis('engine/logs', path.join(outDir, 'analysis'), spec.label);
    runAggregate(path.join('tools', 'runs'));
  }

  console.log(`\noutput : ${outDir}`);
}

main().catch(err => { console.error(err); process.exit(1); });