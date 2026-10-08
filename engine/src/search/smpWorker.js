/**
 * SMP helper thread. Never writes logs (NoopLogger; console.* forwarded to the
 * main thread). Everything the analysis needs comes back in replies and in the
 * shared status slot.
 *
 * Messages in:  init | attach | search | unit-begin | units | unit-end | newgame | shutdown
 * Messages out: ready | attached | result | unit-ready | units-done | unit-ended | error | console
 *
 * Every reply carries hrNow() stamps (recvAt/postAt) so the main thread can
 * separate delivery latency, setup, search and reply latency.
 */
import { parentPort, workerData } from 'worker_threads';
import { installNoopLogger } from '../logging/logger.js';
import { Board } from '../core/board.js';
import { PIECES, WHITE_IDX, BLACK_IDX} from '../core/constants.js';
import { DEFAULT_CONFIG } from '../config/index.js';
import { squareToIndex } from '../core/bitboard.js';
import { generateAllLegalMoves }from '../core/moveGeneration.js';
import { SearchEngine } from './search.js';
import {
  SharedTranspositionTable, SLOT, SLOT_STATE, slotBase, CTRL, hrNow, runSplitUnit,
} from './lazySMP.js';
installNoopLogger();
const threadIndex = workerData.threadIndex | 0;
const BASE = slotBase(threadIndex);
const PROMO = { q: PIECES.QUEEN, r: PIECES.ROOK, b: PIECES.BISHOP, n: PIECES.KNIGHT };
function fmt(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...args) => parentPort.postMessage({
    type: 'console', threadIndex, level, text: args.map(fmt).join(' '),
  });
}
function post(msg) { parentPort.postMessage({ threadIndex, ...msg }); }
let table = null;
let owner = null;
let engine = null;
let engineKey = null;
let lastConfig = null;
let searches = 0;
let unit = null;         // pv-split: { searchId, board, eng, byAlg, units }
function attach(msg) {
  table = new SharedTranspositionTable({
    ttBuffer: msg.ttBuffer, ctrlBuffer: msg.ctrlBuffer,
    serial: msg.serial, sizeMB: msg.sizeMB, role: 'helper',
  });
  owner = msg.owner;
  table.owner = owner;
  engine = null;
  engineKey = null;
  unit = null;
}
/** `config` may be null: the coordinator skips resending an unchanged config. */
function ensureEngine(config) {
  if (config !== null && config !== undefined) lastConfig = config;
  if (lastConfig === null) throw new Error('no config received yet');
  const { maxSearchTime, ...stable } = lastConfig;
  const key = JSON.stringify(stable);
  let rebuilt = false;
  if (engine === null || key !== engineKey) {
    engine = new SearchEngine({ ...lastConfig, threads: 1 }, { ownerId: owner, table });
    engineKey = key;
    rebuilt = true;
  }
  return { eng: engine, rebuilt };
}
function replay(rootFen, moves) {
  const board = Board.fromFen(rootFen);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const from = squareToIndex(m.slice(0, 2));
    const to = squareToIndex(m.slice(2, 4));
    const side = board.gameState.activeColor === 'white' ? WHITE_IDX : BLACK_IDX;
    if (from < 0 || to < 0 || board.pieceList[from] === PIECES.NONE || !board.bbSide[side].getBit(from)) {
      throw new Error(`replay: ${m} is not playable at ply ${i} (${board.toFen()})`);
    }
    board.makeMove(from, to, m.length > 4 ? (PROMO[m[4]] ?? null) : null);
  }
  return board;
}
/** Same root as the main thread, or a 'desync' error. */
function prepareRoot(msg) {
  const t0 = hrNow();
  const { eng, rebuilt } = ensureEngine(msg.config);
  eng.config.maxSearchTime = msg.maxSearchTime;
  const board = replay(msg.rootFen, msg.moves);
  const rootKey = board.gameState.zobristKey.toString(16);
  if (rootKey !== msg.rootKey) {
    const e = new Error(`root key ${rootKey} != main ${msg.rootKey} (${board.toFen()})`);
    e.phase = 'desync';
    throw e;
  }
  return { eng, board, rootKey, rebuilt, setupMs: hrNow() - t0 };
}
/**
 * Cold JIT: a fresh isolate runs interpreted until TurboFan kicks in, so a new
 * helper's first searches were several times slower than the (warm) main
 * thread. A throwaway search on a private 1MB shared table exercises the same
 * hot paths — including the shared-table probe/store — before the first real go.
 */
function warmup(depth) {
  if (!(depth > 0)) return 0;
  const t0 = hrNow();
  const scratch = new SharedTranspositionTable({ sizeMB: 1 });
  scratch.advanceAge();
  const e = new SearchEngine({ ...DEFAULT_CONFIG, threads: 1, maxSearchTime: 5000 }, { table: scratch });
  e.search(new Board(), depth, null);
  return hrNow() - t0;
}
function tableStats() {
  const tt = table.getStats();
  return { hits: tt.hits, misses: tt.misses, stores: tt.stores, torn: tt.tornSuspect };
}
// ── lazy / lazy-skip / root-split ────────────────────────────────────────
function runSearch(msg) {
  const recvAt = hrNow();
  const ctrl = table !== null ? table.ctrl : null;
  let phase = 'setup';
  try {
    if (table === null) throw new Error('no shared table attached');
    const root = prepareRoot(msg);
    phase = 'search';
    const smp = {
      role: 'helper', ctrl, base: BASE, threadIndex, searchId: msg.searchId,
      aspDelta: msg.aspDelta, skip: msg.skip === true,
      collect: msg.collect === true, iterations: [], monitor: null,
    };
    const searchAt = hrNow();
    const res = root.eng.search(root.board, msg.depth, {
      bookHints: msg.bookHints ? new Map(msg.bookHints) : null,
      rootBias:  msg.rootBias  ? new Map(msg.rootBias)  : null,
      rootMoves: msg.rootMoves ? new Set(msg.rootMoves) : null,
      smp,
    });
    const searchMs = hrNow() - searchAt;
    searches++;
    post({
      type: 'result', searchId: msg.searchId, rootKey: root.rootKey,
      move: res.bestMove !== null ? res.bestMove.algebraic : null,
      score: res.score, depth: res.depth, seldepth: res.seldepth,
      nodes: res.nodes, qnodes: res.qNodes, time: res.time,
      pv: res.pv.map(m => m.algebraic), aborted: res.abortReason,
      stats: res.stats, iterations: res.iterations, rootScores: res.rootScores,
      tt: tableStats(), bias: msg.rootBias ? msg.rootBias[0][0] : null,
      timing: {
        sentAt: msg.sentAt, recvAt, setupMs: root.setupMs, rebuilt: root.rebuilt,
        searchMs, searches,
        stopSeenAt: res.abortReason === 'smp-stop' ? searchAt + res.abortedMs : null,
        postAt: hrNow(),
      },
    });
  } catch (err) {
    if (ctrl !== null) Atomics.store(ctrl, BASE + SLOT.STATE, SLOT_STATE.ERROR);
    post({ type: 'error', searchId: msg.searchId, phase: err.phase ?? phase, message: err.message, stack: err.stack });
  }
}
// ── pv-split ─────────────────────────────────────────────────────────────
function unitBegin(msg) {
  const recvAt = hrNow();
  const ctrl = table !== null ? table.ctrl : null;
  unit = null;
  try {
    if (table === null) throw new Error('no shared table attached');
    const root = prepareRoot(msg);
    const byAlg = new Map();
    for (const m of generateAllLegalMoves(root.board, root.board.gameState.activeColor)) byAlg.set(m.algebraic, m);
    root.eng.beginUnitSearch(root.board, msg.depth, {
      smp: { role: 'helper', ctrl, base: BASE, threadIndex, searchId: msg.searchId,
             skip: false, collect: false, iterations: null, monitor: null },
    });
    unit = { searchId: msg.searchId, board: root.board, eng: root.eng, byAlg, units: 0 };
    post({ type: 'unit-ready', searchId: msg.searchId, rootKey: root.rootKey,
           timing: { sentAt: msg.sentAt, recvAt, setupMs: root.setupMs, rebuilt: root.rebuilt, postAt: hrNow() } });
  } catch (err) {
    if (ctrl !== null) Atomics.store(ctrl, BASE + SLOT.STATE, SLOT_STATE.ERROR);
    post({ type: 'error', searchId: msg.searchId, phase: err.phase ?? 'unit-begin', message: err.message, stack: err.stack });
  }
}
function runUnits(msg) {
  const recvAt = hrNow();
  const u = unit;
  if (u === null || u.searchId !== msg.searchId) {
    post({ type: 'error', searchId: msg.searchId, phase: 'units',
           message: `no unit search ${msg.searchId} (have ${u !== null ? u.searchId : 'none'})` });
    return;
  }
  const ctrl = table.ctrl;
  const eng = u.eng;
  const nodes0 = eng.nodes;
  let done = 0;
  while (!eng.stopSearch) {
    const i = Atomics.add(ctrl, CTRL.NEXT_UNIT, 1);
    if (i >= msg.count) break;
    const move = u.byAlg.get(msg.moves[i]);
    if (move === undefined) {
      // Unit i stays PENDING; the main thread re-runs orphans after the barrier.
      post({ type: 'error', searchId: msg.searchId, iter: msg.iter, phase: 'units',
             message: `unit ${i}: ${msg.moves[i]} is not legal here` });
      return;
    }
    if (runSplitUnit(eng, u.board, move, msg.depth, ctrl, i, threadIndex)) done++;
  }
  u.units += done;
  post({
    type: 'units-done', searchId: msg.searchId, iter: msg.iter, done,
    nodes: eng.nodes - nodes0, aborted: eng.stopSearch,
    timing: { sentAt: msg.sentAt, recvAt, workMs: hrNow() - recvAt, postAt: hrNow() },
  });
}
function unitEnd(msg) {
  const u = unit;
  unit = null;
  if (u === null || u.searchId !== msg.searchId) {
    post({ type: 'unit-ended', searchId: msg.searchId, nodes: 0, seldepth: 0, units: 0, stale: true });
    return;
  }
  u.eng.endUnitSearch();
  searches++;
  post({ type: 'unit-ended', searchId: msg.searchId, nodes: u.eng.nodes,
         seldepth: u.eng.maxDepthReached, units: u.units, stats: u.eng.stats, tt: tableStats() });
}
// ── dispatch ─────────────────────────────────────────────────────────────
parentPort.on('message', (msg) => {
  switch (msg.type) {
    case 'init':
      try {
        attach(msg);
        const warmupMs = warmup(msg.warmupDepth | 0);
        post({ type: 'ready', pid: process.pid, serial: table.serial, size: table.size, warmupMs });
      } catch (err) {
        post({ type: 'error', searchId: null, phase: 'init', message: err.message, stack: err.stack });
      }
      return;
    case 'attach':
      try { attach(msg); post({ type: 'attached', serial: table.serial, size: table.size }); }
      catch (err) { post({ type: 'error', searchId: null, phase: 'attach', message: err.message, stack: err.stack }); }
      return;
    case 'search':     runSearch(msg); return;
    case 'unit-begin': unitBegin(msg); return;
    case 'units':      runUnits(msg); return;
    case 'unit-end':   unitEnd(msg); return;
    case 'newgame':    if (engine !== null) engine.moveOrderer.clear(); return;
    case 'shutdown':   process.exit(0);
    default:
      post({ type: 'error', searchId: null, phase: 'protocol', message: `unknown message ${msg.type}` });
  }
});